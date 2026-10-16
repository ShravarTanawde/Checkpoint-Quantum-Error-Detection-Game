"""The brief's required experiment (steps 1 to 6), run outside the game.

    python experiments/brief_experiment.py                 # all noise models
    python experiments/brief_experiment.py --noise series  # one of: series, uniform, backend

Step 1  Payloads: one Clifford circuit and T-doped versions of it (T count 0, 2, 4, 8). Width and
        depth are written to the summary. The family is a mirror circuit (U then U-dagger), so the
        ideal output is the single bitstring 0000 and Hellinger fidelity equals the probability of
        the right answer. (Mirror circuits need T gates in T / T-dagger pairs, hence 2, 4, 8 rather
        than 1, 2, 4. A non-mirror circuit with T gates spreads its output over many bitstrings, and
        Hellinger fidelity of a spread distribution barely reacts to noise.)
Step 2  Reference: StabilizerState for the Clifford payload, Statevector for every payload; the two
        are cross-checked on the Clifford one. Fidelity measure: Hellinger fidelity of the data
        qubits' output distribution (what an experiment that measures them can see); the quantum
        state fidelity of the kept state is also recorded where post-selection uses ancillas only.
Step 3  Checks: qiskit-paulice on the Clifford payload for every number of checks it returns and
        for several target-qubit orders. For T-doped payloads (which paulice rejects): no checks,
        plus hand-made checks that obey the T rule (I or Z across every T), all legal single checks
        and pairs built from the best singles.
Step 4  Noise: "series" = the game's T-series noise (Z-biased); "uniform" = depolarizing 2-qubit
        noise p = 0.01, the analogue of the brief's NoiseModel(gate_noise=0.01); "backend" = derived
        from a seeded GenericBackendV2's calibration data. The organizers did not announce a common
        noise model, so these three are the models used.
Step 5  Measure: fidelity without checks, post-selected fidelity, kept-shot fraction, added
        ancillas, two-qubit gates and depth, for every configuration (results/<noise>/runs.csv).
Step 6  Compare: plots of fidelity and yield against T count, check count and placement, and the
        best trade-off under a stated rule: highest post-selected fidelity with yield >= 0.85,
        ties broken by lower cost; the Pareto front is reported as well (results/<noise>/summary.md).
"""

from __future__ import annotations

import argparse
import csv
import itertools
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from qiskit.providers.fake_provider import GenericBackendV2  # noqa: E402
from qiskit.quantum_info import StabilizerState, Statevector  # noqa: E402

from checkpoint.circuits import gate_depth  # noqa: E402
from checkpoint.engine import evaluate_layouts_ctx, make_context  # noqa: E402
from checkpoint.landscape import candidate_checks  # noqa: E402
from checkpoint.levels import validate_level  # noqa: E402
from checkpoint.metrics import pareto_front  # noqa: E402
from checkpoint.noise import NoiseParams  # noqa: E402
from checkpoint.par import paulice_variants  # noqa: E402

T_SITES = {0: ([], []), 2: ([1], []), 4: ([1], [2]), 8: ([1, 3], [0, 2])}
INV = {"t": "tdg", "tdg": "t", "s": "sdg", "sdg": "s"}
YIELD_FLOOR = 0.85
TARGET_ORDERS = [[0, 1, 2, 3], [3, 2, 1, 0], [1, 2, 0, 3], [2, 0, 3, 1]]


def payload_level(t_count: int) -> dict:
    sa, sb = T_SITES[t_count]
    first = [
        [["h", [0]], ["h", [2]]],
        [["cx", [0, 1]], ["cx", [2, 3]]],
        [["t", [q]] for q in sa],
        [["cx", [1, 2]]],
        [["t", [q]] for q in sb],
    ]
    moments = first + [[[INV.get(g[0], g[0]), g[1]] for g in m] for m in reversed(first)]
    return validate_level({
        "id": f"exp_t{t_count}", "title": f"T count {t_count}", "n_qubits": 4, "moments": moments,
        "parts": {"paulis": ["Z", "X"], "max_weight": 2}, "budget": {"ancillas": 2},
        "goal": {"fidelity": 0, "min_yield": 0}, "noise": {}, "par": "paulice" if t_count == 0 else "none",
    })


def noise_models() -> dict[str, NoiseParams]:
    backend = GenericBackendV2(num_qubits=12, seed=2026)
    return {
        "series": NoiseParams(p1=0.0005, p2=0.015, p_idle=0.002, p_readout=0.008, bias="Z", label="game T-series noise (Z-biased)"),
        "uniform": NoiseParams(p1=0.0005, p2=0.01, p_idle=0.001, p_readout=0.01, label="uniform depolarizing, p2 = 0.01"),
        "backend": NoiseParams.from_backend(backend, [0, 1, 2, 3], label="GenericBackendV2(12 qubits, seed 2026) calibration, layout [0,1,2,3]"),
    }


