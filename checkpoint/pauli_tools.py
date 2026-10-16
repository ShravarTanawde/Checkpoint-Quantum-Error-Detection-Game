"""Pauli propagation for spacetime checks.

A check wraps a stretch of the circuit between two slots. The player chooses the Pauli at the
left edge; the matching right-edge Pauli is the left one pushed forward through every gate in the
span:  P_right = U P_left U^dagger.  With no error, the two controlled-Paulis cancel and the
ancilla reads 0. An error inside the span that anticommutes with the propagated Pauli flips it.

Clifford gates map Paulis to Paulis, so the right edge is always a Pauli. A T gate does not:
T X T^dagger = (X + Y)/sqrt(2). T is diagonal, so it commutes with Z (and I). A check may
therefore cross a T gate only if its propagated Pauli acts as I or Z on that qubit at that point.
That is the brief's rule for hand-made checks, and the game enforces it here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache

from qiskit import QuantumCircuit
from qiskit.quantum_info import Pauli

CLIFFORD_1Q = {"h", "s", "sdg", "x", "y", "z", "sx", "sxdg", "id"}
CLIFFORD_2Q = {"cx", "cz", "cy", "swap"}
DIAGONAL_NON_CLIFFORD = {"t", "tdg"}
SUPPORTED_GATES = CLIFFORD_1Q | CLIFFORD_2Q | DIAGONAL_NON_CLIFFORD
PAULI_CHARS = ("X", "Y", "Z")


@dataclass(frozen=True)
class Check:
    """One spacetime check, as the player places it.

    left, right: slot indices. Slot k sits just before moment k; slot M (the number of moments)
    sits after the last moment, just before measurement.
    paulis: the left-edge Pauli, as {data qubit index: "X" | "Y" | "Z"}.
    """

    left: int
    right: int
    paulis: tuple[tuple[int, str], ...]
    merge: bool | None = None  # None = merge the right edge into the final measurement when legal

    @staticmethod
    def from_dict(d: dict) -> "Check":
        paulis = d["paulis"]
        if isinstance(paulis, dict):
            items = [(int(q), str(p).upper()) for q, p in paulis.items()]
        else:
            items = [(int(q), str(p).upper()) for q, p in paulis]
        merge = d.get("merge")
        return Check(left=int(d["left"]), right=int(d["right"]), paulis=tuple(sorted(items)), merge=None if merge is None else bool(merge))

    def to_dict(self) -> dict:
        d = {"left": self.left, "right": self.right, "paulis": {str(q): p for q, p in self.paulis}}
        if self.merge is not None:
            d["merge"] = self.merge
        return d

    @property
    def weight(self) -> int:
        return len(self.paulis)


@dataclass
class Propagation:
    ok: bool
    right: dict[int, str] = field(default_factory=dict)  # right-edge Pauli on data qubits
    sign: int = 1  # +1 or -1; a -1 is implemented as a Z on the ancilla after the right edge
    error: str | None = None  # machine-readable reason when ok is False
    message: str | None = None  # player-facing explanation
    blocked_at: tuple[int, int] | None = None  # (moment, qubit) where the T rule failed
    can_merge: bool = False  # right edge sits at the end and is Z-only: it can be read off the final measurement
    merged: bool = False  # whether the circuit builder will merge it (decided by Check.merge)


def pauli_from_dict(paulis: dict[int, str] | tuple, n: int) -> Pauli:
    label = ["I"] * n
    items = paulis.items() if isinstance(paulis, dict) else paulis
    for q, p in items:
        label[n - 1 - int(q)] = p
    return Pauli("".join(label))


def pauli_to_dict(p: Pauli) -> tuple[dict[int, str], int]:
    label = p.to_label()
    sign = 1
    if label.startswith("-i") or label.startswith("i"):
        raise ValueError(f"Non-Hermitian Pauli produced during propagation: {label}")
    if label.startswith("-"):
        sign = -1
        label = label[1:]
    elif label.startswith("+"):
        label = label[1:]
    n = len(label)
    out = {}
    for i, ch in enumerate(label):
        if ch != "I":
            out[n - 1 - i] = ch
    return out, sign


@lru_cache(maxsize=4096)
def _gate_circuit(name: str, qubits: tuple[int, ...], n: int) -> QuantumCircuit:
    qc = QuantumCircuit(n)
    getattr(qc, name)(*qubits)
    return qc


def propagate(moments: list, n: int, check: Check) -> Propagation:
    """Push the check's left-edge Pauli through moments [left, right) and return the right edge."""
    m_count = len(moments)
    if not (0 <= check.left < check.right <= m_count):
        return Propagation(False, error="bad_span", message="A check must start before it ends. Choose an earlier start slot and a later end slot.")
    if not check.paulis:
        return Propagation(False, error="empty", message="A check needs at least one Pauli on its start edge. Choose a qubit before setting the end edge.")
    for q, ch in check.paulis:
        if not 0 <= q < n:
            return Propagation(False, error="bad_qubit", message=f"Qubit {q} is not on this board.")
        if ch not in PAULI_CHARS:
            return Propagation(False, error="bad_pauli", message=f"Unknown Pauli {ch!r}.")

    p = pauli_from_dict(check.paulis, n)
    for m in range(check.left, check.right):
        for gate in moments[m]:
            name, qubits = gate[0], tuple(gate[1])
            if name in DIAGONAL_NON_CLIFFORD:
                current, _ = pauli_to_dict(p)
                for q in qubits:
                    if current.get(q) in ("X", "Y"):
                        return Propagation(
                            False,
                            error="t_rule",
                            blocked_at=(m, q),
                            message=(
                                f"This check reaches a T/T† gate as {current[q]} on qubit {q}. At this point, only I or Z "
                                f"can pass through a T/T† gate as a single Pauli. Z works because it commutes with T; X and Y "
                                f"turn into combinations of Pauli operators, so this check has no valid single-Pauli end edge. "
                                f"Move the check edge or choose a different Pauli path."
                            ),
                        )
                continue  # T commutes with I and Z: the Pauli passes through unchanged
            if name not in SUPPORTED_GATES:
                return Propagation(
                    False, error="unsupported_gate",
                    message=f"This puzzle contains a gate this check engine does not support: {name}. Try a different span, or report this as a game issue.",
                )
            p = p.evolve(_gate_circuit(name, qubits, n), frame="s")  # p -> G p G^dagger
    right, sign = pauli_to_dict(p)
    can_merge = check.right == m_count and all(ch == "Z" for ch in right.values())
    merged = can_merge and (check.merge is None or check.merge)
    return Propagation(True, right=right, sign=sign, can_merge=can_merge, merged=merged)


def check_slots_allowed(level: dict, check: Check) -> str | None:
    """Levels may restrict where edges can go (level["slots"] = {"min": a, "max": b})."""
    slots = level.get("slots")
    if not slots:
        return None
    lo, hi = slots.get("min", 0), slots.get("max", len(level["moments"]))
    if check.left < lo or check.right > hi:
        return f"This puzzle only allows check edges at slots {lo} through {hi}. Try a slot inside that range."
    return None


def is_clifford_circuit(moments: list) -> bool:
    return all(g[0] not in DIAGONAL_NON_CLIFFORD for moment in moments for g in moment)


def count_t(moments: list) -> int:
    return sum(1 for moment in moments for g in moment if g[0] in DIAGONAL_NON_CLIFFORD)
