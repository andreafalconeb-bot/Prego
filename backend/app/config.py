import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    database_url: str = f"sqlite:///{BASE_DIR / 'data' / 'parking.db'}"
    secret_key: str = os.environ.get("PARKING_SECRET_KEY", "dev-secret-change-me")
    access_token_expire_minutes: int = 60 * 12
    photo_storage_dir: Path = BASE_DIR / "storage" / "photos"
    default_reentry_threshold_minutes: int = 10
    default_parking_name: str = "Estacionamiento"
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    model_config = SettingsConfigDict(env_prefix="PARKING_")


settings = Settings()
settings.photo_storage_dir.mkdir(parents=True, exist_ok=True)
(BASE_DIR / "data").mkdir(parents=True, exist_ok=True)
