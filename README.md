# Checkpoint

Checkpoint is a puzzle game about quantum error detection with spacetime checks, built for the Qiskit
Fall Fest 2026 Hackathon Advanced Track. Each puzzle gives you a noisy quantum circuit and asks you to
place checks that can flag certain errors. Flagged runs are discarded, not repaired.

The challenge is to find useful checks without throwing away too many runs or adding too much circuit
overhead. Checkpoint uses Qiskit Aer to calculate three metrics: **Fidelity**, how closely the kept
measurement results match the ideal results; **Yield**, the fraction of runs kept; and **Cost**, the
number of ancillas plus extra two-qubit gates. Extra circuit depth is reported separately.

As in Zachtronics games, the three are optimised separately, and the results screen shows where your
layout sits among every other layout the engine evaluated, with the fidelity against yield trade-off
drawn as a map.

<img width="2560" height="1440" alt="image" src="https://github.com/user-attachments/assets/820efef6-68ef-406d-8c1a-87eb8e9c7863" />


## Quick start

Needs Python 3.12 or newer (tested on 3.12, 3.13 and 3.14). From the repository root:

```bash
python -m venv .venv
source .venv/bin/activate          # fish: source .venv/bin/activate.fish   Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m checkpoint.server        # then open http://127.0.0.1:8000
```

Everything runs locally on Qiskit Aer. No IBM Quantum account is needed. Level landscapes and the
qiskit-paulice reference (par) results are shipped in `data/`, so the game starts instantly; they are rebuilt
automatically if a level's circuit, noise or goal changes (editing level text does not trigger a rebuild).

## How to play

1. Drag a check (Z, X or Y, as the puzzle allows) from the rack onto a slot on a qubit. That is the
   check's start edge. Drop more pieces on the same slot to widen it.
2. Drag the handle to a later slot. That sets where the check ends. The game propagates the Pauli
   through the gates and calculates the end edge, or tells you why the span is not allowed.
3. Read what the check does. Small chips inside its span show its Pauli at every slot, the wires it
   watches glow in its colour, and each error-rate badge shows how much of that gate's errors your
   checks would flag ("seen"). Drag a placed check's end to change its span. Click a check to see what
   it catches, switch final-readout mode on or off (when its end edge is Z-only at the last slot), or
   remove it.
4. Press **VERIFY** to confirm that the layout preserves the intended output when noise is off.
5. Press **TEST UNDER NOISE** to see the resulting Fidelity, Yield, and Cost, compared with the
   unprotected circuit, the automated reference and every other layout the game evaluated.

You can also click a check type, then click two slots. Keys: `z` / `x` / `y` choose a check type, `e`
selects removal, `Esc` cancels an unfinished check.

The game runs inside a beige CRT monitor. On the puzzle screen, **i** shows what a correct result looks
like (for example "q1 = 0 · q0 = q3", computed from the circuit), the check budget and the targets; **?**
gives a hint; the red **!** shows a worked solution after you hold YES for five seconds (you can load it
onto the board); **CODE** shows the Qiskit circuit being scored; and **☰** has the glossary, the CRT
effect switch and the puzzle list.

The **MANUAL** button below the screen opens the user manual (13 A4 pages styled as a photocopied
booklet) in a new tab; until it has been opened once, its light blinks and a sticky note points at it.
The manual is also at `http://127.0.0.1:8000/manual` and can be printed or saved as a PDF from the
browser. On first launch you choose **Start the tutorial** (guided tours of puzzles 00 and 01, then an
optional tour of the results screen) or **No tutorial**. The tours can be replayed later from ☰.

## The levels

| # | Title | What it teaches |
|---|---|---|
| 00 | Why Check? | Noise makes some results wrong; a check finds many of them and discards them |
| 01 | First Check | A check can reject suspicious runs, but it cannot repair them |
| 02 | Which Errors Can You See? | The Pauli you choose determines which errors a check can flag |
| 03 | How Long Should a Check Be? | A longer check also exposes its ancilla to more noise |
| 04 | Find the Hot Gate | Where you place a check can matter more than how many checks you use |
| 05 | When More Checks Stop Helping | Every extra check has to earn the cost it adds |
| 06 | Follow the Pauli | Gates transform a check as it moves through the circuit |
| 07 | The Readout Blind Spot | A check can miss errors that happen after it finishes |
| 08 | The T-Gate Rule | A T gate restricts which Pauli checks can pass through it |
| 09a-d | T-Count Study (0, 2, 4, 8 gates) | T gates can remove useful check paths; compare the series, not one puzzle |
| 10 | Beat the Reference | A human-designed layout can make a different trade-off from an automated one |
| 11 | Final Challenge | Combine check placement, gate rules, Yield, and overhead in one layout |

