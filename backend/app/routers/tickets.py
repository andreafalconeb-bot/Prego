from datetime import datetime, time, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import get_current_user
from ..services import visit_service
from ..services.audit_service import reconcile

router = APIRouter(prefix="/api", tags=["tickets", "audit"])


@router.post("/ticket-charges", response_model=schemas.TicketChargeOut, status_code=201)
def create_ticket_charge(
    payload: schemas.TicketChargeCreate,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    from ..services.audit_service import try_match_charge

    charge = models.TicketCharge(
        ticket_number=payload.ticket_number,
        plate=visit_service.normalize_plate(payload.plate),
        amount=payload.amount,
        charged_at=payload.charged_at or datetime.utcnow(),
        charged_by=payload.charged_by or user.username,
        notes=payload.notes,
    )
    db.add(charge)
    db.flush()

    matched_visit = try_match_charge(db, charge)
    if matched_visit is not None:
        charge.matched_visit_id = matched_visit.id

    db.commit()
    db.refresh(charge)
    return charge


@router.get("/ticket-charges", response_model=list[schemas.TicketChargeOut])
def list_ticket_charges(
    start: datetime | None = None,
    end: datetime | None = None,
    db: Session = Depends(get_db),
    _user: models.User = Depends(get_current_user),
):
    query = db.query(models.TicketCharge)
    if start:
        query = query.filter(models.TicketCharge.charged_at >= start)
    if end:
        query = query.filter(models.TicketCharge.charged_at < end)
    return query.order_by(models.TicketCharge.charged_at.desc()).limit(500).all()


@router.get("/audit")
def audit_report(
    start: datetime | None = None,
    end: datetime | None = None,
    db: Session = Depends(get_db),
    _user: models.User = Depends(get_current_user),
):
    if start is None or end is None:
        today_start = datetime.combine(datetime.utcnow().date(), time.min)
        start = start or today_start
        end = end or today_start + timedelta(days=1)

    report = reconcile(db, start, end)
    return {
        "start": report.start,
        "end": report.end,
        "total_charged": report.total_charged,
        "matched_count": len(report.matched),
        "visits_without_charge": [schemas.VisitOut.model_validate(v) for v in report.visits_without_charge],
        "charges_without_visit": [schemas.TicketChargeOut.model_validate(c) for c in report.charges_without_visit],
        "matched": [
            {
                "visit": schemas.VisitOut.model_validate(v),
                "charge": schemas.TicketChargeOut.model_validate(c),
            }
            for v, c in report.matched
        ],
    }
