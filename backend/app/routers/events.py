from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import get_current_user
from ..services import visit_service
from ..services.photo_service import resolve_photo_path

router = APIRouter(prefix="/api/events", tags=["events"])


@router.post("/detect", response_model=schemas.DetectionEventOut, status_code=201)
async def detect_plate(
    camera_id: int = Form(...),
    plate: str = Form(...),
    confidence: float | None = Form(0.95),
    detected_at: datetime | None = Form(None),
    photo: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    _user: models.User = Depends(get_current_user),
):
    """Records a plate read from a camera and applies the entry/exit/re-entry
    business rules. In production this is called by the camera worker (fed by
    the ALPR engine watching an entry/exit RTSP stream); today, and for demos,
    it's also what the console's detection simulator calls directly.
    """
    camera = db.get(models.Camera, camera_id)
    if camera is None:
        raise HTTPException(status_code=404, detail="Cámara no encontrada")
    if not camera.active:
        raise HTTPException(status_code=400, detail="La cámara está inactiva")

    image_bytes = await photo.read() if photo is not None else None

    try:
        event = visit_service.handle_detection(
            db, camera, plate, confidence, detected_at, image_bytes
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return event


@router.get("", response_model=list[schemas.DetectionEventOut])
def list_events(
    plate: str | None = None,
    camera_id: int | None = None,
    limit: int = 100,
    db: Session = Depends(get_db),
    _user: models.User = Depends(get_current_user),
):
    query = db.query(models.DetectionEvent)
    if plate:
        query = query.filter(models.DetectionEvent.plate_raw == visit_service.normalize_plate(plate))
    if camera_id:
        query = query.filter(models.DetectionEvent.camera_id == camera_id)
    return query.order_by(models.DetectionEvent.detected_at.desc()).limit(min(limit, 500)).all()


@router.get("/{event_id}/photo")
def get_event_photo(
    event_id: int,
    db: Session = Depends(get_db),
    _user: models.User = Depends(get_current_user),
):
    event = db.get(models.DetectionEvent, event_id)
    if event is None or not event.photo_path:
        raise HTTPException(status_code=404, detail="Foto no encontrada")

    path = resolve_photo_path(event.photo_path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Foto no encontrada")
    return FileResponse(path, media_type="image/jpeg")
