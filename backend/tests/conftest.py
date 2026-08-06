import os
import tempfile

os.environ["PARKING_DATABASE_URL"] = f"sqlite:///{tempfile.mkstemp(suffix='.db')[1]}"
os.environ["PARKING_PHOTO_STORAGE_DIR"] = tempfile.mkdtemp()

import pytest

from app import models
from app.database import Base, SessionLocal, engine


@pytest.fixture(autouse=True)
def _fresh_schema():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def entry_camera(db):
    cam = models.Camera(name="Entrada", role=models.CameraRole.ENTRY)
    db.add(cam)
    db.commit()
    db.refresh(cam)
    return cam


@pytest.fixture
def exit_camera(db):
    cam = models.Camera(name="Salida", role=models.CameraRole.EXIT)
    db.add(cam)
    db.commit()
    db.refresh(cam)
    return cam
