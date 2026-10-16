"""Engine correctness: determinism, Verify, exactness against sampling, par, codegen."""

import random

import numpy as np
import pytest
from qiskit import QuantumCircuit
from qiskit.quantum_info import hellinger_fidelity as qiskit_hellinger
from qiskit_aer import AerSimulator
from qiskit_aer.noise import ReadoutError

from checkpoint import engine, levels
from checkpoint.circuits import build_checked
from checkpoint.codegen import qiskit_source
from checkpoint.landscape import candidate_checks
from checkpoint.metrics import hellinger_fidelity
from checkpoint.noise import aer_noise_model, readout_probs, with_idle
from checkpoint.par import get_par
from checkpoint.pauli_tools import propagate


def test_scores_are_deterministic():
    chk = [{"left": 1, "right": 4, "paulis": {"1": "Z"}}]
    a = engine.evaluate("01", chk)
    b = engine.evaluate("01", chk)
    assert a["metrics"] == b["metrics"]


def test_baseline_keeps_every_shot():
    for lv in levels.all_levels():
        assert engine.context(lv["id"]).baseline["yield"] == pytest.approx(1.0)


def test_hellinger_matches_qiskit():
    rng = np.random.default_rng(0)
    p, q = rng.random(8), rng.random(8)
    p, q = p / p.sum(), q / q.sum()
    dp = {format(i, "03b"): v for i, v in enumerate(p)}
    dq = {format(i, "03b"): v for i, v in enumerate(q)}
    assert hellinger_fidelity(p, q) == pytest.approx(qiskit_hellinger(dp, dq), abs=1e-12)


@pytest.mark.parametrize("level_id", [lv["id"] for lv in levels.all_levels()])
def test_every_legal_single_check_passes_verify(level_id):
    """P_right = U P_left U^dagger makes a single check exact, so Verify must always pass."""
    lv = levels.get_level(level_id)
    cands = candidate_checks(lv)
    for c in random.Random(0).sample(cands, min(25, len(cands))):
        r = engine.evaluate(level_id, [c.to_dict()], include_par=False)
        assert r["verify"]["passed"], (level_id, c, r["verify"])


def test_exact_matches_shot_sampling():
    """The exact readout matches Aer's own sampled measurement with the same noise, within sampling error."""
    lv = levels.get_level("07")  # heavy readout noise
    ctx = engine.context("07")
    chk = engine.parse_checks([{"left": 0, "right": 4, "paulis": {"2": "Z"}, "merge": False}])
    props = [propagate(lv["moments"], lv["n_qubits"], c) for c in chk]
    built = build_checked(lv, chk, props)
    exact = engine.evaluate("07", [c.to_dict() for c in chk], include_par=False)["metrics"]

    n_total = built.n_total
    nm = aer_noise_model(ctx.params, n_total)
    for q, e in enumerate(readout_probs(ctx.params, n_total)):
        nm.add_readout_error(ReadoutError([[1 - e, e], [e, 1 - e]]), [q])
    qc = with_idle(built.circuit, True)
    qc.measure_all()
    counts = AerSimulator(method="density_matrix", noise_model=nm).run(qc, shots=200_000, seed_simulator=7).result().get_counts()
    kept = {k: v for k, v in counts.items() if k[0] == "0"}  # ancilla is the highest qubit
    y = sum(kept.values()) / 200_000
    data = {}
    for k, v in kept.items():
        data[k[1:]] = data.get(k[1:], 0) + v
    ideal = {format(i, f"0{lv['n_qubits']}b"): p for i, p in enumerate(ctx.ideal_dist) if p > 0}
    f = qiskit_hellinger(ideal, data)
    assert y == pytest.approx(exact["yield"], abs=0.005)
    assert f == pytest.approx(exact["fidelity"], abs=0.005)


def test_merged_and_gated_both_verify_and_merging_saves_gates():
    base = {"left": 1, "right": 4, "paulis": {"1": "Z"}}
    merged = engine.evaluate("01", [base], include_par=False)
    gated = engine.evaluate("01", [{**base, "merge": False}], include_par=False)
    assert merged["checks"][0]["merged"] and not gated["checks"][0]["merged"]
    assert merged["verify"]["passed"] and gated["verify"]["passed"]
    assert merged["metrics"]["extra_2q"] < gated["metrics"]["extra_2q"]


def test_illegal_t_crossing_is_reported_not_simulated():
    r = engine.evaluate("08", [{"left": 1, "right": 3, "paulis": {"1": "X"}}], include_par=False)
    assert not r["valid"] and r["metrics"] is None
    assert any("T/T† gate as X on qubit 1" in p for p in r["problems"])


def test_interfering_checks_fail_verify():
    # X and Z checks on the same qubit over the same span anticommute: each kicks the other's ancilla.
    r = engine.evaluate("05", [{"left": 1, "right": 2, "paulis": {"1": "X"}, "merge": False},
                               {"left": 1, "right": 2, "paulis": {"1": "Z"}, "merge": False}], include_par=False)
    assert r["valid"]
    assert r["verify"]["passed"] is False
    assert r["verify"]["conflicts"] == [[0, 1]]


