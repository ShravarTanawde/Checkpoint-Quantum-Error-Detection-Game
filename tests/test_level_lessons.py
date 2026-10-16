"""Each level's learning moment, asserted on its computed landscape.

These tests are the contract between level design and physics. If the noise model or a level
changes, run
`python scripts/calibrate_levels.py` and then these tests. A failure means a level's text now
claims something the numbers no longer show: fix the level, not the test.
"""

import pytest

from checkpoint import engine, levels
from checkpoint.landscape import candidate_checks, load_or_build
from checkpoint.pauli_tools import Check, propagate


def pts(level_id):
    return load_or_build(level_id)["points"]


def meets(p, g):
    return p["fidelity"] >= g["fidelity"] - 1e-9 and p["yield"] >= g["min_yield"] - 1e-9


def best(points, cond=lambda p: True, min_yield=0.0):
    c = [p for p in points if cond(p) and p["yield"] >= min_yield - 1e-9]
    return max(c, key=lambda p: p["fidelity"]) if c else None


def types(p):
    return {ch for c in p["checks"] for ch in c["paulis"].values()}


@pytest.mark.parametrize("level_id", [lv["id"] for lv in levels.all_levels()])
def test_goal_is_reachable_and_baseline_fails_it(level_id):
    g = engine.effective_goal(level_id)
    assert any(meets(p, g) for p in pts(level_id)), "no layout meets the goal"
    base = engine.context(level_id).baseline
    assert base["fidelity"] < g["fidelity"], "the unprotected circuit already meets the goal"


def test_00_a_check_discards_wrong_results_at_a_yield_cost():
    """Puzzle 00's text: without checks some results are wrong; the q1 check removes most wrong
    results but keeps fewer runs; it asks "are q0 and q1 equal?", so 11 (two flips) slips through."""
    base = engine.evaluate("00", [], include_par=False)
    r = engine.evaluate("00", [{"left": 0, "right": 1, "paulis": {"1": "Z"}}], include_par=False)
    wrong = lambda rows, key: sum(x[key] for x in rows if not x["correct"])
    assert wrong(base["outputs"], "kept") > 0.03
    assert wrong(r["outputs"], "kept") < wrong(r["outputs"], "baseline") / 2
    assert r["metrics"]["fidelity"] > base["metrics"]["fidelity"] and r["metrics"]["yield"] < 1
    assert sorted(r["checks"][0]["right_paulis"].items()) == [("0", "Z"), ("1", "Z")]
    eleven = next(x for x in r["outputs"] if x["bits"] == "11")
    assert eleven["kept"] > 0.5 * eleven["baseline"]  # two flips keep the parity, so the check misses them


def test_02_only_x_checks_see_phase_flips():
    g = engine.effective_goal("02")
    P = pts("02")
    assert all("X" in types(p) for p in P if meets(p, g))
    z_only = best(P, lambda p: types(p) == {"Z"})
    assert z_only["fidelity"] < engine.context("02").baseline["fidelity"] + 0.005


def test_03_longer_gated_span_costs_yield_not_fidelity():
    P = [p for p in pts("03") if p["checks"][0]["left"] == 1 and p["checks"][0]["paulis"] == {"1": "Z"}]
    P.sort(key=lambda p: p["checks"][0]["right"])
    P = [p for p in P if p["checks"][0]["right"] >= 3]
    ys = [p["yield"] for p in P]
    fs = [p["fidelity"] for p in P]
    assert all(a > b for a, b in zip(ys, ys[1:])), "yield should fall with every extra layer"
    assert max(fs) - min(fs) < 0.002, "fidelity should stay flat across the corridor"


def test_04_goal_requires_covering_the_hot_cnot():
    g = engine.effective_goal("04")
    hot_moment = 3
    winners = [p for p in pts("04") if meets(p, g)]
    assert winners and all(p["checks"][0]["left"] <= hot_moment < p["checks"][0]["right"] for p in winners)


def test_05_diminishing_returns():
    g = engine.effective_goal("05")
    P = pts("05")
    by_k = {k: [p for p in P if len(p["checks"]) == k] for k in (1, 2, 3, 4)}
    f_best = {k: best(v)["fidelity"] for k, v in by_k.items()}
    y_at_best = {k: best(v)["yield"] for k, v in by_k.items()}
    assert f_best[2] - f_best[1] > 0.01  # the second check still pays
    assert f_best[4] - f_best[2] < 0.002  # after that, fidelity barely moves
    assert y_at_best[2] - y_at_best[4] > 0.05  # while yield keeps falling
    assert all(len(p["checks"]) == 2 for p in P if meets(p, g))


def test_07_gated_checks_are_blind_to_readout():
    g = engine.effective_goal("07")
    P = pts("07")
    gated = best(P, lambda p: p["merged_checks"] == 0)
    assert gated["fidelity"] < engine.context("07").baseline["fidelity"] + 0.01
    assert all(p["merged_checks"] > 0 for p in P if meets(p, g))


def test_08_t_rule_blocks_some_placements_and_z_passes():
    lv = levels.get_level("08")
    blocked = propagate(lv["moments"], lv["n_qubits"], Check(left=2, right=3, paulis=((1, "X"),)))
    passed = propagate(lv["moments"], lv["n_qubits"], Check(left=2, right=3, paulis=((1, "Z"),)))
    assert not blocked.ok and blocked.error == "t_rule" and passed.ok


def test_09_t_series_protection_falls_with_t_count():
    ids = ["09a", "09b", "09c", "09d"]
    n_legal = [len(candidate_checks(levels.get_level(i))) for i in ids]
    f_best = [best(pts(i))["fidelity"] for i in ids]
    gain = [f - engine.context(i).baseline["fidelity"] for f, i in zip(f_best, ids)]
    assert all(a > b for a, b in zip(n_legal, n_legal[1:])), n_legal
    assert f_best[0] > f_best[1] > f_best[2] >= f_best[3] - 0.003, f_best
    assert gain[0] > gain[1] > gain[2] >= gain[3] - 0.003, gain


def test_10_par_can_be_beaten():
    par = load_or_build("10")["par"]["metrics"]
    assert any(p["fidelity"] > par["fidelity"] and p["yield"] > par["yield"] for p in pts("10"))
