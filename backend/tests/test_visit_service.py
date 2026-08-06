from datetime import datetime, timedelta

from app import models
from app.services import visit_service
from app.services.settings_service import get_settings


def test_new_entry_creates_visit_and_issues_ticket(db, entry_camera):
    t0 = datetime(2026, 1, 1, 8, 0, 0)
    event = visit_service.handle_detection(db, entry_camera, "abc-123", 0.9, t0, None)

    assert event.outcome == models.DetectionOutcome.NEW_ENTRY
    visit = db.get(models.Visit, event.visit_id)
    assert visit.plate == "ABC123"  # normalized: uppercase, no spaces/dashes
    assert visit.status == models.VisitStatus.OPEN
    assert visit.entry_time == t0
    assert visit.ticket_number is not None
    assert visit.reentry_count == 0
    assert not visit.anomaly


def test_exit_closes_open_visit(db, entry_camera, exit_camera):
    t0 = datetime(2026, 1, 1, 8, 0, 0)
    visit_service.handle_detection(db, entry_camera, "ABC123", 0.9, t0, None)
    event = visit_service.handle_detection(db, exit_camera, "ABC123", 0.9, t0 + timedelta(hours=1), None)

    assert event.outcome == models.DetectionOutcome.EXIT
    visit = db.get(models.Visit, event.visit_id)
    assert visit.status == models.VisitStatus.EXITED
    assert visit.exit_time == t0 + timedelta(hours=1)


def test_reentry_within_threshold_is_same_stay_no_new_ticket(db, entry_camera, exit_camera):
    setting = get_settings(db)
    setting.reentry_threshold_minutes = 10
    db.commit()

    t0 = datetime(2026, 1, 1, 8, 0, 0)
    visit_service.handle_detection(db, entry_camera, "ABC123", 0.9, t0, None)
    visit_service.handle_detection(db, exit_camera, "ABC123", 0.9, t0 + timedelta(minutes=1), None)
    # Car maneuvers and comes back 4 minutes after leaving: below the 10-minute
    # threshold, so this must be treated as the SAME stay, not a new ticket.
    reentry_event = visit_service.handle_detection(
        db, entry_camera, "ABC123", 0.9, t0 + timedelta(minutes=5), None
    )
    final_exit = visit_service.handle_detection(
        db, exit_camera, "ABC123", 0.9, t0 + timedelta(hours=2), None
    )

    assert reentry_event.outcome == models.DetectionOutcome.SAME_STAY_REENTRY
    assert reentry_event.visit_id == final_exit.visit_id

    all_visits = db.query(models.Visit).filter(models.Visit.plate == "ABC123").all()
    assert len(all_visits) == 1, "no debe crearse una segunda visita/ticket"

    visit = all_visits[0]
    assert visit.entry_time == t0, "debe conservar la hora de la PRIMERA entrada"
    assert visit.exit_time == t0 + timedelta(hours=2), "debe reflejar la hora de la ÚLTIMA salida"
    assert visit.reentry_count == 1
    assert visit.status == models.VisitStatus.EXITED


def test_reentry_after_threshold_creates_new_visit_and_ticket(db, entry_camera, exit_camera):
    setting = get_settings(db)
    setting.reentry_threshold_minutes = 10
    db.commit()

    t0 = datetime(2026, 1, 1, 8, 0, 0)
    first = visit_service.handle_detection(db, entry_camera, "ABC123", 0.9, t0, None)
    visit_service.handle_detection(db, exit_camera, "ABC123", 0.9, t0 + timedelta(minutes=1), None)
    # Returns 20 minutes after leaving: at/over the threshold -> a genuinely new entry.
    second = visit_service.handle_detection(
        db, entry_camera, "ABC123", 0.9, t0 + timedelta(minutes=21), None
    )

    assert second.outcome == models.DetectionOutcome.NEW_ENTRY
    assert second.visit_id != first.visit_id

    visits = db.query(models.Visit).filter(models.Visit.plate == "ABC123").all()
    assert len(visits) == 2
    tickets = {v.ticket_number for v in visits}
    assert len(tickets) == 2, "cada entrada nueva debe tener su propio ticket"


def test_duplicate_entry_while_still_inside_is_flagged_as_anomaly(db, entry_camera):
    t0 = datetime(2026, 1, 1, 8, 0, 0)
    first = visit_service.handle_detection(db, entry_camera, "ABC123", 0.9, t0, None)
    second = visit_service.handle_detection(db, entry_camera, "ABC123", 0.9, t0 + timedelta(minutes=2), None)

    assert second.outcome == models.DetectionOutcome.DUPLICATE_ENTRY_ANOMALY
    assert second.visit_id == first.visit_id
    visit = db.get(models.Visit, first.visit_id)
    assert visit.anomaly is True
    # No second ticket should have been issued.
    assert db.query(models.Visit).filter(models.Visit.plate == "ABC123").count() == 1


def test_exit_without_prior_entry_is_flagged_as_anomaly(db, exit_camera):
    t0 = datetime(2026, 1, 1, 8, 0, 0)
    event = visit_service.handle_detection(db, exit_camera, "ABC123", 0.9, t0, None)

    assert event.outcome == models.DetectionOutcome.EXIT_WITHOUT_ENTRY_ANOMALY
    visit = db.get(models.Visit, event.visit_id)
    assert visit.anomaly is True
    assert visit.status == models.VisitStatus.EXITED


def test_photo_is_stored_with_relative_path(db, entry_camera):
    event = visit_service.handle_detection(db, entry_camera, "ABC123", 0.9, datetime(2026, 1, 1, 8), None)
    assert event.photo_path is not None
    assert event.photo_path.endswith(".jpg")

    from app.services.photo_service import resolve_photo_path

    assert resolve_photo_path(event.photo_path).is_file()