def reference_check(level: dict) -> dict:
    from checkpoint.circuits import payload

    qc = payload(level).circuit
    sv = Statevector(qc).probabilities_dict()
    out = {"statevector": {k: round(v, 12) for k, v in sv.items() if v > 1e-12}}
    if level["clifford"]:
        st = StabilizerState(qc).probabilities_dict()
        out["stabilizer"] = {k: round(v, 12) for k, v in st.items() if v > 1e-12}
        assert out["stabilizer"] == out["statevector"], "stabilizer and statevector references disagree"
    return out


def run_one(noise_name: str, params: NoiseParams, outdir: Path) -> dict:
    outdir.mkdir(parents=True, exist_ok=True)
    rows = []
    summary = {"noise": params.to_dict(), "payloads": {}}
    for tc in T_SITES:
        level = payload_level(tc)
        ctx = make_context(level, params)
        ref = reference_check(level)
        base = ctx.baseline
        summary["payloads"][tc] = {
            "width": level["n_qubits"], "depth": gate_depth(ctx.payload.circuit), "t_count": level["t_count"],
            "reference": ref, "baseline": base,
        }
        rows.append({"noise": noise_name, "t_count": tc, "method": "none", "targets": "", "k": 0, **base, "checks": "[]"})
        if level["clifford"]:
            for order in TARGET_ORDERS:
                for v in paulice_variants(ctx, target_qubits=order, seed=11):
                    rows.append({"noise": noise_name, "t_count": tc, "method": "paulice", "targets": "-".join(map(str, order)),
                                 "k": v["checks"], **v["metrics"], "checks": json.dumps(v["check_support"])})
        cands = candidate_checks(level)
        singles = evaluate_layouts_ctx(ctx, [[c] for c in cands])
        hand = [(c, m) for c, m in zip(cands, singles) if m is not None]
        top = sorted(range(len(hand)), key=lambda i: -hand[i][1]["fidelity"])[:16]
        top += [i for i in sorted(range(len(hand)), key=lambda i: -hand[i][1]["fidelity"] * hand[i][1]["yield"])[:16] if i not in top]
        pairs = [[hand[i][0], hand[j][0]] for i, j in itertools.combinations(top, 2)]
        pair_res = evaluate_layouts_ctx(ctx, pairs)
        for c, m in hand:
            rows.append({"noise": noise_name, "t_count": tc, "method": "hand", "targets": "", "k": 1, **m, "checks": json.dumps([c.to_dict()])})
        for lay, m in zip(pairs, pair_res):
            if m is not None:
                rows.append({"noise": noise_name, "t_count": tc, "method": "hand", "targets": "", "k": 2, **m, "checks": json.dumps([c.to_dict() for c in lay])})
        summary["payloads"][tc]["legal_single_checks"] = len(cands)

    fields = ["noise", "t_count", "method", "targets", "k", "fidelity", "yield", "state_fidelity", "ancillas", "extra_2q", "extra_depth", "cost", "merged_checks", "checks"]
    with open(outdir / "runs.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)

    lines = [f"# Brief experiment: {params.label}", "",
             f"Selection rule for the best trade-off: highest post-selected fidelity with yield >= {YIELD_FLOOR}, ties broken by lower cost.",
             "All numbers are exact (density matrix, readout applied analytically); no shot sampling.", "",
             "| T count | width | depth | legal single checks | fidelity, no checks | best (rule) fidelity | its yield | its cost | method | Pareto points |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    best_by_t = {}
    for tc in T_SITES:
        cand = [r for r in rows if r["t_count"] == tc and r["method"] != "none"]
        ok = [r for r in cand if r["yield"] >= YIELD_FLOOR]
        b = max(ok, key=lambda r: (r["fidelity"], -r["cost"])) if ok else None
        best_by_t[tc] = b
        P = summary["payloads"][tc]
        front = pareto_front(cand)
        lines.append(f"| {tc} | {P['width']} | {P['depth']} | {P['legal_single_checks']} | {P['baseline']['fidelity']:.4f} | "
                     + (f"{b['fidelity']:.4f} | {b['yield']:.3f} | {b['cost']} | {b['method']} |" if b else "none | | | |") + f" {len(front)} |")
    par_rows = [r for r in rows if r["method"] == "paulice"]
    if par_rows:
        lines += ["", "## qiskit-paulice on the Clifford payload (T count 0)", "",
                  "| target order | checks | fidelity | yield | cost |", "|---|---|---|---|---|"]
        for r in par_rows:
            lines.append(f"| {r['targets']} | {r['k']} | {r['fidelity']:.4f} | {r['yield']:.3f} | {r['cost']} |")
    (outdir / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    with open(outdir / "summary.json", "w", encoding="utf-8") as f:
        json.dump({**summary, "best_by_t": best_by_t}, f, indent=1, default=str)
    plot(rows, summary, outdir, params.label)
    return {"rows": rows, "summary": summary, "best_by_t": best_by_t}


def plot(rows, summary, outdir: Path, label: str):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    tcs = list(T_SITES)
    base = [summary["payloads"][t]["baseline"]["fidelity"] for t in tcs]
    best = []
    for t in tcs:
        ok = [r for r in rows if r["t_count"] == t and r["method"] != "none" and r["yield"] >= YIELD_FLOOR]
        best.append(max(r["fidelity"] for r in ok) if ok else np.nan)
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.plot(tcs, base, "o-", label="no checks", color="#8a949e")
    ax.plot(tcs, best, "o-", label=f"best layout, yield >= {YIELD_FLOOR}", color="#d08a1c")
    ax.set_xlabel("T count (T + T-dagger)")
    ax.set_ylabel("Hellinger fidelity")
    ax.set_xticks(tcs)
    ax.set_title(f"Protection vs T count\n{label}", fontsize=9)
    ax.legend()
    fig.tight_layout()
    fig.savefig(outdir / "fidelity_vs_tcount.png", dpi=150)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(6.5, 4.5))
    colors = ["#1f77b4", "#2ca02c", "#d62728", "#9467bd"]
    for t, col in zip(tcs, colors):
        pts = [r for r in rows if r["t_count"] == t and r["method"] == "hand"]
        ax.scatter([p["yield"] for p in pts], [p["fidelity"] for p in pts], s=5, alpha=0.25, color=col)
        front = [pts[i] for i in pareto_front(pts)]
        front.sort(key=lambda p: p["yield"])
        ax.plot([p["yield"] for p in front], [p["fidelity"] for p in front], "-", color=col, label=f"T count {t}: Pareto front")
    par = [r for r in rows if r["method"] == "paulice" and r["k"] > 0]
    if par:
        ax.scatter([p["yield"] for p in par], [p["fidelity"] for p in par], marker="D", s=22, facecolors="none", edgecolors="k", label="qiskit-paulice (T count 0)")
    ax.axvline(YIELD_FLOOR, color="#999", ls=":", lw=1)
    ax.set_xlabel("yield (kept-shot fraction)")
    ax.set_ylabel("post-selected Hellinger fidelity")
    ax.set_title(f"Fidelity vs yield, every evaluated layout\n{label}", fontsize=9)
    ax.legend(fontsize=7)
    fig.tight_layout()
    fig.savefig(outdir / "tradeoff.png", dpi=150)
    plt.close(fig)

    if par:
        fig, axes = plt.subplots(1, 2, figsize=(8, 3.4))
        for order in TARGET_ORDERS:
            key = "-".join(map(str, order))
            rr = sorted([r for r in rows if r["method"] == "paulice" and r["targets"] == key], key=lambda r: r["k"])
            axes[0].plot([r["k"] for r in rr], [r["fidelity"] for r in rr], "o-", label=key)
            axes[1].plot([r["k"] for r in rr], [r["yield"] for r in rr], "o-", label=key)
        axes[0].set_xlabel("number of checks"); axes[0].set_ylabel("fidelity")
        axes[1].set_xlabel("number of checks"); axes[1].set_ylabel("yield")
        axes[1].legend(title="target order", fontsize=7)
        fig.suptitle(f"qiskit-paulice sweep on the Clifford payload\n{label}", fontsize=9)
        fig.tight_layout()
        fig.savefig(outdir / "paulice_sweep.png", dpi=150)
        plt.close(fig)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--noise", choices=["series", "uniform", "backend", "all"], default="all")
    args = ap.parse_args()
    models = noise_models()
    names = list(models) if args.noise == "all" else [args.noise]
    for name in names:
        out = run_one(name, models[name], ROOT / "experiments" / "results" / name)
        print(f"[{name}] wrote experiments/results/{name}/ ({len(out['rows'])} configurations)")
        for t, b in out["best_by_t"].items():
            if b is None:
                print(f"   T={t}: no layout reaches yield {YIELD_FLOOR}")
            else:
                print(f"   T={t}: best F={b['fidelity']:.4f} Y={b['yield']:.3f} cost={b['cost']} ({b['method']})")


if __name__ == "__main__":
    main()
