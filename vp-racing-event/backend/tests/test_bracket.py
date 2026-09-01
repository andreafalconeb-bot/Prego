import pytest

from app.services.bracket import build_bracket


def _names(n: int) -> list[str]:
    return [f"P{i}" for i in range(n)]


def test_12_participants_produces_4_rounds_with_4_byes():
    plan = build_bracket(_names(12), shuffle=False)

    assert len(plan.rounds) == 4  # ronda de 16 (con byes), 8, 4 (semis), 2 (final)
    round1, round2, semis, final = plan.rounds

    assert len(round1) == 8
    assert len(round2) == 4
    assert len(semis) == 2
    assert len(final) == 1

    byes = [m for m in round1 if m.is_bye]
    real_matches = [m for m in round1 if not m.is_bye]
    assert len(byes) == 4
    assert len(real_matches) == 4

    for bye in byes:
        assert bye.winner is not None
        assert bye.winner in (bye.participant1, bye.participant2)


def test_bye_winners_propagate_to_round_2():
    plan = build_bracket(_names(12), shuffle=False)
    round1, round2 = plan.rounds[0], plan.rounds[1]

    for match in round1:
        if not match.is_bye:
            continue
        target = round2[match.match_index // 2]
        slot = target.participant1 if match.match_index % 2 == 0 else target.participant2
        assert slot == match.winner


def test_power_of_two_participants_has_no_byes():
    plan = build_bracket(_names(8), shuffle=False)
    assert all(not m.is_bye for m in plan.rounds[0])
    assert len(plan.rounds) == 3


def test_rejects_duplicate_names():
    with pytest.raises(ValueError):
        build_bracket(["Ana", "Ana", "Beto"])


def test_rejects_single_participant():
    with pytest.raises(ValueError):
        build_bracket(["Ana"])


def test_odd_participant_count_gets_byes():
    plan = build_bracket(_names(5), shuffle=False)
    round1 = plan.rounds[0]
    assert len(round1) == 4  # se completa a 8 (3 byes)
    assert sum(1 for m in round1 if m.is_bye) == 3
