import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.services import tournament_service


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()


def test_full_tournament_flow_12_participants(db):
    names = [f"Jugador {i}" for i in range(1, 13)]
    tournament = tournament_service.create_tournament(db, "Torneo de prueba", names)

    all_matches = tournament.matches
    assert len(all_matches) == 8 + 4 + 2 + 1

    # Simula resultados de todos los matches reales, ronda por ronda, hasta
    # coronar campeón.
    for round_number in (1, 2, 3, 4):
        pending = [
            m
            for m in db.query(tournament.matches[0].__class__)
            .filter_by(tournament_id=tournament.id, round_number=round_number, is_bye=False)
            .all()
            if m.winner_id is None
        ]
        for match in pending:
            db.refresh(match)
            assert match.participant1_id is not None
            assert match.participant2_id is not None
            tournament_service.record_result(db, match, time1_seconds=10.0, time2_seconds=12.0)

    final_match = [m for m in tournament.matches if m.round_number == 4][0]
    db.refresh(final_match)
    assert final_match.winner_id is not None
    assert final_match.winner_id == final_match.participant1_id


def test_record_result_rejects_tie(db):
    tournament = tournament_service.create_tournament(
        db, "Torneo", [f"J{i}" for i in range(8)]
    )
    real_match = next(m for m in tournament.matches if not m.is_bye and m.round_number == 1)
    with pytest.raises(tournament_service.TournamentError):
        tournament_service.record_result(db, real_match, 10.0, 10.0)


def test_record_result_rejects_on_bye_match(db):
    tournament = tournament_service.create_tournament(
        db, "Torneo", [f"J{i}" for i in range(5)]
    )
    bye_match = next(m for m in tournament.matches if m.is_bye)
    with pytest.raises(tournament_service.TournamentError):
        tournament_service.record_result(db, bye_match, 10.0, 12.0)
