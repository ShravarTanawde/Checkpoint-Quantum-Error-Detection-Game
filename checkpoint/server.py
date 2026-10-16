"""Local web server: the game's browser front end talks to the engine through this API.

Run:  python -m checkpoint.server            (then open http://127.0.0.1:8000)
      python -m checkpoint.server --port 9000 --host 0.0.0.0

Endpoints
  GET  /api/levels                 level list for the select screen
  GET  /api/levels/{id}            full level + effective goal + gate noise badges + baseline + par
  POST /api/propagate              {level_id, check}            -> right edge or why it is illegal
  POST /api/preview                {level_id, checks}           -> Qiskit source + static cost, no simulation
  POST /api/evaluate               {level_id, checks}           -> Verify + exact noisy metrics + goal
  GET  /api/landscape/{id}         histogram and trade-off data (cached in data/landscapes)
  GET  /api/series/{name}          per-puzzle comparison for a level series (e.g. the T-count study)
  GET  /manual                     the user manual (web/manual.html)
"""

from __future__ import annotations

import argparse
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import engine, levels
from .circuits import build_checked, gate_depth, two_qubit_count
from .codegen import qiskit_source
from .landscape import load_or_build
from .par import get_par
from .pauli_tools import check_slots_allowed, propagate

WEB = Path(__file__).resolve().parent.parent / "web"
app = FastAPI(title="Checkpoint", version="0.1.0")


class CheckBody(BaseModel):
    level_id: str
    check: dict


class ChecksBody(BaseModel):
    level_id: str
    checks: list[dict]


def _level_or_404(level_id: str) -> dict:
    try:
        return levels.get_level(level_id)
    except KeyError:
        raise HTTPException(404, f"no level {level_id!r}")


@app.get("/api/levels")
def api_levels():
    out = []
    for lv in levels.all_levels():
        out.append({
            "id": lv["id"], "order": lv.get("order"), "title": lv["title"], "lesson": lv.get("lesson", ""),
            "series": lv.get("series"), "n_qubits": lv["n_qubits"], "t_count": lv["t_count"],
            "budget": lv["budget"], "par": lv["par"],
        })
    return out


@app.get("/api/levels/{level_id}")
def api_level(level_id: str):
    lv = _level_or_404(level_id)
    ctx = engine.context(level_id)
    p = ctx.params
    gate_noise = []
    for mi, moment in enumerate(lv["moments"]):
        for gi, g in enumerate(moment):
            q = g[1]
            prob = p.p2_for(q[0], q[1]) if len(q) == 2 else p.p1
            gate_noise.append({"moment": mi, "index": gi, "p": prob})
    return {
        **{k: v for k, v in lv.items()},
        "goal": engine.effective_goal(level_id),
        "noise_params": p.to_dict(),
        "gate_noise": gate_noise,
        "readout": [p.readout_overrides.get(q, p.p_readout) for q in range(lv["n_qubits"])],
        "baseline": ctx.baseline,
        "par": get_par(level_id),
        "correct": engine.correct_result(ctx),
    }


@app.post("/api/propagate")
def api_propagate(body: CheckBody):
    _level_or_404(body.level_id)
    return engine.propagate_check(body.level_id, body.check)


@app.post("/api/preview")
def api_preview(body: ChecksBody):
    lv = _level_or_404(body.level_id)
    ctx = engine.context(body.level_id)
    checks = engine.parse_checks(body.checks)
    props = [propagate(lv["moments"], lv["n_qubits"], c) for c in checks]
    ok = [(c, pr) for c, pr in zip(checks, props) if pr.ok and not check_slots_allowed(lv, c)]
    built = build_checked(lv, [c for c, _ in ok], [pr for _, pr in ok])
    extra_2q = two_qubit_count(built.circuit) - ctx.payload_2q
    return {
        "code": qiskit_source(lv, built),
        "cost": {"ancillas": built.n_ancilla, "extra_2q": extra_2q, "extra_depth": gate_depth(built.circuit) - ctx.payload_depth,
                 "cost": built.n_ancilla + extra_2q},
        "problems": engine.rule_problems(lv, checks),
        "checks": [{"right_paulis": {str(q): v for q, v in pr.right.items()}, "sign": pr.sign, "ok": pr.ok,
                    "can_merge": pr.can_merge, "merged": pr.merged, "message": pr.message,
                    "trail": [{str(q): v for q, v in t.items()} for t in engine.check_trail(lv, c)]}
                   for c, pr in zip(checks, props)],
        "coverage": engine.coverage(lv, ctx.params, [c for c, _ in ok]),
    }


@app.post("/api/evaluate")
def api_evaluate(body: ChecksBody):
    _level_or_404(body.level_id)
    return engine.evaluate(body.level_id, body.checks)


@app.get("/api/landscape/{level_id}")
def api_landscape(level_id: str):
    _level_or_404(level_id)
    data = load_or_build(level_id)
    return {k: data[k] for k in ("level_id", "points", "pareto", "baseline", "par", "meta", "noise")}


@app.get("/api/series/{name}")
def api_series(name: str):
    """For each puzzle in a series: T count, depth, no-check fidelity, and the best evaluated layout
    whose yield meets that puzzle's yield target (ties broken by lower cost)."""
    rows = []
    for lv in levels.all_levels():
        if lv.get("series") != name:
            continue
        ctx = engine.context(lv["id"])
        floor = engine.effective_goal(lv["id"])["min_yield"]
        land = load_or_build(lv["id"])
        cands = [p for p in land["points"] if p["yield"] >= floor - 1e-9] + [ctx.baseline]
        best = max(cands, key=lambda p: (p["fidelity"], -p["cost"]))
        rows.append({
            "id": lv["id"], "title": lv["title"], "t_count": lv["t_count"], "depth": ctx.payload_depth,
            "baseline_fidelity": ctx.baseline["fidelity"], "yield_floor": floor,
            "best_fidelity": best["fidelity"], "best_yield": best["yield"], "best_cost": best["cost"],
            "layouts_evaluated": land["meta"]["valid_layouts"],
        })
    if not rows:
        raise HTTPException(404, f"no series {name!r}")
    return {"series": name, "rows": rows}


@app.get("/")
def index():
    return FileResponse(WEB / "index.html")


@app.get("/manual")
def manual():
    return FileResponse(WEB / "manual.html")


app.mount("/static", StaticFiles(directory=WEB), name="static")


def main():
    ap = argparse.ArgumentParser(description="Run the Checkpoint game server.")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()
    import uvicorn

    print(f"Checkpoint running at http://{args.host}:{args.port}")
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
