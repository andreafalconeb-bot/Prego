from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas
from ..database import get_db
from ..deps import get_current_user
from ..services import visit_service

router = APIRouter(prefix="/api/visits", tags=["visits"])


@router.get("", response_model=list[schemas.VisitOut])
def list_visits(
    plate: str | None = None,
    status: models.VisitStatus | None = None,
    day: date | None = None,
    anomaly: bool | None = None,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
    _user: models.User = Depends(get_current_user),
):
    query = db.query(models.Visit)
    if plate:
        query = query.filter(models.Visit.plate == visit_service.normalize_plate(plate))
    if status:
        query = query.filter(models.Visit.status == status)
    if anomaly is not None:
        query = query.filter(models.Visit.anomaly == anomaly)
    if day:
        start = datetime.combine(day, time.min)
        end = start + timedelta(days=1)
        query = query.filter(
            models.Visit.entry_time < end,
            (models.Visit.exit_time.is_(None)) | (models.Visit.exit_time >= start),
        )
    return (
        query.order_by(models.Visit.entry_time.desc())
        .offset(offset)
        .limit(min(limit, 500))
        .all()
    )


@router.get("/{visit_id}", response_model=schemas.VisitDetailOut)
def get_visit(
    visit_id: int,
    db: Session = Depends(get_db),
    _user: models.User = Depends(get_current_user),
):
    visit = (
        db.query(models.Visit)
        .options(joinedload(models.Visit.detection_events))
        .filter(models.Visit.id == visit_id)
        .first()
    )
    if visit is None:
        raise HTTPException(status_code=404, detail="Visita no encontrada")
    return visit