`docs/level_design.md` lists every level's numbers (generated from the data).

## How scores are computed

* **Exact, not sampled.** The noise model stays fully in place; only shot sampling is removed. Aer's
  density-matrix method gives the exact final state, readout error is applied to the exact outcome
  probabilities, and post-selection keeps the outcomes with every syndrome bit 0. The same layout always
  gets the same score. `tests/test_engine.py::test_exact_matches_shot_sampling` checks this against
  200,000 sampled shots.
* **Checks** are built as: ancilla in |+>, controlled-P_left, the span, controlled-P_right, H, measure.
  P_right = U P_left U-dagger, computed by propagation; a T gate inside the span is allowed only where
  the propagated Pauli is I or Z on that qubit.
* **Par** (Clifford levels) is qiskit-paulice's own placement for the same ancilla budget, scored with the
  same noise and metrics. T-doped levels have no par, because the library only takes Clifford circuits.
* **Noise** is a Pauli channel per gate (2-qubit, 1-qubit, idle per layer) plus readout flips, set per
  level so each lesson shows up, or derived from a backend's calibration data
  (`NoiseParams.from_backend`). The organizers did not announce a common noise model, so the game and
  the experiment use these documented models.

  <img width="2560" height="1440" alt="image" src="https://github.com/user-attachments/assets/6810dfa2-5d19-4633-a69d-ad050ef65ba1" />


## Repository layout

```
checkpoint/                      the engine (Python package)
  pauli_tools.py                 propagation and the T rule
  circuits.py                    payload and checked-circuit builder (gated and merged right edges)
  noise.py                       noise parameters, Aer noise model, idle insertion, paulice noise model
  simulate.py                    exact density-matrix evaluation, analytic readout
  metrics.py                     post-selection, Hellinger fidelity, Pareto front
  engine.py                      public API: evaluate, propagate_check, evaluate_layouts
  par.py                         qiskit-paulice par (cached in data/paulice_cache)
  landscape.py                   solution landscapes for the histograms (cached in data/landscapes)
  codegen.py                     Qiskit source for the live code panel
  server.py                      FastAPI server for the browser front end
web/                             front end (plain HTML, CSS, JS; no build step); manual.html is the user manual,
                                 fonts/ holds the bundled fonts
levels/                          one JSON file per puzzle
data/                            precomputed landscapes and paulice results
experiments/                     the brief's required experiment: script, notebook, results
scripts/                         calibrate_levels.py, precompute_landscapes.py, level_report.py
tests/                           engine, propagation and per-level learning-moment tests
docs/                            level design (generated), presentation outline
REPORT.pdf                       the written report
Checkpoint_Presentation.mp4      Video presentation
```

## Tests

```bash
python -m pytest -q
```

`tests/test_level_lessons.py` asserts each level's learning moment on its computed data, for example
that only X checks meet level 02's goal and that protection falls across the T-count series. If a noise
model change breaks one, the level text is now wrong: fix the level, not the test.

## The brief's experiment

```bash
python experiments/brief_experiment.py          # or open experiments/brief_experiment.ipynb
```

This runs a Clifford payload and T-doped versions (T count 0, 2, 4, 8) under three noise models. It
uses qiskit-paulice checks (every check count, four target orders) on the Clifford one and hand checks
obeying the T rule on the others, and writes CSVs, plots and a summary to `experiments/results/`.

## License

The code, levels, data and documentation are licensed under the Apache License 2.0 (see `LICENSE`), the
same license as Qiskit. The fonts bundled in `web/fonts/` keep their own SIL Open Font License 1.1; each
license text sits next to its font.

## Hackathon Submissions

Written report: REPORT.pdf · Video presentation: Checkpoint_Presentation.mp4
