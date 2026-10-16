"""Exact (deterministic) simulation.

Design decision: the noise model stays fully in place; only shot sampling is
removed. Aer's density-matrix method gives the exact final state under the noise model, so the
probability of every outcome is exact. Readout error is then applied to those probabilities as a
per-qubit confusion matrix. The kept-shot fraction is the exact probability that no check fires,
and fidelity is computed on the exact post-selected distribution. The same layout therefore always
gets the same score, which is what a Zachtronics-style leaderboard and histogram need.

The noiseless "Verify" run uses a statevector simulation of the same checked circuit.
"""

from __future__ import annotations

import numpy as np
from qiskit.quantum_info import Statevector
from qiskit_aer import AerSimulator

from .circuits import BuiltCircuit
from .noise import NoiseParams, aer_noise_model, readout_probs, with_idle


def apply_readout(probs: np.ndarray, n_total: int, flips: list[float]) -> np.ndarray:
    t = probs.reshape([2] * n_total)
    for q, e in enumerate(flips):
        if e <= 0:
            continue
        axis = n_total - 1 - q  # C-order reshape: axis 0 is the highest qubit
        m = np.array([[1 - e, e], [e, 1 - e]])
        t = np.moveaxis(np.tensordot(m, t, axes=([1], [axis])), 0, axis)
    return t.reshape(-1)


def exact_noisy(builts: list[BuiltCircuit], params: NoiseParams, keep_rho: bool = False) -> list[dict]:
    """Run every circuit under the noise model; return exact outcome probabilities (readout applied)."""
    out: list[dict] = [None] * len(builts)  # type: ignore[list-item]
    by_width: dict[int, list[int]] = {}
    for i, b in enumerate(builts):
        by_width.setdefault(b.n_total, []).append(i)
    for width, idxs in by_width.items():
        sim = AerSimulator(method="density_matrix", noise_model=aer_noise_model(params, width))
        circs = []
        for i in idxs:
            qc = with_idle(builts[i].circuit, params.p_idle > 0)
            qc.save_density_matrix()
            circs.append(qc)
        result = sim.run(circs, shots=1).result()
        flips = readout_probs(params, width)
        for j, i in enumerate(idxs):
            rho = np.asarray(result.data(j)["density_matrix"])
            probs = np.clip(np.real(np.diag(rho)), 0, None)
            probs = apply_readout(probs, width, flips)
            out[i] = {"probs": probs, "rho": rho if keep_rho else None}
    return out


def noiseless_probs(built: BuiltCircuit) -> np.ndarray:
    return np.asarray(Statevector(built.circuit).probabilities())
