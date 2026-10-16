# Brief experiment: uniform depolarizing, p2 = 0.01

Selection rule for the best trade-off: highest post-selected fidelity with yield >= 0.85, ties broken by lower cost.
All numbers are exact (density matrix, readout applied analytically); no shot sampling.

| T count | width | depth | legal single checks | fidelity, no checks | best (rule) fidelity | its yield | its cost | method | Pareto points |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 4 | 6 | 1760 | 0.9073 | 0.9827 | 0.873 | 6 | hand | 26 |
| 2 | 4 | 8 | 1407 | 0.9028 | 0.9681 | 0.892 | 5 | hand | 21 |
| 4 | 4 | 10 | 1186 | 0.8966 | 0.9520 | 0.900 | 5 | hand | 17 |
| 8 | 4 | 10 | 866 | 0.8984 | 0.9526 | 0.901 | 5 | hand | 16 |

## qiskit-paulice on the Clifford payload (T count 0)

| target order | checks | fidelity | yield | cost |
|---|---|---|---|---|
| 0-1-2-3 | 0 | 0.9073 | 1.000 | 0 |
| 0-1-2-3 | 1 | 0.9206 | 0.955 | 3 |
| 0-1-2-3 | 2 | 0.9156 | 0.905 | 7 |
| 0-1-2-3 | 3 | 0.9042 | 0.858 | 11 |
| 0-1-2-3 | 4 | 0.9237 | 0.807 | 14 |
| 3-2-1-0 | 0 | 0.9073 | 1.000 | 0 |
| 3-2-1-0 | 1 | 0.9184 | 0.944 | 3 |
| 3-2-1-0 | 2 | 0.9183 | 0.881 | 7 |
| 3-2-1-0 | 3 | 0.9110 | 0.851 | 10 |
| 3-2-1-0 | 4 | 0.9304 | 0.807 | 13 |
| 1-2-0-3 | 0 | 0.9073 | 1.000 | 0 |
| 1-2-0-3 | 1 | 0.9152 | 0.956 | 3 |
| 1-2-0-3 | 2 | 0.9224 | 0.911 | 6 |
| 1-2-0-3 | 3 | 0.9278 | 0.876 | 9 |
| 1-2-0-3 | 4 | 0.9353 | 0.829 | 12 |
| 2-0-3-1 | 0 | 0.9073 | 1.000 | 0 |
| 2-0-3-1 | 1 | 0.9206 | 0.955 | 3 |
| 2-0-3-1 | 2 | 0.9332 | 0.917 | 6 |
| 2-0-3-1 | 3 | 0.9304 | 0.891 | 9 |
| 2-0-3-1 | 4 | 0.9370 | 0.844 | 12 |
