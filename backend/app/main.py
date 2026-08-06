import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import models
from .config import settings
from .database import Base, SessionLocal, engine
from .routers import auth, cameras, dashboard, events, reports, settings as settings_router, tickets, visits
from .security import hash_password
from .services.settings_service import get_settings

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Sistema de Reconocimiento de Placas - Estacionamiento", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _bootstrap() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        get_settings(db)

        if db.query(models.User).count() == 0:
            admin_password = os.environ.get("PARKING_ADMIN_PASSWORD", "admin123")
            db.add(
                models.User(
                    username="admin",
                    full_name="Administrador",
                    hashed_password=hash_password(admin_password),
                    role=models.UserRole.ADMIN,
                )
            )
            logging.getLogger("parking.bootstrap").info(
                "Usuario admin creado (usuario=admin). Cambia la contraseña en producción "
                "definiendo la variable de entorno PARKING_ADMIN_PASSWORD antes del primer arranque."
            )

        if db.query(models.Camera).count() == 0:
            db.add_all(
                [
                    models.Camera(name="Entrada Principal", role=models.CameraRole.ENTRY, location="Acceso vehicular"),
                    models.Camera(name="Salida Principal", role=models.CameraRole.EXIT, location="Salida vehicular"),
                ]
            )
        db.commit()
    finally:
        db.close()


_bootstrap()

app.include_router(auth.router)
app.include_router(cameras.router)
app.include_router(events.router)
app.include_router(visits.router)
app.include_router(settings_router.router)
app.include_router(reports.router)
app.include_router(tickets.router)
app.include_router(dashboard.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
