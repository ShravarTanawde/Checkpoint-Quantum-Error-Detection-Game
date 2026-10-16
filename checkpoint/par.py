"""Par: qiskit-paulice's own check placement, scored with exactly the same noise and metrics.

How it is computed (design decisions):
  * add_pauli_checks(payload + measure_all, target_qubits = all data qubits, noise_model = the level's
    noise translated into paulice's NoiseModel, cost="gamma", method="windowed", fixed seed).
    gamma + windowed + seed is documented as deterministic, but ties on gamma are not always broken
    the same way, so every paulice result is cached on disk (data/paulice_cache/) and reused.
  * The variant with as many checks as the level's ancilla budget allows is par.
  * paulice syndromes can XOR the ancilla bit with payload measurement bits ("check_support"), so
    post-selection here uses those parity sets rather than ancilla bits alone.
  * paulice resynthesizes single-qubit gates into long H/S chains. Each maximal run of single-qubit
    Clifford gates is re-synthesized to its shortest form before scoring, so par is not penalised
    for cosmetic gate count. Two-qubit gates are never touched.
  * T-doped levels have no par: the library rejects non-Clifford circuits. There, the unprotected
    payload is the reference.
"""

from __future__ import annotations

from functools import lru_cache

from qiskit import QuantumCircuit
from qiskit.converters import circuit_to_dag, dag_to_circuit
from qiskit.quantum_info import Clifford

from . import levels as levels_mod
from .circuits import BuiltCircuit
from .noise import paulice_noise_model


def simplify_1q_cliffords(qc: QuantumCircuit) -> QuantumCircuit:
    dag = circuit_to_dag(qc)
    for run in dag.collect_1q_runs():
        if len(run) < 2:
            continue
        sub = QuantumCircuit(1)
        for node in run:
            sub.append(node.op, [0])
        try:
            short = Clifford(sub).to_circuit()
        except Exception:  # not Clifford: leave it alone
            continue
        if len(short.data) >= len(run):
            continue
        # replace the run: remove all nodes but the first, then substitute the first
        for node in run[1:]:
            dag.remove_op_node(node)
        dag.substitute_node_with_dag(run[0], circuit_to_dag(short))
    return dag_to_circuit(dag)


def _strip_final_measurements(qc: QuantumCircuit) -> QuantumCircuit:
    out = QuantumCircuit(qc.num_qubits)
    measured: set[int] = set()
    for inst in qc.data:
        name = inst.operation.name
        qs = [qc.find_bit(q).index for q in inst.qubits]
        if name == "barrier":
            continue
        if name == "measure":
            measured.add(qs[0])
            continue
        if measured.intersection(qs):
            raise RuntimeError("paulice circuit acts on a qubit after measuring it; cannot strip measurements")
        out.append(inst.operation, qs)
    return out


PAULICE_CACHE = levels_mod.ROOT / "data" / "paulice_cache"


