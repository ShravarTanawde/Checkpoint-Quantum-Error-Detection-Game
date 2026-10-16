"""Building circuits from a level and a list of checks.

Layout of a checked circuit (qubit indices):
  0 .. n-1        data qubits (the payload)
  n .. n+k-1      one ancilla per check, in the order the checks are listed

Per check, on its ancilla a:
  at the left slot:   h(a), then controlled-P_left from a onto each data qubit in the left edge
  [the payload gates of the span run]
  at the right slot:  controlled-P_right from a, then z(a) if the propagated sign is -1, then h(a)
  end of circuit:     a is measured; outcome 0 = no error seen

At a slot where one check ends and another begins, right edges are emitted first, so the ending
check's span never contains the starting check's left edge.

Merged right edges: when a check ends at the last slot and its right edge is Z-only, the
controlled-Z gates can be dropped. Measuring the data qubits in Z already reveals the Z-parity, so
the syndrome becomes  ancilla bit XOR the parity of those data bits. This is how qiskit-paulice
implements most checks ("check_support"). It saves two-qubit gates, but a readout error on any of
those data qubits now also flips the syndrome. Check.merge = False forces the gated version.

No measurement instructions are added: the simulator saves the final density matrix and readout
error is applied analytically (see simulate.py). ``ops`` records every operation with a comment so
codegen.py can print the same circuit as Qiskit source.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from qiskit import QuantumCircuit

from .pauli_tools import Check, Propagation

CONTROLLED = {"X": "cx", "Y": "cy", "Z": "cz"}


@dataclass
class BuiltCircuit:
    circuit: QuantumCircuit  # no measurements
    n_data: int
    n_ancilla: int
    syndrome_sets: list[tuple[int, ...]]  # each syndrome bit = parity of these qubits' outcomes
    ops: list[tuple] = field(default_factory=list)  # (kind, name, qubits, comment) for codegen

    @property
    def n_total(self) -> int:
        return self.circuit.num_qubits


def payload(level: dict) -> BuiltCircuit:
    return build_checked(level, [], [])


def build_checked(level: dict, checks: list[Check], props: list[Propagation]) -> BuiltCircuit:
    n = level["n_qubits"]
    moments = level["moments"]
    k = len(checks)
    qc = QuantumCircuit(n + k)
    ops: list[tuple] = []

    def emit(name: str, qubits: tuple[int, ...], comment: str | None = None):
        getattr(qc, name)(*qubits)
        ops.append(("gate", name, qubits, comment))

    letters = [chr(ord("A") + i) for i in range(k)]
    syndrome_sets: list[tuple[int, ...]] = []
    for i, pr in enumerate(props):
        a = n + i
        syndrome_sets.append(tuple([a] + sorted(pr.right)) if pr.merged else (a,))
    for slot in range(len(moments) + 1):
        for i, (chk, pr) in enumerate(zip(checks, props)):
            if chk.right == slot:
                a = n + i
                desc = ", ".join(f"{p} on q{q}" for q, p in sorted(pr.right.items()))
                if pr.merged:
                    bits = " XOR ".join([f"s[{i}]"] + [f"c[{q}]" for q in sorted(pr.right)])
                    ops.append(("comment", None, (), f"check {letters[i]}, right edge {desc}: merged into the final measurement, syndrome = {bits}"))
                else:
                    ops.append(("comment", None, (), f"check {letters[i]}, right edge: {desc}" + (" (sign -1)" if pr.sign < 0 else "")))
                    for q, p in sorted(pr.right.items()):
                        emit(CONTROLLED[p], (a, q))
                if pr.sign < 0:
                    emit("z", (a,), "propagated sign is -1")
                emit("h", (a,))
        for i, chk in enumerate(checks):
            if chk.left == slot:
                a = n + i
                desc = ", ".join(f"{p} on q{q}" for q, p in chk.paulis)
                ops.append(("comment", None, (), f"check {letters[i]}, left edge: {desc}"))
                emit("h", (a,))
                for q, p in chk.paulis:
                    emit(CONTROLLED[p], (a, q))
        if slot < len(moments):
            for gate in moments[slot]:
                emit(gate[0], tuple(gate[1]))
    return BuiltCircuit(circuit=qc, n_data=n, n_ancilla=k, syndrome_sets=syndrome_sets, ops=ops)


def two_qubit_count(qc: QuantumCircuit) -> int:
    return sum(1 for inst in qc.data if inst.operation.num_qubits == 2 and inst.operation.name not in ("barrier",))


def gate_depth(qc: QuantumCircuit) -> int:
    return qc.depth(lambda inst: inst.operation.name not in ("barrier", "measure", "id"))
