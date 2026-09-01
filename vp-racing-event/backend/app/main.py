from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import models  # noqa: F401 -- registra las tablas en Base.metadata
from .database import Base, engine
from .routers import photobooth, tournament

Base.metadata.create_all(bind=engine)

app = FastAPI(title="VP Racing Event")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tournament.router)
app.include_router(photobooth.router)


@app.get("/health")
def health():
    return {"status": "ok"}
