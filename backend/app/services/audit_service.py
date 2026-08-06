from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from .. import models

# How much slack, beyond the recorded exit (or now, if still inside), a charge
# timestamp may fall within and still be considered a plausible match for a
# visit. Cashiers usually charge right at exit, so this only needs to absorb
# a short walk-to-register / queue delay.
MATCH_TOLERANCE_MINUTES = 20


def try_match_charge(db: Session, charge: models.TicketCharge) -> models.Visit | None:
    """Attempts to automatically link a manually-entered ticket charge to the
    system Visit it corresponds to, by plate + plausible timing. Used both
    when a charge is first recorded and when re-running the audit report.
    """
    candidates = db.query(models.Visit).filter(models.Visit.plate == charge.plate).all()
    best: models.Visit | None = None
    best_delta: timedelta | None = None
    tolerance = timedelta(minutes=MATCH_TOLERANCE_MINUTES)

    for visit in candidates:
        window_end = (visit.exit_time or datetime.utcnow()) + tolerance
        window_start = visit.entry_time - timedelta(minutes=1)
        if not (window_start <= charge.charged_at <= window_end):
            continue
        reference = visit.exit_time or visit.entry_time
        delta = abs(charge.charged_at - reference)
        if best_delta is None or delta < best_delta:
            best, best_delta = visit, delta

    return best


@dataclass
class AuditReport:
    start: datetime
    end: datetime
    matched: list[tuple[models.Visit, models.TicketCharge]] = field(default_factory=list)
    visits_without_charge: list[models.Visit] = field(default_factory=list)
    charges_without_visit: list[models.TicketCharge] = field(default_factory=list)
    total_charged: float = 0.0


def reconcile(db: Session, start: datetime, end: datetime) -> AuditReport:
    visits = (
        db.query(models.Visit)
        .filter(models.Visit.entry_time >= start, models.Visit.entry_time < end)
        .order_by(models.Visit.entry_time)
        .all()
    )
    charges = (
        db.query(models.TicketCharge)
        .filter(models.TicketCharge.charged_at >= start, models.TicketCharge.charged_at < end)
        .order_by(models.TicketCharge.charged_at)
        .all()
    )

    matched_visit_ids: set[int] = set()
    matched_charge_ids: set[int] = set()
    matched: list[tuple[models.Visit, models.TicketCharge]] = []

    for charge in charges:
        if charge.matched_visit_id is not None:
            visit = db.get(models.Visit, charge.matched_visit_id)
        else:
            visit = try_match_charge(db, charge)
        if visit is not None:
            matched.append((visit, charge))
            matched_visit_ids.add(visit.id)
            matched_charge_ids.add(charge.id)

    report = AuditReport(
        start=start,
        end=end,
        matched=matched,
        visits_without_charge=[v for v in visits if v.id not in matched_visit_ids],
        charges_without_visit=[c for c in charges if c.id not in matched_charge_ids],
        total_charged=sum(c.amount for c in charges),
    )
    return report
