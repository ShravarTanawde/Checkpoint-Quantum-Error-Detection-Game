# Brief experiment: GenericBackendV2(12 qubits, seed 2026) calibration, layout [0,1,2,3]

Selection rule for the best trade-off: highest post-selected fidelity with yield >= 0.85, ties broken by lower cost.
All numbers are exact (density matrix, readout applied analytically); no shot sampling.

| T count | width | depth | legal single checks | fidelity, no checks | best (rule) fidelity | its yield | its cost | method | Pareto points |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 4 | 6 | 1760 | 0.9730 | 0.9966 | 0.959 | 6 | hand | 17 |
| 2 | 4 | 8 | 1407 | 0.9659 | 0.9901 | 0.967 | 5 | hand | 12 |
| 4 | 4 | 10 | 1186 | 0.9554 | 0.9820 | 0.944 | 7 | hand | 13 |
| 8 | 4 | 10 | 866 | 0.9619 | 0.9837 | 0.971 | 5 | hand | 15 |

## qiskit-paulice on the Clifford payload (T count 0)

| target order | checks | fidelity | yield | cost |
|---|---|---|---|---|
| 0-1-2-3 | 0 | 0.9730 | 1.000 | 0 |
| 0-1-2-3 | 1 | 0.9746 | 0.984 | 3 |
| 0-1-2-3 | 2 | 0.9635 | 0.953 | 7 |
| 0-1-2-3 | 3 | 0.9480 | 0.918 | 11 |
| 0-1-2-3 | 4 | 0.9622 | 0.885 | 14 |
| 3-2-1-0 | 0 | 0.9730 | 1.000 | 0 |
| 3-2-1-0 | 1 | 0.9629 | 0.977 | 3 |
| 3-2-1-0 | 2 | 0.9459 | 0.939 | 7 |
| 3-2-1-0 | 3 | 0.9382 | 0.919 | 10 |
| 3-2-1-0 | 4 | 0.9608 | 0.885 | 13 |
| 1-2-0-3 | 0 | 0.9730 | 1.000 | 0 |
| 1-2-0-3 | 1 | 0.9683 | 0.987 | 3 |
| 1-2-0-3 | 2 | 0.9648 | 0.968 | 6 |
| 1-2-0-3 | 3 | 0.9672 | 0.954 | 9 |
| 1-2-0-3 | 4 | 0.9643 | 0.922 | 12 |
| 2-0-3-1 | 0 | 0.9730 | 1.000 | 0 |
| 2-0-3-1 | 1 | 0.9757 | 0.983 | 3 |
| 2-0-3-1 | 2 | 0.9833 | 0.969 | 6 |
| 2-0-3-1 | 3 | 0.9823 | 0.960 | 9 |
| 2-0-3-1 | 4 | 0.9786 | 0.933 | 12 |
