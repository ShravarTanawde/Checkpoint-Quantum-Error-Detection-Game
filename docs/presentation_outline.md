# Recorded presentation: outline

Presentation is 40% of the score. The judges' question: "Can the participants explain their methods
succinctly and justify their design choices?" What scores high: a clear mapping from each game rule to
the physics, honest limitations, and a video that explains the approach and justifies the design.
Target 8 to 10 minutes. Record the game running locally.

| Time | Segment | Show | Say |
|---|---|---|---|
| 0:00 | Hook | The results screen of level 05 | "Adding a third check costs almost 3% of your shots and buys under 0.001 fidelity. Here is why." |
| 0:30 | Problem | One slide: detection vs mitigation vs correction | Detection discards flagged shots and repairs nothing. That is the subject. |
| 1:15 | Spacetime checks | The level 01 board: place a check, show the right edge appear | Left edge, span, right edge = U P U-dagger, syndrome, post-selection. |
| 2:15 | Rule-to-physics map | A table slide (report section 2) | Each game rule and the circuit decision it represents. |
| 3:00 | Exact scoring | The bottom bar, then one sentence on the test | Noise kept, sampling removed; matches 200k sampled shots. Same layout, same score. |
| 3:30 | Learning moments | Levels 02, 03, 07 in quick cuts | Pauli choice decides which errors you see; gated ancillas idle; merged checks catch readout flips. |
| 5:00 | The T rule | Level 08: try X across T, read the refusal; then a legal Z | T X T-dagger is not a Pauli; Z passes. |
| 5:45 | Brief's experiment | `fidelity_vs_tcount.png` and the table | T count 0, 2, 4, 8: legal checks shrink; protection falls, strongly under phase-flip noise and gently under depolarizing. |
| 7:00 | Par | Level 10 results; the paulice target-order plot | paulice optimises gamma, not this trade-off; its result depends on target order; ties are nondeterministic. |
| 8:00 | Limitations | One slide | Pauli noise only, no routing, heuristic best, even T counts. |
| 8:45 | Close | Level select screen | What a player learns in 14 puzzles. |

Tips:
* Show numbers on screen whenever you claim a trade-off (Effect, 30%).
* Every number in the video should come from the current repository state. Re-run before recording,
  especially after changing a level or a noise model.
