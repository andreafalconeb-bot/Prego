from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload

from .. import models, schemas
from ..database import get_db
from ..services import tournament_service

router = APIRouter(prefix="/tournaments", tags=["tournament"])


def _load(db: Session, tournament_id: int) -> models.Tournament:
    tournament = (
        db.query(models.Tournament)
        .options(
            selectinload(models.Tournament.participants),
            selectinload(models.Tournament.matches).selectinload(models.Match.participant1),
            selectinload(models.Tournament.matches).selectinload(models.Match.participant2),
            selectinload(models.Tournament.matches).selectinload(models.Match.winner),
        )
        .filter(models.Tournament.id == tournament_id)
        .first()
    )
    if tournament is None:
        raise HTTPException(status_code=404, detail="Torneo no encontrado")
    return tournament


@router.post("", response_model=schemas.TournamentOut)
def create_tournament(payload: schemas.CreateTournamentRequest, db: Session = Depends(get_db)):
    if len(payload.participant_names) > 64:
        raise HTTPException(status_code=400, detail="Demasiados participantes para un evento")
    try:
        tournament = tournament_service.create_tournament(
            db, payload.name, payload.participant_names
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _load(db, tournament.id)


@router.get("/{tournament_id}", response_model=schemas.TournamentOut)
def get_tournament(tournament_id: int, db: Session = Depends(get_db)):
    return _load(db, tournament_id)


@router.post("/{tournament_id}/matches/{match_id}/result", response_model=schemas.MatchOut)
def record_result(
    tournament_id: int,
    match_id: int,
    payload: schemas.RecordResultRequest,
    db: Session = Depends(get_db),
):
    match = (
        db.query(models.Match)
        .filter(models.Match.id == match_id, models.Match.tournament_id == tournament_id)
        .first()
    )
    if match is None:
        raise HTTPException(status_code=404, detail="Match no encontrado")
    try:
        match = tournament_service.record_result(
            db, match, payload.time1_seconds, payload.time2_seconds
        )
    except tournament_service.TournamentError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return match
