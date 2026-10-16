"""Public entry point: everything the server, the precompute script and the experiments call.

evaluate(level_id, checks)  ->  legality, Verify (noiseless), metrics (noisy, exact), goal status
propagate_check(level_id, check)  ->  the right edge the board should draw, or why it is illegal
evaluate_layouts(level, layouts)  ->  batch metrics for many layouts (used by landscape.py)
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import numpy as np
from qiskit.quantum_info import DensityMatrix, Statevector, state_fidelity

from . import levels as levels_mod
from .circuits import BuiltCircuit, build_checked, gate_depth, payload, two_qubit_count
from .metrics import hellinger_fidelity, postselect
from .noise import NoiseParams
from .pauli_tools import Check, Propagation, check_slots_allowed, propagate
from .simulate import exact_noisy, noiseless_probs

LETTERS = "ABCDEFGHIJ"


@dataclass
class LevelContext:
    level: dict
    params: NoiseParams
    payload: BuiltCircuit
    ideal_dist: np.ndarray  # ideal output distribution of the data qubits
    ideal_state: Statevector
    payload_2q: int
    payload_depth: int
    baseline: dict
    baseline_dist: np.ndarray | None = None  # output distribution of the data qubits with no checks


def _metrics_from_probs(ctx: LevelContext, built: BuiltCircuit, probs: np.ndarray, rho=None) -> dict:
    n = ctx.level["n_qubits"]
    y, dist = postselect(probs, built.n_total, built.syndrome_sets, list(range(n)))
    fid = hellinger_fidelity(ctx.ideal_dist, dist) if y > 0 else 0.0
    sfid = None
    if rho is not None and all(len(s) == 1 and s[0] >= n for s in built.syndrome_sets):
        sub = rho[: 2**n, : 2**n]  # ancillas (the high qubits) all in |0>
        tr = float(np.real(np.trace(sub)))
        if tr > 0:
            sfid = float(state_fidelity(DensityMatrix(sub / tr), ctx.ideal_state, validate=False))
    extra_2q = two_qubit_count(built.circuit) - ctx.payload_2q
    return {
        "fidelity": round(fid, 6),
        "yield": round(y, 6),
        "state_fidelity": None if sfid is None else round(sfid, 6),
        "ancillas": built.n_ancilla,
        "extra_2q": extra_2q,
        "extra_depth": gate_depth(built.circuit) - ctx.payload_depth,
        "cost": built.n_ancilla + extra_2q,
    }


def make_context(level: dict, params: NoiseParams) -> LevelContext:
    """A context for any level dict and any noise parameters (used by the experiments)."""
    pl = payload(level)
    sv = Statevector(pl.circuit)
    ideal = np.asarray(sv.probabilities())
    ctx = LevelContext(
        level=level, params=params, payload=pl, ideal_dist=ideal, ideal_state=sv,
        payload_2q=two_qubit_count(pl.circuit), payload_depth=gate_depth(pl.circuit), baseline={},
    )
    res = exact_noisy([pl], params, keep_rho=True)[0]
    ctx.baseline = _metrics_from_probs(ctx, pl, res["probs"], res["rho"])
    ctx.baseline_dist = postselect(res["probs"], pl.n_total, pl.syndrome_sets, list(range(level["n_qubits"])))[1]
    return ctx


def outcome_label(index: int, n: int) -> str:
    """Bits of a data-qubit outcome written q0 first (so "01" means q0 = 0, q1 = 1)."""
    return "".join(str((index >> q) & 1) for q in range(n))


def correct_result(ctx: LevelContext) -> dict:
    """What every correct (noiseless) result has in common, in plain terms.

    A rule is a set of qubits whose measured bits always have the same parity in the ideal output.
    Rules are reduced to an independent set (smallest first), so for example "q1 = 0" and "q0 = q3"
    are listed but not their combination. A qubit that appears in no rule is random.
    """
    n = ctx.level["n_qubits"]
    support = [i for i, p in enumerate(ctx.ideal_dist) if p > 1e-9]
    if len(support) == 1:
        return {"single": outcome_label(support[0], n), "rules": [], "random": []}
    constant = []
    for mask in range(1, 2**n):
        values = {bin(i & mask).count("1") % 2 for i in support}
        if len(values) == 1:
            constant.append((bin(mask).count("1"), mask, values.pop()))
    basis, rules = [], []
    for _, mask, value in sorted(constant):
        reduced = mask
        for b in basis:  # Gaussian elimination over GF(2): skip rules implied by earlier ones
            reduced = min(reduced, reduced ^ b)
        if reduced == 0:
            continue
        basis.append(reduced)
        qs = [q for q in range(n) if mask >> q & 1]
        if len(qs) == 1:
            text = f"q{qs[0]} = {value}"
        elif len(qs) == 2:
            text = f"q{qs[0]} {'=' if value == 0 else '≠'} q{qs[1]}"
        else:
            text = f"{' + '.join(f'q{q}' for q in qs)} is {'even' if value == 0 else 'odd'}"
        rules.append({"qubits": qs, "value": value, "text": text})
    used = {q for r in rules for q in r["qubits"]}
    return {"single": None, "rules": rules, "random": [q for q in range(n) if q not in used]}


def outputs(ctx: LevelContext, kept: np.ndarray) -> list[dict]:
    """Ideal, no-check and kept probabilities of every data-qubit outcome that matters."""
    n = ctx.level["n_qubits"]
    rows = []
    for i in range(2**n):
        ideal, base, k = float(ctx.ideal_dist[i]), float(ctx.baseline_dist[i]), float(kept[i])
        if ideal > 1e-9 or base > 5e-4 or k > 5e-4:
            rows.append({"bits": outcome_label(i, n), "ideal": round(ideal, 6), "baseline": round(base, 6), "kept": round(k, 6), "correct": ideal > 1e-9})
    return rows


@lru_cache(maxsize=None)
def context(level_id: str) -> LevelContext:
    level = levels_mod.get_level(level_id)
    return make_context(level, NoiseParams.from_dict(level["noise"]))


def effective_goal(level_id: str) -> dict:
    """The level's goal, with "beat_par" resolved to par's own fidelity and yield."""
    level = levels_mod.get_level(level_id)
    g = dict(level["goal"])
    if g.get("beat_par"):
        from .par import get_par

        par = get_par(level_id)
        if par.get("available"):
            g["fidelity"] = par["metrics"]["fidelity"]
            g["min_yield"] = par["metrics"]["yield"]
    return g


def parse_checks(raw: list[dict]) -> list[Check]:
    return [Check.from_dict(r) for r in raw]


def rule_problems(level: dict, checks: list[Check]) -> list[str]:
    problems = []
    budget = level["budget"]["ancillas"]
    if len(checks) > budget:
        extra = len(checks) - budget
        problems.append(
            f"This puzzle allows {budget} check{'s' if budget != 1 else ''}, but {len(checks)} are placed. "
            f"Remove {extra} check{'s' if extra != 1 else ''} to continue."
        )
    allowed = set(level["parts"]["paulis"])
    max_w = level["parts"].get("max_weight", level["n_qubits"])
    for i, c in enumerate(checks):
        for _, p in c.paulis:
            if p not in allowed:
                problems.append(f"Check {LETTERS[i]} uses {p}, which is not available in this puzzle. Choose one of the highlighted check types.")
        if c.weight > max_w:
            problems.append(f"Check {LETTERS[i]} starts on {c.weight} qubits, but this puzzle allows at most {max_w}. Remove a Pauli from its start edge.")
        slot_msg = check_slots_allowed(level, c)
        if slot_msg:
            problems.append(f"Check {LETTERS[i]}: {slot_msg}")
    return problems


def check_trail(level: dict, check: Check) -> list[dict[int, str]]:
    """The check's Pauli at every slot from its start edge to its end edge (inclusive).

    Entry j is the Pauli at slot check.left + j. Used by the board to draw the trail and by
    coverage(). Assumes the check is legal; an illegal one gets an empty trail.
    """
    first = propagate(level["moments"], level["n_qubits"], check)
    if not first.ok:
        return []
    out = [{q: p for q, p in check.paulis}]
    for k in range(check.left + 1, check.right + 1):
        out.append(propagate(level["moments"], level["n_qubits"], Check(left=check.left, right=k, paulis=check.paulis)).right)
    return out


def _anticommutes(error: dict[int, str], pauli: dict[int, str]) -> bool:
    clashes = sum(1 for q, e in error.items() if e != "I" and q in pauli and pauli[q] != e)
    return clashes % 2 == 1


def coverage(level: dict, params: NoiseParams, checks: list[Check]) -> list[dict]:
    """For every two-qubit payload gate: the share of its error probability the checks would flag.

    A gate in moment m adds a Pauli error right after itself (uniform over the 15 two-qubit Paulis,
    or over IZ, ZI, ZZ when the noise is Z-biased; see noise.py). Check i flags that error exactly
    when its span contains the gate (left <= m < right) and the error anticommutes with the check's
    Pauli at slot m + 1; the run is discarded if any check flags it. This is a single-fault count,
    so it describes what the layout can see, not the post-selected fidelity.
    """
    from .noise import ALL_PAULI_2Q, Z_PAULI_2Q

    labels = Z_PAULI_2Q if params.bias == "Z" else ALL_PAULI_2Q
    trails = [(c, check_trail(level, c)) for c in checks]
    out = []
    for m, moment in enumerate(level["moments"]):
        for gi, (name, qs) in enumerate(moment):
            if len(qs) != 2:
                continue
            a, b = qs
            seen = 0
            for lab in labels:
                err = {a: lab[0], b: lab[1]}
                if any(t and c.left <= m < c.right and _anticommutes(err, t[m + 1 - c.left]) for c, t in trails):
                    seen += 1
            out.append({"moment": m, "index": gi, "p": params.p2_for(a, b), "seen": seen / len(labels)})
    return out


def propagate_check(level_id: str, raw: dict) -> dict:
    level = levels_mod.get_level(level_id)
    c = Check.from_dict(raw)
    pr = propagate(level["moments"], level["n_qubits"], c)
    return {
        "ok": pr.ok and not check_slots_allowed(level, c), "right": {str(q): p for q, p in pr.right.items()}, "sign": pr.sign,
        "error": pr.error or ("slots" if check_slots_allowed(level, c) else None),
        "message": pr.message or check_slots_allowed(level, c), "blocked_at": pr.blocked_at,
        "can_merge": pr.can_merge, "merged": pr.merged,
    }


def _verify(ctx: LevelContext, built: BuiltCircuit, conflicts: list[tuple[int, int]] | None = None) -> dict:
    """Noiseless run: the output must be the payload's and no check may fire.

    conflicts: pairs of checks already confirmed to interfere (see _conflicting_pairs), used only to
    word the message; the pass/fail decision never depends on it.
    """
    n = ctx.level["n_qubits"]
    probs = noiseless_probs(built)
    y, dist = postselect(probs, built.n_total, built.syndrome_sets, list(range(n)))
    msgs = []
    fire = []
    from .metrics import bits_table

    bits = bits_table(built.n_total)
    for i, s in enumerate(built.syndrome_sets):
        p_fire = float(probs[(np.bitwise_xor.reduce(bits[:, list(s)], axis=1) if len(s) > 1 else bits[:, s[0]]) == 1].sum())
        fire.append(round(p_fire, 6))
        if p_fire > 1e-9:
            msgs.append(f"Check {LETTERS[i]} flags {p_fire:.0%} of runs even with noise turned off.")
    if msgs:
        msgs.append("A check should not reject a clean run.")
        if not conflicts:
            msgs.append("It may conflict with another check: inspect where their Pauli edges cross, then move or remove one check.")
    for i, j in conflicts or []:
        msgs.append(
            f"Checks {LETTERS[i]} and {LETTERS[j]} are incompatible in this span: together, they make a check flag even when "
            f"the circuit has no noise. Move one edge, change a Pauli, or remove one check, then Verify again."
        )
    fid = hellinger_fidelity(ctx.ideal_dist, dist) if y > 0 else 0.0
    if y > 1e-9 and fid < 1 - 1e-9:
        msgs.append("The checked circuit no longer produces the intended output when noise is off. Change or remove the check that caused the change, then Verify again.")
    passed = not msgs
    if passed:
        msgs.append(
            "Ideal-circuit check passed. The added checks preserve the intended output, and none flags a run when the "
            "circuit is noiseless. You can now test the layout under noise."
        )
    return {"passed": passed, "messages": msgs, "fire_probs": fire, "conflicts": [list(p) for p in conflicts or []]}


def _conflicting_pairs(ctx: LevelContext, checks: list[Check], props: list[Propagation]) -> list[tuple[int, int]]:
    """Pairs of checks that fire on a noiseless run when placed together.

    A single legal check never fires on its own (tested), so a pair that fires is confirmed
    interference: one check's edges anticommute with the other's propagated Pauli inside its span.
    """
    pairs = []
    for i in range(len(checks)):
        for j in range(i + 1, len(checks)):
            built = build_checked(ctx.level, [checks[i], checks[j]], [props[i], props[j]])
            if any(p > 1e-9 for p in _verify(ctx, built)["fire_probs"]):
                pairs.append((i, j))
    return pairs


def evaluate(level_id: str, raw_checks: list[dict], include_par: bool = True) -> dict:
    ctx = context(level_id)
    level = ctx.level
    checks = parse_checks(raw_checks)
    props = [propagate(level["moments"], level["n_qubits"], c) for c in checks]
    check_info = []
    problems = rule_problems(level, checks)
    for i, (c, pr) in enumerate(zip(checks, props)):
        check_info.append({
            "letter": LETTERS[i], **c.to_dict(), "ok": pr.ok,
            "right_paulis": {str(q): p for q, p in pr.right.items()}, "sign": pr.sign, "message": pr.message,
            "can_merge": pr.can_merge, "merged": pr.merged,
        })
        if not pr.ok:
            problems.append(f"Check {LETTERS[i]}: {pr.message}")
    out = {
        "level_id": level_id, "checks": check_info, "valid": not problems, "problems": problems,
        "baseline": ctx.baseline, "noise": ctx.params.to_dict(), "goal": effective_goal(level_id),
        "verify": None, "metrics": None,
    }
    if include_par:
        from .par import get_par

        out["par"] = get_par(level_id)
    if problems:
        return out
    built = build_checked(level, checks, props)
    out["verify"] = _verify(ctx, built)
    if not out["verify"]["passed"]:
        if len(checks) > 1 and any(p > 1e-9 for p in out["verify"]["fire_probs"]):
            out["verify"] = _verify(ctx, built, conflicts=_conflicting_pairs(ctx, checks, props))
        return out
    res = exact_noisy([built], ctx.params, keep_rho=True)[0]
    m = _metrics_from_probs(ctx, built, res["probs"], res["rho"])
    m["merged_checks"] = sum(1 for p in props if p.merged)
    out["metrics"] = m
    out["outputs"] = outputs(ctx, postselect(res["probs"], built.n_total, built.syndrome_sets, list(range(level["n_qubits"])))[1])
    g = out["goal"]
    out["goal"].update({
        "fidelity_ok": m["fidelity"] >= g["fidelity"] - 1e-9,
        "yield_ok": m["yield"] >= g["min_yield"] - 1e-9,
    })
    out["goal"]["met"] = out["goal"]["fidelity_ok"] and out["goal"]["yield_ok"]
    return out


def evaluate_layouts(level_id: str, layouts: list[list[Check]], verify: bool = True) -> list[dict | None]:
    """Metrics for many layouts at once. Returns None for layouts that are illegal or fail Verify."""
    return evaluate_layouts_ctx(context(level_id), layouts, verify)


def evaluate_layouts_ctx(ctx: LevelContext, layouts: list[list[Check]], verify: bool = True) -> list[dict | None]:
    level = ctx.level
    builts, owners = [], []
    for li, checks in enumerate(layouts):
        props = [propagate(level["moments"], level["n_qubits"], c) for c in checks]
        if not all(p.ok for p in props) or any(check_slots_allowed(level, c) for c in checks):
            continue
        built = build_checked(level, checks, props)
        if verify and len(checks) > 1 and not _verify(ctx, built)["passed"]:
            continue
        builts.append((built, sum(1 for p in props if p.merged)))
        owners.append(li)
    results: list[dict | None] = [None] * len(layouts)
    if builts:
        sims = exact_noisy([b for b, _ in builts], ctx.params, keep_rho=False)
        for (built, n_merged), li, s in zip(builts, owners, sims):
            results[li] = {**_metrics_from_probs(ctx, built, s["probs"]), "merged_checks": n_merged}
    return results
