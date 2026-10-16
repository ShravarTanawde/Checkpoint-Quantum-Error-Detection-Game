"""Qiskit source for the game's live code panel.

The text is generated from the same operation list the engine simulates (circuits.BuiltCircuit.ops),
so what the player reads is exactly what is scored. Measurements are written out here for
readability; the engine itself replaces them with an exact density-matrix readout (simulate.py).
"""

from __future__ import annotations

from .circuits import BuiltCircuit


def qiskit_source(level: dict, built: BuiltCircuit) -> str:
    n, k = built.n_data, built.n_ancilla

    def ref(i: int) -> str:
        return f"q[{i}]" if i < n else f"a[{i - n}]"

    lines = [
        f"# CHECKPOINT  puzzle {level['id']}: {level['title']}  (generated from the board)",
        "from qiskit import QuantumCircuit, QuantumRegister, ClassicalRegister",
        "",
        f'q = QuantumRegister({n}, "q")',
        f'c = ClassicalRegister({n}, "c")',
    ]
    if k:
        lines += [f'a = QuantumRegister({k}, "a")    # one ancilla per check', f's = ClassicalRegister({k}, "s")    # syndrome bits']
        lines.append("qc = QuantumCircuit(q, a, c, s)")
    else:
        lines.append("qc = QuantumCircuit(q, c)")
    lines.append("")
    for kind, name, qubits, comment in built.ops:
        if kind == "comment":
            lines.append("")
            lines.append(f"# {comment}")
            continue
        call = f"qc.{name}({', '.join(ref(x) for x in qubits)})"
        if name in ("t", "tdg"):
            comment = comment or "non-Clifford: a crossing check must be I or Z here"
        lines.append(call + (f"   # {comment}" if comment else ""))
    lines.append("")
    if k:
        lines.append("qc.measure(a, s)")
    lines.append("qc.measure(q, c)")
    if k:
        lines += ["", "# post-select: keep only shots where every syndrome bit in s is 0"]
    return "\n".join(lines)
