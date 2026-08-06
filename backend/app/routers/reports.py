from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..deps import get_current_user
from ..services.report_service import build_daily_report, build_range_report

router = APIRouter(prefix="/api/reports", tags=["reports"])

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("/daily")
def daily_report(
    day: date,
    db: Session = Depends(get_db),
    _user: models.User = Depends(get_current_user),
):
    content = build_daily_report(db, day)
    filename = f"reporte_{day.isoformat()}.xlsx"
    return Response(
        content=content,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/range")
def range_report(
    start: date,
    end: date,
    db: Session = Depends(get_db),
    _user: models.User = Depends(get_current_user),
):
    if end < start:
        raise HTTPException(status_code=400, detail="La fecha final debe ser posterior a la inicial")
    if (end - start).days > 62:
        raise HTTPException(status_code=400, detail="El rango máximo es de 62 días")
    content = build_range_report(db, start, end)
    filename = f"reporte_{start.isoformat()}_a_{end.isoformat()}.xlsx"
    return Response(
        content=content,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
