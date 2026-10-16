# Written report: outline

The brief asks for "a written report describing the problem, method and findings". Judges weight
Presentation 40%, Effect 30%, Methods 20% and Qiskit 10%. This outline maps each section to those
criteria and to where its numbers come from. Every number below was produced by this repository; re-run
the scripts before quoting. No common noise model was announced by the organizers, so the report states
which of the documented models each number uses.

## 1. Problem (Presentation)

* Why error detection: post-selection on syndrome checks raises the fidelity of the shots you keep, at
  the price of discarding shots and adding gates. It repairs nothing.
* Detection vs mitigation vs correction, in one paragraph each, and where Checkpoint sits (detection
  only). Say explicitly that merged checks post-select on data parity, which is still detection.
* Spacetime codes and coherent Pauli checks: left edge, span, right edge = U P U-dagger, syndrome, and
  post-selection. Use the board screenshot to explain them.
* The Clifford restriction and the T rule (T X T-dagger = (X+Y)/sqrt(2); Z passes).

## 2. Method (Methods, Qiskit)

* **Game-to-physics map.** A table pairing each rule with the decision it represents:
  * a check piece is a coherent Pauli check;
  * a slot is a time location in the circuit;
  * the ancilla budget is extra qubits;
  * MERGE is reading the right edge off the final Z measurement;
  * Verify is the noiseless correctness run;
  * the three metrics are fidelity, yield and cost;
  * par is qiskit-paulice;
  * illegal placements come from the T rule.
* **Scoring.** Exact density-matrix simulation (Aer), readout applied analytically, so there is no shot
  noise. Cite `test_exact_matches_shot_sampling`, which agrees with 200,000 sampled shots within 0.005.
  Say plainly: noise kept, sampling removed.
* **Fidelity measure.** Hellinger fidelity of the data qubits' output, plus state fidelity where it is
  defined. One-line justification: it is what measuring the data qubits can reveal. Explain why payloads
  are mirror circuits or GHZ-like: Hellinger fidelity of a spread-out ideal distribution barely reacts to
  noise. In early prototypes, payloads with 16 to 32 outcomes scored above 0.99 with no protection at all.
* **Noise models.** The game's per-level Pauli noise (and why each level has its own), the
  backend-derived path, and why these models were used: no common model was announced. The `uniform`
  model (two-qubit error 0.01) mirrors the brief's own `NoiseModel(gate_noise=0.01)` example.
* **Par.** qiskit-paulice settings, scored with the same noise. Two findings to report:
  * par depends on the target-qubit order (series noise, two checks: 0.922 for order 0-1-2-3 vs 0.946
    for 2-0-3-1);
  * ties on paulice's gamma cost are broken nondeterministically (1 run in 6 differed on level 10), so
    results are cached.
* **Landscape.** Exhaustive single checks, plus pairs of the best singles, plus a seeded random sample.
  The best found is a strong heuristic, not a proof.

## 3. The brief's experiment (Effect)

Source: `experiments/brief_experiment.ipynb` and `experiments/results/<noise>/summary.md`.

* **Payloads.** Width 4. Depth 6, 8, 10 and 10 for T count 0, 2, 4 and 8 (T and T-dagger both count).
* **Selection rule.** Highest post-selected fidelity with yield >= 0.85, ties broken by lower cost.
* **Headline table** (the three documented noise models; best fidelity is under the rule, yield in
  parentheses):

  | Noise | T count | Fidelity, no checks | Best fidelity (yield) |
  |---|---|---|---|
  | series (Z-biased) | 0 | 0.896 | 0.990 (0.853) |
  | series (Z-biased) | 2 | 0.888 | 0.951 (0.893) |
  | series (Z-biased) | 4 | 0.877 | 0.910 (0.874) |
  | series (Z-biased) | 8 | 0.882 | 0.909 (0.882) |
  | uniform p2 = 0.01 | 0 | 0.907 | 0.983 (0.873) |
  | uniform p2 = 0.01 | 2 | 0.903 | 0.968 (0.892) |
  | uniform p2 = 0.01 | 4 | 0.897 | 0.952 (0.900) |
  | uniform p2 = 0.01 | 8 | 0.898 | 0.953 (0.901) |
  | backend-derived | 0 | 0.973 | 0.997 (0.959) |
  | backend-derived | 2 | 0.966 | 0.990 (0.967) |
  | backend-derived | 4 | 0.955 | 0.982 (0.944) |
  | backend-derived | 8 | 0.962 | 0.984 (0.971) |

* **Findings to discuss honestly:**
  1. T gates shrink the set of legal checks: 1760, 1407, 1186 and 866 legal single checks for T count
     0, 2, 4 and 8.
  2. How much protection that costs depends on the noise bias. Under phase-flip-dominated noise the
     protection gain falls sharply (+0.094, +0.063, +0.033, +0.027), because T gates forbid exactly the
     X-type checks that see phase flips. Under depolarizing noise the fall is gentler.
  3. T count 4 and 8 share a depth, and the 8 case is not worse than 4. Part of the trend is depth, not
     T count.
  4. Hand layouts beat qiskit-paulice under this rule in every case. paulice optimises its own cost
     (gamma, undetectable error weight), not post-selected fidelity at a yield floor.
  5. Merged right edges (as paulice also uses) are the strongest single tool here. Reading the right
     edge off the final measurement removes gates and catches single readout flips.
* Plots: `fidelity_vs_tcount.png`, `tradeoff.png` and `paulice_sweep.png` per noise model.

## 4. The game (Presentation, Effect)

* Screens: board, illegal-placement feedback, merged check, results with histograms and the trade-off
  map.
* The level arc and the learning moment of each level, with its numbers (`docs/level_design.md`). Level
  05 is the clearest "non-obvious trade-off": best fidelity with 1, 2, 3 and 4 checks is 0.965, 0.989,
  0.990 and 0.990, while yield at those layouts falls 0.92, 0.88, 0.85, 0.80.
* Level tests: each learning moment is asserted on the data (`tests/test_level_lessons.py`).

## 5. Limitations (Presentation: honesty scores)

* Noise is a Pauli-channel model with no coherent errors or crosstalk. Backend-derived noise is a
  depolarizing approximation with no routing.
* T counts are even, because mirror circuits pair T with T-dagger.
* "Best found" layouts come from a heuristic search.
* paulice tie-breaking is nondeterministic, so cached results are used.

## 6. Reproducing

`pip install -r requirements.txt`, then `pytest`, then `python experiments/brief_experiment.py`, then
`python -m checkpoint.server`.
