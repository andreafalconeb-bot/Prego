from datetime import datetime, time, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import get_current_user

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("", response_model=schemas.DashboardOut)
def dashboard(db: Session = Depends(get_db), _user: models.User = Depends(get_current_user)):
    today_start = datetime.combine(datetime.utcnow().date(), time.min)
    today_end = today_start + timedelta(days=1)

    vehicles_inside = (
        db.query(func.count(models.Visit.id)).filter(models.Visit.status == models.VisitStatus.OPEN).scalar() or 0
    )
    entries_today = (
        db.query(func.count(models.DetectionEvent.id))
        .filter(
            models.DetectionEvent.outcome == models.DetectionOutcome.NEW_ENTRY,
            models.DetectionEvent.detected_at >= today_start,
            models.DetectionEvent.detected_at < today_end,
        )
        .scalar()
        or 0
    )
    exits_today = (
        db.query(func.count(models.DetectionEvent.id))
        .filter(
            models.DetectionEvent.direction == models.Direction.OUT,
            models.DetectionEvent.detected_at >= today_start,
            models.DetectionEvent.detected_at < today_end,
        )
        .scalar()
        or 0
    )
    tickets_printed_today = (
        db.query(func.count(models.Visit.id))
        .filter(
            models.Visit.ticket_printed.is_(True),
            models.Visit.ticket_printed_at >= today_start,
            models.Visit.ticket_printed_at < today_end,
        )
        .scalar()
        or 0
    )
    reentries_today = (
        db.query(func.count(models.DetectionEvent.id))
        .filter(
            models.DetectionEvent.outcome == models.DetectionOutcome.SAME_STAY_REENTRY,
            models.DetectionEvent.detected_at >= today_start,
            models.DetectionEvent.detected_at < today_end,
        )
        .scalar()
        or 0
    )
    anomalies_today = (
        db.query(func.count(models.DetectionEvent.id))
        .filter(
            models.DetectionEvent.outcome.in_(
                [
                    models.DetectionOutcome.DUPLICATE_ENTRY_ANOMALY,
                    models.DetectionOutcome.EXIT_WITHOUT_ENTRY_ANOMALY,
                ]
            ),
            models.DetectionEvent.detected_at >= today_start,
            models.DetectionEvent.detected_at < today_end,
        )
        .scalar()
        or 0
    )

    return schemas.DashboardOut(
        vehicles_inside=vehicles_inside,
        entries_today=entries_today,
        exits_today=exits_today,
        tickets_printed_today=tickets_printed_today,
        reentries_today=reentries_today,
        anomalies_today=anomalies_today,
    )
