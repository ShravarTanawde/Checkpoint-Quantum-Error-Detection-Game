"""Noise description used by every simulation in the game.

One parameter set (NoiseParams) feeds three consumers, so the game, the par score and the
experiments all see the same noise:
  * aer_noise_model()      Aer NoiseModel for the density-matrix simulation (gate and idle noise)
  * readout_probs()        per-qubit readout flip probability, applied analytically in simulate.py
  * paulice_noise_model()  the qiskit-paulice NoiseModel, so par's check picker sees the same noise

Channels (all Pauli channels, so the density-matrix result is exact for this model):
  * every 2-qubit gate: probability p2 of a non-identity 2-qubit Pauli (uniform over 15, or over
    the Z-type ones when bias == "Z"); per-pair overrides make "hot spot" gates
  * every 1-qubit gate (including T): probability p1, uniform over X, Y, Z (or Z only when biased)
  * idle: probability p_idle per circuit layer on each qubit that is idle in that layer but has
    started and not yet finished its work (so an ancilla pays for the length of its check's span)
  * readout: symmetric bit flip with probability p_readout (per-qubit overrides allowed)

Two ways to get parameters:
  * NoiseParams.from_dict(level["noise"])   hand-set per level, so each level's lesson shows up
  * NoiseParams.from_backend(backend, layout)  derived from a (fake) backend's calibration data;
    (used by the experiment; the organizers did not announce a common backend or noise model)
"""

from __future__ import annotations

import logging
import statistics
import warnings
from dataclasses import dataclass, field

from qiskit import QuantumCircuit
from qiskit.converters import circuit_to_dag
from qiskit_aer.noise import NoiseModel, pauli_error

# Aer logs a warning every time a qubit-specific error overrides the all-qubit default. That override
# is exactly how hot-spot gates are modelled, so the message is expected noise in the logs.
logging.getLogger("qiskit_aer.noise.noise_model").setLevel(logging.ERROR)

ONE_Q_GATES = ["h", "s", "sdg", "x", "y", "z", "sx", "sxdg", "t", "tdg"]
TWO_Q_GATES = ["cx", "cz", "cy", "swap"]
ALL_PAULI_2Q = [a + b for a in "IXYZ" for b in "IXYZ" if a + b != "II"]
Z_PAULI_2Q = ["IZ", "ZI", "ZZ"]


@dataclass
class NoiseParams:
    p1: float = 0.0005
    p2: float = 0.01
    p_idle: float = 0.001
    p_readout: float = 0.01
    bias: str | None = None  # None (depolarizing) or "Z" (dephasing-dominated)
    pair_overrides: dict[frozenset, float] = field(default_factory=dict)
    readout_overrides: dict[int, float] = field(default_factory=dict)
    label: str = "level noise"

    @staticmethod
    def from_dict(d: dict) -> "NoiseParams":
        pairs = {frozenset(o["qubits"]): float(o["p"]) for o in d.get("overrides", {}).get("2q", [])}
        ro = {int(o["qubit"]): float(o["p"]) for o in d.get("overrides", {}).get("readout", [])}
        return NoiseParams(
            p1=float(d.get("p1", 0.0005)),
            p2=float(d.get("p2", 0.01)),
            p_idle=float(d.get("p_idle", 0.001)),
            p_readout=float(d.get("p_readout", 0.01)),
            bias=d.get("bias"),
            pair_overrides=pairs,
            readout_overrides=ro,
            label=d.get("label", "level noise"),
        )

    @staticmethod
    def from_backend(backend, layout: list[int], label: str | None = None) -> "NoiseParams":
        """Depolarizing approximation of a BackendV2's calibration data, on logical qubits.

        layout[i] is the physical qubit that plays logical qubit i. Ancillas (logical indices beyond
        the layout) and uncoupled pairs get the median values. No routing is modelled: this keeps
        the game's circuits unchanged and is documented as a limitation.
        """
        target = backend.target
        two_q_names = [op for op in ("cx", "ecr", "cz") if op in target.operation_names]
        pairs: dict[frozenset, float] = {}
        for i, pi in enumerate(layout):
            for j, pj in enumerate(layout):
                if i >= j:
                    continue
                errs = []
                for op in two_q_names:
                    for edge in ((pi, pj), (pj, pi)):
                        props = target[op].get(edge)
                        if props is not None and props.error is not None:
                            errs.append(props.error)
                if errs:
                    pairs[frozenset((i, j))] = float(statistics.mean(errs))
        p2 = statistics.median(pairs.values()) if pairs else 0.01
        sx = [target["sx"][(p,)].error for p in layout if "sx" in target.operation_names and target["sx"].get((p,)) and target["sx"][(p,)].error is not None]
        p1 = statistics.median(sx) if sx else 0.0005
        ro = {}
        for i, p in enumerate(layout):
            props = target["measure"].get((p,)) if "measure" in target.operation_names else None
            if props is not None and props.error is not None:
                ro[i] = float(props.error)
        p_ro = statistics.median(ro.values()) if ro else 0.01
        # idle: dephasing over one 2-qubit-gate duration, using T2
        p_idle = 0.0
        try:
            durs = [target[two_q_names[0]][e].duration for e in target[two_q_names[0]] if target[two_q_names[0]][e].duration]
            t2s = [target.qubit_properties[p].t2 for p in layout if target.qubit_properties and target.qubit_properties[p].t2]
            if durs and t2s:
                import math
                p_idle = 0.5 * (1 - math.exp(-statistics.median(durs) / statistics.median(t2s)))
        except Exception:  # calibration fields vary between backends
            p_idle = 0.0
        return NoiseParams(
            p1=p1, p2=p2, p_idle=p_idle, p_readout=p_ro, bias=None,
            pair_overrides=pairs, readout_overrides=ro,
            label=label or f"derived from {getattr(backend, 'name', 'backend')} calibration, layout {layout}",
        )

    def p2_for(self, a: int, b: int) -> float:
        return self.pair_overrides.get(frozenset((a, b)), self.p2)

    def to_dict(self) -> dict:
        return {
            "label": self.label, "p1": self.p1, "p2": self.p2, "p_idle": self.p_idle,
            "p_readout": self.p_readout, "bias": self.bias,
            "overrides": {
                "2q": [{"qubits": sorted(k), "p": v} for k, v in self.pair_overrides.items()],
                "readout": [{"qubit": q, "p": p} for q, p in self.readout_overrides.items()],
            },
        }


