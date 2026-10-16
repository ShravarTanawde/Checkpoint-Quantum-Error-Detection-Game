"""Level-design tool: rebuild each level's landscape and print the numbers a designer needs.

Usage:  python scripts/calibrate_levels.py [level_id ...]

For every level it prints the unprotected baseline, par, the best fidelity overall and under the
level's yield floor, the best layout per number of checks and per Pauli type, and what fraction of
layouts meet the current goal. Use it whenever a level or its noise changes, then re-run
tests/test_level_lessons.py, which asserts that each level's learning moment still holds.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from checkpoint import levels  # noqa: E402
from checkpoint.engine import effective_goal  # noqa: E402
from checkpoint.landscape import load_or_build  # noqa: E402


def best(points, key="fidelity", min_yield=0.0):
    ok = [p for p in points if p["yield"] >= min_yield - 1e-9]
    return max(ok, key=lambda p: p[key]) if ok else None


def fmt(p):
    if p is None:
        return "none"
    return f"F={p['fidelity']:.4f} Y={p['yield']:.4f} cost={p['cost']}"


def pauli_types(p):
    return "".join(sorted({ch for c in p["checks"] for ch in c["paulis"].values()}))


def main(ids):
    for lv in levels.all_levels():
        if ids and lv["id"] not in ids:
            continue
        data = load_or_build(lv["id"], force=True)
        pts = data["points"]
        g = effective_goal(lv["id"])
        print(f"\n=== {lv['id']} {lv['title']}  ({data['meta']['valid_layouts']} valid layouts, {data['meta']['seconds']}s)")
        print(f"  baseline       {fmt(data['baseline'])}")
        par = data["par"]
        print(f"  par            {fmt(par['metrics']) if par.get('available') else par.get('reason')}")
        print(f"  best overall   {fmt(best(pts))}")
        print(f"  best Y>={g['min_yield']:.2f}  {fmt(best(pts, min_yield=g['min_yield']))}")
        for k in sorted({len(p['checks']) for p in pts}):
            sub = [p for p in pts if len(p["checks"]) == k]
            print(f"   k={k}: best {fmt(best(sub))} | best under floor {fmt(best(sub, min_yield=g['min_yield']))}")
        for t in sorted({pauli_types(p) for p in pts}):
            sub = [p for p in pts if pauli_types(p) == t]
            print(f"   types {t:3s}: best {fmt(best(sub))} | under floor {fmt(best(sub, min_yield=g['min_yield']))}")
        meet = [p for p in pts if p["fidelity"] >= g["fidelity"] and p["yield"] >= g["min_yield"]]
        print(f"  goal F>={g['fidelity']} Y>={g['min_yield']}: {len(meet)}/{len(pts)} layouts meet it")
        print(f"  candidates {data['meta']['candidate_single_checks']}")


if __name__ == "__main__":
    main(sys.argv[1:])
