"""Metrics computed from exact outcome probabilities.

Fidelity measure (design decision): Hellinger fidelity between the ideal output
distribution of the data qubits and the post-selected noisy one,
    F = ( sum_x sqrt(p_ideal(x) * p_kept(x)) )^2,
which equals qiskit.quantum_info.hellinger_fidelity. It is what an experiment that measures the
data qubits can actually see. The quantum state fidelity of the kept data state is also reported
(``state_fidelity``) for the report, when post-selection depends on ancillas only.

Yield (kept-shot fraction) = probability that every syndrome bit reads 0, readout errors included.
Cost = ancillas + extra two-qubit gates (depth is reported separately, not folded into Cost).
"""

from __future__ import annotations

import numpy as np


def bitstring(index: int, qubits: list[int]) -> str:
    """Qiskit ordering: the highest listed qubit is the leftmost character."""
    return "".join(str((index >> q) & 1) for q in reversed(qubits))


def bits_table(n_total: int) -> np.ndarray:
    idx = np.arange(2**n_total, dtype=np.int64)
    return ((idx[:, None] >> np.arange(n_total)[None, :]) & 1).astype(np.int8)  # [index, qubit]


def postselect(probs: np.ndarray, n_total: int, syndrome_sets: list[tuple[int, ...]], data_qubits: list[int]):
    """Return (yield, kept distribution over data qubits as a dense vector of length 2^len(data))."""
    bits = bits_table(n_total)
    keep = np.ones(probs.shape[0], dtype=bool)
    for s in syndrome_sets:
        parity = np.bitwise_xor.reduce(bits[:, list(s)], axis=1) if len(s) > 1 else bits[:, s[0]]
        keep &= parity == 0
    kept = np.where(keep, probs, 0.0)
    y = float(kept.sum())
    data_index = np.zeros(probs.shape[0], dtype=np.int64)
    for j, q in enumerate(data_qubits):
        data_index |= bits[:, q].astype(np.int64) << j
    dist = np.bincount(data_index, weights=kept, minlength=2 ** len(data_qubits))
    if y > 0:
        dist = dist / y
    return y, dist


def hellinger_fidelity(p: np.ndarray, q: np.ndarray) -> float:
    p = np.clip(p, 0, None)
    q = np.clip(q, 0, None)
    if p.sum() == 0 or q.sum() == 0:
        return 0.0
    p = p / p.sum()
    q = q / q.sum()
    bc = float(np.sum(np.sqrt(p * q)))
    return min(1.0, bc**2)


def pareto_front(points: list[dict]) -> list[int]:
    """Indices of points not dominated in (fidelity up, yield up)."""
    order = sorted(range(len(points)), key=lambda i: (-points[i]["yield"], -points[i]["fidelity"]))
    front, best_f = [], -1.0
    for i in order:
        if points[i]["fidelity"] > best_f + 1e-12:
            front.append(i)
            best_f = points[i]["fidelity"]
    return front
