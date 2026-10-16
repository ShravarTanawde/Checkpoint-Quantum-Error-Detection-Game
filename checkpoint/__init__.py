"""Checkpoint: a Zachtronics-style puzzle game about quantum error detection with spacetime codes.

The package is the game's engine. Every score the game shows is computed here, from Qiskit:

* ``pauli_tools``  pushes a check's left-edge Pauli through the gates it spans (and enforces the T rule)
* ``circuits``     builds the payload and the checked circuit from a level and a list of checks
* ``noise``        turns a level's noise description into an Aer noise model (plus readout and idle noise)
* ``simulate``     exact density-matrix evaluation: no shot sampling, so scores are deterministic
* ``metrics``      Hellinger fidelity, post-selection, cost
* ``engine``       the public entry point used by the server, the precompute script and the experiments
* ``par``          qiskit-paulice's own placement, used as the par score on Clifford levels
* ``landscape``    enumerates or samples valid layouts to fill the results-screen histograms
* ``codegen``      the Qiskit source shown in the game's live code panel
"""

__version__ = "0.1.0"
