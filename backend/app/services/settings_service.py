from sqlalchemy.orm import Session

from .. import models
from ..config import settings as app_settings


def get_settings(db: Session) -> models.Setting:
    row = db.query(models.Setting).filter(models.Setting.id == 1).first()
    if row is None:
        row = models.Setting(
            id=1,
            parking_name=app_settings.default_parking_name,
            reentry_threshold_minutes=app_settings.default_reentry_threshold_minutes,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
    return row
