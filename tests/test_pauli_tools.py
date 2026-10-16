"""Propagation rules: the physics the board shows the player."""

from checkpoint.pauli_tools import Check, propagate


def single(moments, n, left, right, paulis):
    return propagate(moments, n, Check(left=left, right=right, paulis=tuple(sorted(paulis.items()))))


def test_cnot_copies_z_backward_and_x_forward():
    m = [[["cx", [0, 1]]]]
    assert single(m, 2, 0, 1, {1: "Z"}).right == {0: "Z", 1: "Z"}  # Z on target -> Z Z
    assert single(m, 2, 0, 1, {0: "X"}).right == {0: "X", 1: "X"}  # X on control -> X X
    assert single(m, 2, 0, 1, {0: "Z"}).right == {0: "Z"}  # Z on control unchanged
    assert single(m, 2, 0, 1, {1: "X"}).right == {1: "X"}  # X on target unchanged


def test_h_swaps_x_and_z_and_s_turns_x_into_y():
    assert single([[["h", [0]]]], 1, 0, 1, {0: "Z"}).right == {0: "X"}
    assert single([[["s", [0]]]], 1, 0, 1, {0: "X"}).right == {0: "Y"}


def test_sign_is_tracked():
    pr = single([[["h", [0]]]], 1, 0, 1, {0: "Y"})  # H Y H = -Y
    assert pr.ok and pr.right == {0: "Y"} and pr.sign == -1


def test_t_rule():
    m = [[["t", [0]]]]
    blocked = single(m, 1, 0, 1, {0: "X"})
    assert not blocked.ok and blocked.error == "t_rule" and blocked.blocked_at == (0, 0)
    assert not single(m, 1, 0, 1, {0: "Y"}).ok
    passed = single(m, 1, 0, 1, {0: "Z"})
    assert passed.ok and passed.right == {0: "Z"}


def test_t_rule_uses_the_propagated_pauli():
    # Z on q1 before a CNOT(0->1) becomes Z on q0 and q1; a T on q0 afterwards is then fine.
    m = [[["cx", [0, 1]]], [["t", [0]]]]
    assert single(m, 2, 0, 2, {1: "Z"}).ok
    # X on q0 before the CNOT becomes X on q0 and q1; the T on q0 must reject it.
    assert not single(m, 2, 0, 2, {0: "X"}).ok


def test_merge_only_for_z_only_right_edges_at_the_end():
    m = [[["cx", [0, 1]]], [["h", [1]]]]
    assert single(m, 2, 0, 1, {1: "Z"}).can_merge is False  # not at the end
    assert single(m, 2, 0, 2, {1: "Z"}).can_merge is False  # Z Z -> Z X after the H
    assert single(m, 2, 0, 2, {0: "Z"}).can_merge is True