def test_conflicts_name_only_the_interfering_pair():
    # A third check far away (q3, after the X/Z pair's span) interferes with neither.
    r = engine.evaluate("05", [{"left": 1, "right": 2, "paulis": {"1": "X"}, "merge": False},
                               {"left": 1, "right": 2, "paulis": {"1": "Z"}, "merge": False},
                               {"left": 4, "right": 6, "paulis": {"3": "Z"}}], include_par=False)
    assert r["verify"]["passed"] is False
    assert r["verify"]["conflicts"] == [[0, 1]]


@pytest.mark.parametrize("level_id,raw", [
    ("01", [{"left": 1, "right": 4, "paulis": {"1": "Z"}}]),
    ("01", [{"left": 1, "right": 3, "paulis": {"0": "Z"}}]),
    ("05", [{"left": 0, "right": 6, "paulis": {"0": "Z", "2": "Z"}}, {"left": 1, "right": 6, "paulis": {"1": "Z"}}]),
    ("09b", [{"left": 1, "right": 10, "paulis": {"2": "X"}}]),
    ("10", [{"left": 2, "right": 7, "paulis": {"3": "X"}}, {"left": 3, "right": 7, "paulis": {"0": "X", "2": "Z"}}]),
])
def test_coverage_matches_exact_simulation(level_id, raw):
    """'Seen' on the error badges is exact: with only the payload's two-qubit gates noisy (at a tiny
    rate, so double faults are negligible), the discarded fraction equals sum(p * seen) over gates."""
    from checkpoint.metrics import postselect
    from checkpoint.noise import NoiseParams
    from checkpoint.simulate import exact_noisy

    lv = levels.get_level(level_id)
    pairs = {frozenset(q) for m in lv["moments"] for g, q in m if len(q) == 2}
    p = 1e-5
    params = NoiseParams(p1=0, p2=0, p_idle=0, p_readout=0, bias=lv["noise"].get("bias"), pair_overrides={pr: p for pr in pairs})
    checks = engine.parse_checks(raw)
    built = build_checked(lv, checks, [propagate(lv["moments"], lv["n_qubits"], c) for c in checks])
    probs = exact_noisy([built], params)[0]["probs"]
    kept, _ = postselect(probs, built.n_total, built.syndrome_sets, list(range(lv["n_qubits"])))  # unrounded
    predicted = sum(g["p"] * g["seen"] for g in engine.coverage(lv, params, checks))
    assert predicted > 0
    assert 1 - kept == pytest.approx(predicted, rel=1e-3)


def test_trail_ends_at_the_end_edge():
    lv = levels.get_level("01")
    c = engine.parse_checks([{"left": 1, "right": 4, "paulis": {"1": "Z"}}])[0]
    trail = engine.check_trail(lv, c)
    assert [sorted(t.items()) for t in trail] == [[(1, "Z")], [(0, "Z"), (1, "Z")], [(1, "Z")], [(0, "Z"), (1, "Z")]]


@pytest.mark.parametrize("level_id", [lv["id"] for lv in levels.all_levels()])
def test_stored_solution_solves_the_puzzle(level_id):
    """The solution window shows a stored layout; it must be legal, pass Verify and meet the goal."""
    sol = levels.get_level(level_id)["solution"]
    r = engine.evaluate(level_id, sol["checks"])
    assert r["valid"] and r["verify"]["passed"] and r["goal"]["met"], (level_id, r["problems"], r["goal"])


def test_solution_explanations_contain_no_numbers():
    """Scores are shown from the engine; a hand-written explanation must not repeat (and go stale on) them."""
    import re

    for lv in levels.all_levels():
        for para in lv["solution"]["explanation"]:
            assert not re.search(r"\d\.\d|%", para), (lv["id"], para)


def test_correct_result_rules():
    rules = lambda lid: [r["text"] for r in engine.correct_result(engine.context(lid))["rules"]]
    assert rules("01") == ["q0 = q1"]
    c05 = engine.correct_result(engine.context("05"))
    assert [r["text"] for r in c05["rules"]] == ["q1 = 0", "q0 = q3"] and c05["random"] == [2]
    assert engine.correct_result(engine.context("09b"))["single"] == "0000"


def test_tutorial_suggestion_meets_the_goal():
    """The first puzzle's guided slots must lead to a layout that actually solves it."""
    for lv in levels.all_levels():
        t = lv.get("tutorial")
        if not t:
            continue
        r = engine.evaluate(lv["id"], [{"left": t["start"], "right": t["end"], "paulis": {str(t["qubit"]): t["pauli"]}}])
        assert r["valid"] and r["verify"]["passed"] and r["goal"]["met"], (lv["id"], r["goal"])


def test_par_available_only_for_clifford_levels():
    for lv in levels.all_levels():
        par = get_par(lv["id"])
        if lv["par"] == "paulice":
            assert par["available"] and 0 <= par["metrics"]["yield"] <= 1
        else:
            assert not par["available"]


def test_codegen_runs_and_matches():
    lv = levels.get_level("06")
    chk = engine.parse_checks([{"left": 2, "right": 6, "paulis": {"1": "Z"}}])
    built = build_checked(lv, chk, [propagate(lv["moments"], lv["n_qubits"], c) for c in chk])
    src = qiskit_source(lv, built)
    ns: dict = {}
    exec(src, ns)
    qc: QuantumCircuit = ns["qc"]
    assert qc.num_qubits == built.n_total
    assert sum(1 for i in qc.data if i.operation.name != "measure") == len(built.circuit.data)
