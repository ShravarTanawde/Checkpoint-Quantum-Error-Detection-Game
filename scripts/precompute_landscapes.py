"""Rebuild every level's results-screen landscape (data/landscapes/*.json).

    python scripts/precompute_landscapes.py          # rebuild all
    python scripts/precompute_landscapes.py 05 10    # rebuild some

The server builds a missing or stale landscape on first request anyway (keyed by a hash of the
level file), so this script is for shipping fresh data and for timing.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from checkpoint import levels  # noqa: E402
from checkpoint.landscape import load_or_build  # noqa: E402


def main(ids):
    t0 = time.time()
    for lv in levels.all_levels():
        if ids and lv["id"] not in ids:
            continue
        d = load_or_build(lv["id"], force=True)
        print(f"{lv['id']:>4} {lv['title']:<22} {d['meta']['valid_layouts']:>5} layouts  {d['meta']['seconds']:>5}s")
    print(f"done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main(sys.argv[1:])