def _run_paulice(qc: QuantumCircuit, targets: list[int], params, moments: list, n_data: int, seed: int) -> list[dict]:
    """Call qiskit-paulice once per distinct input and cache the result on disk.

    Why the cache: with cost="gamma", method="windowed" and a fixed seed the library is documented as
    deterministic, and its gamma cost is, but when several placements tie on gamma it does not always
    pick the same one (measured on level 10: 1 run in 6 returned a different check set with identical
    gamma, and the two score differently under post-selected fidelity). Pinning PYTHONHASHSEED does not
    help, so the tie-break is inside the library. Caching makes par identical for everyone who uses
    the repository; delete data/paulice_cache/ to regenerate it.
    """
    import base64
    import hashlib
    import io
    import json
    import warnings

    import qiskit_paulice
    from qiskit import qpy
    from qiskit_paulice import add_pauli_checks

    # Key on the circuit's content, not its name: an unnamed circuit is called "circuit-<N>" from a
    # process-wide counter, which made the key (and so whether the cache hit) depend on how many
    # circuits the process had built before.
    keyed = qc.copy()
    keyed.name = "payload"
    buf = io.BytesIO()
    qpy.dump(keyed, buf)
    key_src = json.dumps({"qc": base64.b64encode(buf.getvalue()).decode(), "targets": targets, "noise": params.to_dict(),
                          "seed": seed, "paulice": getattr(qiskit_paulice, "__version__", "?")}, sort_keys=True)
    key = hashlib.sha256(key_src.encode()).hexdigest()[:20]
    path = PAULICE_CACHE / f"{key}.json"
    if path.exists():
        with open(path, encoding="utf-8") as f:
            stored = json.load(f)
    else:
        nm = paulice_noise_model(params, moments, n_data)
        with warnings.catch_warnings():
            # paulice warns when it cannot translate back to a non-universal input basis such as {h, cx};
            # it then returns its own Clifford basis, which the simulator handles fine.
            warnings.simplefilter("ignore", UserWarning)
            variants = add_pauli_checks(qc, target_qubits=targets, noise_model=nm, seed=seed)
        stored = []
        for cc in variants:
            b = io.BytesIO()
            qpy.dump(cc.circuit, b)
            stored.append({"circuit_qpy": base64.b64encode(b.getvalue()).decode(), "target_qubits": list(cc.target_qubits),
                           "check_qubits": list(cc.check_qubits), "check_support": [list(x) for x in cc.check_support], "cost": cc.cost})
        PAULICE_CACHE.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(stored, f)
        tmp.replace(path)
    out = []
    for v in stored:
        v = dict(v)
        v["circuit"] = qpy.load(io.BytesIO(base64.b64decode(v.pop("circuit_qpy"))))[0]
        out.append(v)
    return out


def paulice_variants(ctx, target_qubits: list[int] | None = None, seed: int = 11) -> list[dict]:
    """Run qiskit-paulice on ctx's payload and score every variant (0 .. len(targets) checks).

    ctx is an engine.LevelContext, so any level dict and any NoiseParams can be used.
    """
    from .engine import _metrics_from_probs
    from .simulate import exact_noisy

    level = ctx.level
    n = level["n_qubits"]
    targets = list(range(n)) if target_qubits is None else list(target_qubits)
    qc = ctx.payload.circuit.copy()
    qc.measure_all()
    variants = _run_paulice(qc, targets, ctx.params, level["moments"], n, seed)
    builts = []
    for v in variants:
        body = simplify_1q_cliffords(_strip_final_measurements(v["circuit"]))
        builts.append(BuiltCircuit(circuit=body, n_data=n, n_ancilla=len(v["check_qubits"]), syndrome_sets=[tuple(s) for s in v["check_support"]]))
    sims = exact_noisy(builts, ctx.params, keep_rho=True)
    out = []
    for v, built, sim in zip(variants, builts, sims):
        out.append({
            "checks": len(v["check_qubits"]),
            "target_qubits": v["target_qubits"],
            "check_support": v["check_support"],
            "paulice_cost_gamma": v["cost"],
            "metrics": _metrics_from_probs(ctx, built, sim["probs"], sim["rho"]),
        })
    return out


@lru_cache(maxsize=None)
def get_par(level_id: str) -> dict:
    level = levels_mod.get_level(level_id)
    if level.get("par") != "paulice":
        reason = level.get("par_note") or (
            "This payload contains T gates, which qiskit-paulice cannot take, so par is the unprotected circuit."
            if not level["clifford"] else "Par is disabled for this level."
        )
        return {"available": False, "reason": reason}
    from .engine import context

    variants = paulice_variants(context(level_id), seed=int(level.get("par_seed", 11)))
    k = min(level["budget"]["ancillas"], len(variants) - 1)
    v = variants[k]
    return {
        "available": True,
        **v,
        "note": "qiskit-paulice placement (cost=gamma, method=windowed, fixed seed), scored with this level's noise.",
    }
