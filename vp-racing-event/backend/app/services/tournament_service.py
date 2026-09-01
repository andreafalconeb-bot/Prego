from sqlalchemy.orm import Session

from .. import models
from . import bracket


class TournamentError(ValueError):
    pass


def create_tournament(db: Session, name: str, participant_names: list[str]) -> models.Tournament:
    plan = bracket.build_bracket(participant_names)

    tournament = models.Tournament(name=name)
    db.add(tournament)
    db.flush()

    participants_by_name = {}
    for pname in participant_names:
        participant = models.Participant(tournament_id=tournament.id, name=pname)
        db.add(participant)
        db.flush()
        participants_by_name[pname] = participant

    # Crea los matches ronda por ronda, guardando referencia (round,index)
    # -> Match para poder enlazar next_match_id/next_match_slot.
    match_lookup: dict[tuple[int, int], models.Match] = {}
    for round_plan in plan.rounds:
        for match_plan in round_plan:
            match = models.Match(
                tournament_id=tournament.id,
                round_number=match_plan.round_number,
                match_index=match_plan.match_index,
                participant1_id=(
                    participants_by_name[match_plan.participant1].id
                    if match_plan.participant1
                    else None
                ),
                participant2_id=(
                    participants_by_name[match_plan.participant2].id
                    if match_plan.participant2
                    else None
                ),
                is_bye=match_plan.is_bye,
                winner_id=(
                    participants_by_name[match_plan.winner].id if match_plan.winner else None
                ),
            )
            db.add(match)
            db.flush()
            match_lookup[(match_plan.round_number, match_plan.match_index)] = match

    # Enlaza cada match con el match de la ronda siguiente que recibe a su
    # ganador.
    max_round = max(r[0].round_number for r in plan.rounds)
    for round_plan in plan.rounds:
        if round_plan[0].round_number == max_round:
            continue
        for match_plan in round_plan:
            match = match_lookup[(match_plan.round_number, match_plan.match_index)]
            next_match = match_lookup[
                (match_plan.round_number + 1, match_plan.match_index // 2)
            ]
            match.next_match_id = next_match.id
            match.next_match_slot = 1 if match_plan.match_index % 2 == 0 else 2

    db.commit()
    db.refresh(tournament)
    return tournament


def record_result(
    db: Session, match: models.Match, time1_seconds: float, time2_seconds: float
) -> models.Match:
    if match.is_bye:
        raise TournamentError("Este match es un bye, no tiene tiempos para cargar")
    if match.participant1_id is None or match.participant2_id is None:
        raise TournamentError("Todavía falta definir a los dos participantes de este match")
    if time1_seconds <= 0 or time2_seconds <= 0:
        raise TournamentError("Los tiempos deben ser mayores a cero")
    if time1_seconds == time2_seconds:
        raise TournamentError("Empate exacto: hay que definir un desempate antes de cargar")

    match.time1_seconds = time1_seconds
    match.time2_seconds = time2_seconds
    match.winner_id = (
        match.participant1_id if time1_seconds < time2_seconds else match.participant2_id
    )
    db.flush()

    if match.next_match_id is not None:
        next_match = db.get(models.Match, match.next_match_id)
        if match.next_match_slot == 1:
            next_match.participant1_id = match.winner_id
        else:
            next_match.participant2_id = match.winner_id
        db.flush()

    db.commit()
    db.refresh(match)
    return match
