"""The solution landscape behind the results-screen histograms and trade-off map.

Zachtronics fills its histograms with other players' solutions. Checkpoint has no player base, so
each level's histograms are filled by evaluating many valid layouts offline with the same engine:
  * every legal single check (all left slots, right slots and left-edge Paulis the level's parts
    allow), exhaustively unless there are more than max_singles;
  * multi-check layouts up to the ancilla budget: combinations of the best singles plus a seeded
    random sample, dropping any that fail Verify (interfering checks).
The output records whether it was exhaustive, how many layouts were evaluated and the seed, and the
results screen says so. Results are cached in data/landscapes/<level id>.json, keyed by a hash of
the level file, and rebuilt automatically when the level changes.
"""

from __future__ import annotations

import hashlib
import itertools
import json
import random
import time
from pathlib import Path

from . import levels as levels_mod
from .metrics import pareto_front
from .pauli_tools import Check, check_slots_allowed, propagate

DATA_DIR = levels_mod.ROOT / "data" / "landscapes"
DERIVED_KEYS = {"t_count", "clifford"}
# Player-facing text and tutorial hints: they cannot change any score, so editing them must not
# invalidate the cached landscape.
TEXT_KEYS = {"title", "lesson", "brief", "learning_moment", "hint", "reflection", "noise_note", "par_note", "series", "tutorial",
             "solution", "show_outputs"}


def level_hash(level: dict) -> str:
    core = {k: v for k, v in level.items() if k not in DERIVED_KEYS | TEXT_KEYS}
    return hashlib.sha256(json.dumps(core, sort_keys=True).encode()).hexdigest()[:16]


def candidate_checks(level: dict) -> list[Check]:
    n, moments = level["n_qubits"], level["moments"]
    m = len(moments)
    paulis = level["parts"]["paulis"]
    max_w = min(level["parts"].get("max_weight", n), n)
    slots = level.get("slots") or {}
    lo, hi = slots.get("min", 0), slots.get("max", m)
    out = []
    for left in range(lo, hi):
        for right in range(left + 1, hi + 1):
            for w in range(1, max_w + 1):
                for qs in itertools.combinations(range(n), w):
                    for ps in itertools.product(paulis, repeat=w):
                        c = Check(left=left, right=right, paulis=tuple(zip(qs, ps)))
                        if propagate(moments, n, c).ok:
                            out.append(c)
    return out


def _evaluate(level_id: str, cands: list[Check], layouts: list[tuple[int, ...]], verbose: bool) -> list[dict]:
    from .engine import evaluate_layouts

    points = []
    batch = 64
    for start in range(0, len(layouts), batch):
        chunk = layouts[start : start + batch]
        res = evaluate_layouts(level_id, [[cands[i] for i in combo] for combo in chunk])
        for combo, m in zip(chunk, res):
            if m is not None:
                points.append({"checks": [cands[i].to_dict() for i in combo], "_idx": list(combo), **m})
        if verbose:
            print(f"  {level_id}: {min(start + batch, len(layouts))}/{len(layouts)} layouts", flush=True)
    return points


def build_landscape(level_id: str, seed: int | None = None, verbose: bool = False) -> dict:
    """Singles exhaustively (up to max_singles), then multi-check layouts.

    Multi-check layouts come from two sources per number of checks k:
      * structured: combinations of the best single checks (top by fidelity and by fidelity x yield),
        which is where good layouts live and what random sampling tends to miss;
      * random: a seeded sample over all candidates, so the histogram also shows ordinary layouts.
    The best layout found is therefore a strong heuristic optimum, not a proven one; the results
    screen and the report say so.
    """
    from .engine import context

    level = levels_mod.get_level(level_id)
    cfg = level.get("landscape", {})
    seed = cfg.get("seed", 1) if seed is None else seed
    max_checks = min(cfg.get("max_checks", level["budget"]["ancillas"]), level["budget"]["ancillas"])
    max_singles = cfg.get("max_singles", 2500)
    structured_per_k = cfg.get("structured_per_k", 300)
    random_per_k = cfg.get("random_per_k", 120)
    rng = random.Random(seed)
    t0 = time.time()

    cands = candidate_checks(level)
    single_idx = list(range(len(cands)))
    exhaustive_singles = len(single_idx) <= max_singles
    if not exhaustive_singles:
        single_idx = sorted(rng.sample(single_idx, max_singles))
    points = _evaluate(level_id, cands, [(i,) for i in single_idx], verbose)

    multi_total = 0
    if max_checks >= 2 and len(cands) >= 2:
        by_f = sorted(points, key=lambda p: -p["fidelity"])
        by_fy = sorted(points, key=lambda p: -p["fidelity"] * p["yield"])
        top = []
        for p in by_f[:16] + by_fy[:16]:
            if p["_idx"][0] not in top:
                top.append(p["_idx"][0])
        seen: set[tuple[int, ...]] = set()
        for k in range(2, max_checks + 1):
            structured = [c for c in itertools.combinations(sorted(top), k)]
            if len(structured) > structured_per_k:
                structured = rng.sample(structured, structured_per_k)
            seen.update(tuple(sorted(c)) for c in structured)
            got, tries = 0, 0
            while got < random_per_k and tries < random_per_k * 50:
                tries += 1
                combo = tuple(sorted(rng.sample(range(len(cands)), k)))
                if combo not in seen:
                    seen.add(combo)
                    got += 1
        multi = sorted(seen, key=lambda c: (len(c), c))
        multi_total = len(multi)
        points += _evaluate(level_id, cands, multi, verbose)
    for p in points:
        p.pop("_idx", None)

    front = pareto_front(points)
    ctx = context(level_id)
    from .par import get_par

    out = {
        "level_id": level_id,
        "level_hash": level_hash(level),
        "noise": ctx.params.to_dict(),
        "baseline": ctx.baseline,
        "par": get_par(level_id),
        "points": points,
        "pareto": front,
        "meta": {
            "candidate_single_checks": len(cands),
            "single_checks_exhaustive": exhaustive_singles,
            "multi_check_layouts_sampled": multi_total,
            "layouts_evaluated": len(single_idx) + multi_total,
            "valid_layouts": len(points),
            "seed": seed,
            "max_checks": max_checks,
            "seconds": round(time.time() - t0, 1),
            "method": "exact density matrix (Aer), readout applied analytically, no shot sampling",
        },
    }
    return out


def landscape_path(level_id: str) -> Path:
    return DATA_DIR / f"{level_id}.json"


def load_or_build(level_id: str, force: bool = False, verbose: bool = False) -> dict:
    level = levels_mod.get_level(level_id)
    path = landscape_path(level_id)
    if path.exists() and not force:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        if data.get("level_hash") == level_hash(level):
            return data
    data = build_landscape(level_id, verbose=verbose)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f)
    tmp.replace(path)  # atomic, so a reader never sees a half-written file
    return data
