# Brief experiment: game T-series noise (Z-biased)

Selection rule for the best trade-off: highest post-selected fidelity with yield >= 0.85, ties broken by lower cost.
All numbers are exact (density matrix, readout applied analytically); no shot sampling.

| T count | width | depth | legal single checks | fidelity, no checks | best (rule) fidelity | its yield | its cost | method | Pareto points |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 4 | 6 | 1760 | 0.8958 | 0.9900 | 0.853 | 6 | hand | 17 |
| 2 | 4 | 8 | 1407 | 0.8881 | 0.9507 | 0.893 | 5 | hand | 11 |
| 4 | 4 | 10 | 1186 | 0.8772 | 0.9097 | 0.874 | 6 | hand | 8 |
| 8 | 4 | 10 | 866 | 0.8822 | 0.9087 | 0.882 | 6 | hand | 9 |

## qiskit-paulice on the Clifford payload (T count 0)

| target order | checks | fidelity | yield | cost |
|---|---|---|---|---|
| 0-1-2-3 | 0 | 0.8958 | 1.000 | 0 |
| 0-1-2-3 | 1 | 0.9211 | 0.925 | 3 |
| 0-1-2-3 | 2 | 0.9224 | 0.834 | 7 |
| 0-1-2-3 | 3 | 0.9298 | 0.770 | 11 |
| 0-1-2-3 | 4 | 0.9549 | 0.690 | 14 |
| 3-2-1-0 | 0 | 0.8958 | 1.000 | 0 |
| 3-2-1-0 | 1 | 0.9023 | 0.943 | 3 |
| 3-2-1-0 | 2 | 0.8882 | 0.843 | 7 |
| 3-2-1-0 | 3 | 0.8959 | 0.779 | 11 |
| 3-2-1-0 | 4 | 0.9414 | 0.709 | 14 |
| 1-2-0-3 | 0 | 0.8958 | 1.000 | 0 |
| 1-2-0-3 | 1 | 0.9159 | 0.928 | 3 |
| 1-2-0-3 | 2 | 0.8994 | 0.856 | 7 |
| 1-2-0-3 | 3 | 0.9005 | 0.808 | 11 |
| 1-2-0-3 | 4 | 0.9152 | 0.712 | 14 |
| 2-0-3-1 | 0 | 0.8958 | 1.000 | 0 |
| 2-0-3-1 | 1 | 0.9211 | 0.925 | 3 |
| 2-0-3-1 | 2 | 0.9461 | 0.863 | 6 |
| 2-0-3-1 | 3 | 0.9462 | 0.826 | 9 |
| 2-0-3-1 | 4 | 0.9603 | 0.728 | 13 |
