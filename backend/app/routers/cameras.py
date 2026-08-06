from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import get_current_user, require_admin

router = APIRouter(prefix="/api/cameras", tags=["cameras"])


@router.get("", response_model=list[schemas.CameraOut])
def list_cameras(db: Session = Depends(get_db), _user: models.User = Depends(get_current_user)):
    return db.query(models.Camera).order_by(models.Camera.id).all()


@router.post("", response_model=schemas.CameraOut, status_code=201)
def create_camera(
    payload: schemas.CameraCreate,
    db: Session = Depends(get_db),
    _admin: models.User = Depends(require_admin),
):
    camera = models.Camera(**payload.model_dump())
    db.add(camera)
    db.commit()
    db.refresh(camera)
    return camera


@router.patch("/{camera_id}", response_model=schemas.CameraOut)
def update_camera(
    camera_id: int,
    payload: schemas.CameraUpdate,
    db: Session = Depends(get_db),
    _admin: models.User = Depends(require_admin),
):
    camera = db.get(models.Camera, camera_id)
    if camera is None:
        raise HTTPException(status_code=404, detail="Cámara no encontrada")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(camera, field, value)
    db.commit()
    db.refresh(camera)
    return camera


@router.delete("/{camera_id}", status_code=204)
def delete_camera(
    camera_id: int,
    db: Session = Depends(get_db),
    _admin: models.User = Depends(require_admin),
):
    camera = db.get(models.Camera, camera_id)
    if camera is None:
        raise HTTPException(status_code=404, detail="Cámara no encontrada")
    db.delete(camera)
    db.commit()
    return None
