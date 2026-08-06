from datetime import datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models
from .printer import TicketData, get_printer


def generate_ticket_number(db: Session, when: datetime) -> str:
    day_prefix = when.strftime("%Y%m%d")
    count_today = (
        db.query(func.count(models.Visit.id))
        .filter(models.Visit.ticket_number.like(f"{day_prefix}-%"))
        .scalar()
        or 0
    )
    return f"{day_prefix}-{count_today + 1:04d}"


def issue_entry_ticket(db: Session, setting: models.Setting, visit: models.Visit, when: datetime) -> None:
    """Assigns a ticket number to the visit and prints it (if printing is
    enabled). This must only be called for a genuinely new entry — never for
    a same-stay re-entry within the configured grace period.
    """
    visit.ticket_number = generate_ticket_number(db, when)
    visit.ticket_printed_at = when

    if setting.printer_enabled:
        printer = get_printer(setting.printer_connection_type, setting.printer_target)
        printer.print_entry_ticket(
            TicketData(
                ticket_number=visit.ticket_number,
                plate=visit.plate,
                entry_time=visit.entry_time,
                parking_name=setting.parking_name,
            )
        )
        visit.ticket_printed = True
    else:
        visit.ticket_printed = False
