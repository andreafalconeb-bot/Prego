from datetime import datetime, timedelta

from app import models
from app.services import visit_service
from app.services.audit_service import reconcile, try_match_charge


def test_reconcile_matches_charge_to_visit_by_plate_and_time(db, entry_camera, exit_camera):
    entry = datetime(2026, 1, 1, 8, 0)
    exit_ = datetime(2026, 1, 1, 9, 0)
    visit_service.handle_detection(db, entry_camera, "ABC123", 0.9, entry, None)
    visit_service.handle_detection(db, exit_camera, "ABC123", 0.9, exit_, None)

    charge = models.TicketCharge(plate="ABC123", amount=20.0, charged_at=exit_ + timedelta(minutes=1))
    db.add(charge)
    db.commit()
    db.refresh(charge)

    matched_visit = try_match_charge(db, charge)
    assert matched_visit is not None
    assert matched_visit.plate == "ABC123"


def test_reconcile_flags_visit_without_charge_and_charge_without_visit(db, entry_camera, exit_camera):
    entry = datetime(2026, 1, 1, 8, 0)
    exit_ = datetime(2026, 1, 1, 9, 0)
    visit_service.handle_detection(db, entry_camera, "ABC123", 0.9, entry, None)
    visit_service.handle_detection(db, exit_camera, "ABC123", 0.9, exit_, None)

    # A charge for a plate that never actually entered the lot (data entry error, etc.)
    stray_charge = models.TicketCharge(plate="NOPE00", amount=15.0, charged_at=exit_)
    db.add(stray_charge)
    db.commit()

    report = reconcile(db, datetime(2026, 1, 1), datetime(2026, 1, 2))

    assert len(report.visits_without_charge) == 1
    assert report.visits_without_charge[0].plate == "ABC123"
    assert len(report.charges_without_visit) == 1
    assert report.charges_without_visit[0].plate == "NOPE00"
    assert report.matched == []


def test_reconcile_respects_time_window(db, entry_camera, exit_camera):
    entry = datetime(2026, 1, 1, 8, 0)
    exit_ = datetime(2026, 1, 1, 9, 0)
    visit_service.handle_detection(db, entry_camera, "ABC123", 0.9, entry, None)
    visit_service.handle_detection(db, exit_camera, "ABC123", 0.9, exit_, None)

    db.add(models.TicketCharge(plate="ABC123", amount=20.0, charged_at=exit_ + timedelta(minutes=1)))
    db.commit()

    report = reconcile(db, datetime(2026, 1, 2), datetime(2026, 1, 3))
    assert report.matched == []
    assert report.visits_without_charge == []
    assert report.charges_without_visit == []
