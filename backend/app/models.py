import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class CameraRole(str, enum.Enum):
    ENTRY = "ENTRY"
    EXIT = "EXIT"
    GENERAL = "GENERAL"


class Direction(str, enum.Enum):
    IN = "IN"
    OUT = "OUT"


class VisitStatus(str, enum.Enum):
    OPEN = "OPEN"
    EXITED = "EXITED"


class DetectionOutcome(str, enum.Enum):
    NEW_ENTRY = "NEW_ENTRY"
    SAME_STAY_REENTRY = "SAME_STAY_REENTRY"
    EXIT = "EXIT"
    DUPLICATE_ENTRY_ANOMALY = "DUPLICATE_ENTRY_ANOMALY"
    EXIT_WITHOUT_ENTRY_ANOMALY = "EXIT_WITHOUT_ENTRY_ANOMALY"


class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"
    OPERATOR = "OPERATOR"


class Camera(Base):
    __tablename__ = "cameras"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    role: Mapped[CameraRole] = mapped_column(Enum(CameraRole), default=CameraRole.GENERAL)
    location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    stream_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    detection_events: Mapped[list["DetectionEvent"]] = relationship(back_populates="camera")


class Visit(Base):
    __tablename__ = "visits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    plate: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    status: Mapped[VisitStatus] = mapped_column(Enum(VisitStatus), default=VisitStatus.OPEN, index=True)

    entry_time: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    exit_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    entry_camera_id: Mapped[int | None] = mapped_column(ForeignKey("cameras.id"), nullable=True)
    exit_camera_id: Mapped[int | None] = mapped_column(ForeignKey("cameras.id"), nullable=True)

    ticket_number: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    ticket_printed: Mapped[bool] = mapped_column(Boolean, default=False)
    ticket_printed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    reentry_count: Mapped[int] = mapped_column(Integer, default=0)
    anomaly: Mapped[bool] = mapped_column(Boolean, default=False)
    anomaly_note: Mapped[str | None] = mapped_column(String(255), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    entry_camera: Mapped["Camera | None"] = relationship(foreign_keys=[entry_camera_id])
    exit_camera: Mapped["Camera | None"] = relationship(foreign_keys=[exit_camera_id])
    detection_events: Mapped[list["DetectionEvent"]] = relationship(back_populates="visit", order_by="DetectionEvent.detected_at")
    ticket_charges: Mapped[list["TicketCharge"]] = relationship(back_populates="matched_visit")


class DetectionEvent(Base):
    __tablename__ = "detection_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    visit_id: Mapped[int | None] = mapped_column(ForeignKey("visits.id"), nullable=True, index=True)
    camera_id: Mapped[int] = mapped_column(ForeignKey("cameras.id"), nullable=False)

    direction: Mapped[Direction] = mapped_column(Enum(Direction), nullable=False)
    plate_raw: Mapped[str] = mapped_column(String(20), nullable=False)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    photo_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    outcome: Mapped[DetectionOutcome] = mapped_column(Enum(DetectionOutcome), nullable=False)
    detected_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    visit: Mapped["Visit | None"] = relationship(back_populates="detection_events")
    camera: Mapped["Camera"] = relationship(back_populates="detection_events")


class TicketCharge(Base):
    """Manual record of a ticket collected/charged at exit, entered by staff for audit reconciliation."""

    __tablename__ = "ticket_charges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ticket_number: Mapped[str | None] = mapped_column(String(40), nullable=True)
    plate: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    charged_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    charged_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    matched_visit_id: Mapped[int | None] = mapped_column(ForeignKey("visits.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    matched_visit: Mapped["Visit | None"] = relationship(back_populates="ticket_charges")


class Setting(Base):
    __tablename__ = "settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    parking_name: Mapped[str] = mapped_column(String(200), default="Estacionamiento")
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reentry_threshold_minutes: Mapped[int] = mapped_column(Integer, default=10)
    timezone: Mapped[str] = mapped_column(String(60), default="America/Mexico_City")

    printer_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    printer_connection_type: Mapped[str] = mapped_column(String(20), default="dummy")  # dummy | network | usb
    printer_target: Mapped[str | None] = mapped_column(String(120), nullable=True)  # ip:port or usb path

    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, nullable=False, index=True)
    full_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.OPERATOR)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