def _two_q_channel(p: float, bias: str | None):
    paulis = Z_PAULI_2Q if bias == "Z" else ALL_PAULI_2Q
    return pauli_error([(lab, p / len(paulis)) for lab in paulis] + [("II", 1 - p)])


def _one_q_channel(p: float, bias: str | None):
    paulis = ["Z"] if bias == "Z" else ["X", "Y", "Z"]
    return pauli_error([(lab, p / len(paulis)) for lab in paulis] + [("I", 1 - p)])


def aer_noise_model(params: NoiseParams, n_total: int) -> NoiseModel:
    nm = NoiseModel(basis_gates=sorted(set(ONE_Q_GATES + TWO_Q_GATES + ["id"])))
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        if params.p2 > 0:
            nm.add_all_qubit_quantum_error(_two_q_channel(params.p2, params.bias), TWO_Q_GATES)
        for pair, p in params.pair_overrides.items():
            a, b = sorted(pair)
            if a >= n_total or b >= n_total:
                continue
            for qs in ((a, b), (b, a)):
                nm.add_quantum_error(_two_q_channel(p, params.bias), TWO_Q_GATES, list(qs))
        if params.p1 > 0:
            nm.add_all_qubit_quantum_error(_one_q_channel(params.p1, params.bias), ONE_Q_GATES)
        if params.p_idle > 0:
            nm.add_all_qubit_quantum_error(_one_q_channel(params.p_idle, params.bias), ["id"])
    return nm


def readout_probs(params: NoiseParams, n_total: int) -> list[float]:
    return [params.readout_overrides.get(q, params.p_readout) for q in range(n_total)]


def with_idle(qc: QuantumCircuit, enabled: bool = True) -> QuantumCircuit:
    """Return a copy with an ``id`` on every qubit that idles inside its active window, per layer."""
    if not enabled:
        return qc.copy()
    dag = circuit_to_dag(qc)
    index = {q: i for i, q in enumerate(qc.qubits)}
    layers = []
    for layer in dag.layers():
        nodes = [nd for nd in layer["graph"].op_nodes() if nd.op.name not in ("barrier",)]
        if nodes:
            layers.append(nodes)
    first: dict[int, int] = {}
    last: dict[int, int] = {}
    for li, nodes in enumerate(layers):
        for nd in nodes:
            for q in nd.qargs:
                i = index[q]
                first.setdefault(i, li)
                last[i] = li
    out = QuantumCircuit(qc.num_qubits)
    for li, nodes in enumerate(layers):
        busy = set()
        for nd in nodes:
            qs = [index[q] for q in nd.qargs]
            busy.update(qs)
            out.append(nd.op, qs)
        for q in range(qc.num_qubits):
            if q not in busy and q in first and first[q] < li < last[q]:
                out.id(q)
    return out


def paulice_noise_model(params: NoiseParams, payload_moments: list, n_data: int):
    """The same noise, in qiskit-paulice's own NoiseModel format (gate-wise Pauli-Lindblad rates)."""
    import math

    from qiskit_paulice import NoiseModel as PauliceNoiseModel

    bases = Z_PAULI_2Q if params.bias == "Z" else ALL_PAULI_2Q
    gate_noise: dict[tuple[int, int], list[tuple[str, float]]] = {}
    for moment in payload_moments:
        for gate in moment:
            if len(gate[1]) != 2:
                continue
            a, b = gate[1]
            p = params.p2_for(a, b)
            prob_per_basis = p / len(bases)
            rate = -0.5 * math.log(1.0 - 2.0 * prob_per_basis)
            gate_noise[(a, b)] = [(g, rate) for g in bases]
            gate_noise[(b, a)] = [(g[::-1], rate) for g in bases]
    readout = statistics.mean(readout_probs(params, n_data)) or None
    if not gate_noise:
        return PauliceNoiseModel(gate_noise=params.p2, readout_noise=readout)
    return PauliceNoiseModel(gate_noise=gate_noise, readout_noise=readout)
