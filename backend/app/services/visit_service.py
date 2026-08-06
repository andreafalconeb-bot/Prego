from datetime import datetime

from sqlalchemy.orm import Session

from .. import models
from . import ticket_service
from .photo_service import save_photo_with_timestamp
from .settings_service import get_settings


def normalize_plate(plate: str) -> str:
    return plate.strip().upper().replace(" ", "").replace("-", "")


def _latest_visit_for_plate(db: Session, plate: str) -> models.Visit | None:
    return (
        db.query(models.Visit)
        .filter(models.Visit.plate == plate)
        .order_by(models.Visit.entry_time.desc(), models.Visit.id.desc())
        .first()
    )


def _handle_entry(
    db: Session, setting: models.Setting, camera: models.Camera, plate: str, detected_at: datetime
) -> tuple[models.Visit, models.DetectionOutcome]:
    last_visit = _latest_visit_for_plate(db, plate)

    if last_visit is not None and last_visit.status == models.VisitStatus.OPEN:
        # Vehicle is already recorded as inside; another entry read is treated as
        # noise (e.g. the ALPR fired twice on the same pass) rather than a new stay.
        last_visit.anomaly = True
        last_visit.anomaly_note = (
            "Lectura de entrada mientras el vehículo ya estaba marcado como dentro"
        )
        return last_visit, models.DetectionOutcome.DUPLICATE_ENTRY_ANOMALY

    if last_visit is not None and last_visit.status == models.VisitStatus.EXITED:
        gap_minutes = (detected_at - last_visit.exit_time).total_seconds() / 60.0
        if gap_minutes < setting.reentry_threshold_minutes:
            # Same stay: the car left and came back to maneuver/reposition within
            # the configured grace window. Keep the original entry_time, clear the
            # exit so the stay is "open" again, and do NOT issue a new ticket.
            last_visit.status = models.VisitStatus.OPEN
            last_visit.exit_time = None
            last_visit.reentry_count += 1
            return last_visit, models.DetectionOutcome.SAME_STAY_REENTRY

    visit = models.Visit(
        plate=plate,
        status=models.VisitStatus.OPEN,
        entry_time=detected_at,
        entry_camera_id=camera.id,
    )
    db.add(visit)
    db.flush()
    ticket_service.issue_entry_ticket(db, setting, visit, detected_at)
    return visit, models.DetectionOutcome.NEW_ENTRY


def _handle_exit(
    db: Session, camera: models.Camera, plate: str, detected_at: datetime
) -> tuple[models.Visit, models.DetectionOutcome]:
    open_visit = (
        db.query(models.Visit)
        .filter(models.Visit.plate == plate, models.Visit.status == models.VisitStatus.OPEN)
        .order_by(models.Visit.entry_time.desc())
        .first()
    )

    if open_visit is not None:
        open_visit.status = models.VisitStatus.EXITED
        open_visit.exit_time = detected_at
        open_visit.exit_camera_id = camera.id
        return open_visit, models.DetectionOutcome.EXIT

    visit = models.Visit(
        plate=plate,
        status=models.VisitStatus.EXITED,
        entry_time=detected_at,
        exit_time=detected_at,
        exit_camera_id=camera.id,
        anomaly=True,
        anomaly_note="Salida detectada sin una entrada registrada previamente",
    )
    db.add(visit)
    db.flush()
    return visit, models.DetectionOutcome.EXIT_WITHOUT_ENTRY_ANOMALY


def handle_detection(
    db: Session,
    camera: models.Camera,
    plate: str,
    confidence: float | None,
    detected_at: datetime | None,
    image_bytes: bytes | None,
) -> models.DetectionEvent:
    """Core business rule: decide whether a plate read at a camera is a brand
    new entry, an exit, a same-stay re-entry (within the configurable grace
    period), or an anomaly — then persist the photo (with a burned-in
    date/time stamp), update/create the Visit, and issue a ticket when (and
    only when) it's genuinely a new entry.
    """
    if camera.role not in (models.CameraRole.ENTRY, models.CameraRole.EXIT):
        raise ValueError("La cámara debe tener rol ENTRY o EXIT para procesar detecciones")

    plate = normalize_plate(plate)
    detected_at = detected_at or datetime.utcnow()
    setting = get_settings(db)

    if camera.role == models.CameraRole.ENTRY:
        direction = models.Direction.IN
        visit, outcome = _handle_entry(db, setting, camera, plate, detected_at)
    else:
        direction = models.Direction.OUT
        visit, outcome = _handle_exit(db, camera, plate, detected_at)

    photo_path = save_photo_with_timestamp(image_bytes, plate, detected_at, camera.name)

    event = models.DetectionEvent(
        visit_id=visit.id,
        camera_id=camera.id,
        direction=direction,
        plate_raw=plate,
        confidence=confidence,
        photo_path=photo_path,
        outcome=outcome,
        detected_at=detected_at,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event
