"""Populates the database with demo cameras/visits/charges so the console has
something to show before real cameras are connected. Safe to re-run; it skips
seeding demo activity if visits already exist.

Usage: python seed.py
"""

from datetime import datetime, timedelta

from app.database import SessionLocal
from app.main import _bootstrap
from app import models
from app.services import visit_service


def run():
    _bootstrap()
    db = SessionLocal()
    try:
        if db.query(models.Visit).count() > 0:
            print("Ya existen visitas, no se generan datos de demostración.")
            return

        entry_cam = db.query(models.Camera).filter(models.Camera.role == models.CameraRole.ENTRY).first()
        exit_cam = db.query(models.Camera).filter(models.Camera.role == models.CameraRole.EXIT).first()

        today = datetime.utcnow().replace(hour=8, minute=0, second=0, microsecond=0)

        # Regular stay, charged normally.
        visit_service.handle_detection(db, entry_cam, "ABC123", 0.97, today, None)
        visit_service.handle_detection(db, exit_cam, "ABC123", 0.96, today + timedelta(hours=3), None)
        db.add(
            models.TicketCharge(
                plate="ABC123",
                amount=45.0,
                charged_at=today + timedelta(hours=3, minutes=2),
                charged_by="demo-seed",
            )
        )

        # Vehicle repositioned within the grace period: exits, comes back 4 minutes
        # later (below the default 10-minute threshold) -> should read as ONE stay.
        t2 = today + timedelta(hours=1)
        visit_service.handle_detection(db, entry_cam, "XYZ987", 0.95, t2, None)
        visit_service.handle_detection(db, exit_cam, "XYZ987", 0.94, t2 + timedelta(minutes=2), None)
        visit_service.handle_detection(db, entry_cam, "XYZ987", 0.93, t2 + timedelta(minutes=6), None)
        visit_service.handle_detection(db, exit_cam, "XYZ987", 0.95, t2 + timedelta(hours=2), None)
        db.add(
            models.TicketCharge(
                plate="XYZ987",
                amount=30.0,
                charged_at=t2 + timedelta(hours=2, minutes=1),
                charged_by="demo-seed",
            )
        )

        # Vehicle still parked (no exit yet).
        visit_service.handle_detection(db, entry_cam, "LMN456", 0.9, today + timedelta(hours=2), None)

        # Visit with no matching ticket charge on record -> shows up in the audit report.
        t4 = today + timedelta(hours=4)
        visit_service.handle_detection(db, entry_cam, "QRS111", 0.9, t4, None)
        visit_service.handle_detection(db, exit_cam, "QRS111", 0.9, t4 + timedelta(minutes=45), None)

        db.commit()
        print("Datos de demostración creados.")
    finally:
        db.close()


if __name__ == "__main__":
    run()
