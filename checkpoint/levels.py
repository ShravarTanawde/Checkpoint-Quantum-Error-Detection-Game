"""Level loading and validation.

A level is a JSON file in ``levels/``. Schema (see docs/level_format.md for the full description):

{
  "id": "01", "order": 1, "title": "...", "lesson": "one-line idea",
  "brief": "what the player is asked to do",
  "learning_moment": "what the numbers should show once solved",
  "hint": "...",
  "n_qubits": 2,
  "moments": [[["h", [0]]], [["cx", [0, 1]]], ...],
  "parts": {"paulis": ["Z"], "max_weight": 2},
  "budget": {"ancillas": 1},
  "goal": {"fidelity": 0.95, "min_yield": 0.80},
  "noise": {...},                 # see noise.NoiseParams.from_dict
  "par": "paulice" | "none",
  "landscape": {"max_checks": 2, "seed": 1},   # optional: max_singles, structured_per_k, random_per_k
  "slots": {"min": 1, "max": 4},              # optional: where check edges may go
  "series": optional group name (the T-count series)
}
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from .pauli_tools import PAULI_CHARS, SUPPORTED_GATES, count_t, is_clifford_circuit

ROOT = Path(__file__).resolve().parent.parent
LEVEL_DIR = ROOT / "levels"


class LevelError(ValueError):
    pass


def validate_level(level: dict) -> dict:
    for key in ("id", "title", "n_qubits", "moments", "parts", "budget", "goal", "noise"):
        if key not in level:
            raise LevelError(f"level {level.get('id', '?')}: missing key {key!r}")
    n = level["n_qubits"]
    for mi, moment in enumerate(level["moments"]):
        used: set[int] = set()
        for gate in moment:
            name, qubits = gate[0], gate[1]
            if name not in SUPPORTED_GATES:
                raise LevelError(f"level {level['id']}: unsupported gate {name!r} in moment {mi}")
            for q in qubits:
                if not 0 <= q < n:
                    raise LevelError(f"level {level['id']}: qubit {q} out of range in moment {mi}")
                if q in used:
                    raise LevelError(f"level {level['id']}: qubit {q} used twice in moment {mi}")
                used.add(q)
    for p in level["parts"]["paulis"]:
        if p not in PAULI_CHARS:
            raise LevelError(f"level {level['id']}: unknown Pauli part {p!r}")
    level.setdefault("par", "paulice" if is_clifford_circuit(level["moments"]) else "none")
    level.setdefault("landscape", {"max_checks": level["budget"]["ancillas"], "seed": 1})
    level["t_count"] = count_t(level["moments"])
    level["clifford"] = level["t_count"] == 0
    if level["par"] == "paulice" and not level["clifford"]:
        raise LevelError(f"level {level['id']}: qiskit-paulice par needs a Clifford payload")
    return level


@lru_cache(maxsize=None)
def _load_all() -> tuple[dict, ...]:
    levels = []
    for path in sorted(LEVEL_DIR.glob("*.json")):
        with open(path, encoding="utf-8") as f:
            level = json.load(f)
        levels.append(validate_level(level))
    levels.sort(key=lambda lv: (lv.get("order", 999), lv["id"]))
    return tuple(levels)


def all_levels() -> list[dict]:
    return list(_load_all())


def get_level(level_id: str) -> dict:
    for lv in _load_all():
        if lv["id"] == level_id:
            return lv
    raise KeyError(level_id)


def reload() -> None:
    _load_all.cache_clear()
