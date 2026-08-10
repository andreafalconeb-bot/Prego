from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from .models import CameraRole, DetectionOutcome, Direction, UserRole, VisitStatus


# ---------- Auth ----------
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    full_name: str | None
    role: UserRole
    active: bool


class UserCreate(BaseModel):
    username: str
    full_name: str | None = None
    password: str
    role: UserRole = UserRole.OPERATOR


# ---------- Cameras ----------
class CameraBase(BaseModel):
    name: str
    role: CameraRole = CameraRole.GENERAL
    location: str | None = None
    stream_url: str | None = None
    active: bool = True


class CameraCreate(CameraBase):
    pass


class CameraUpdate(BaseModel):
    name: str | None = None
    role: CameraRole | None = None
    location: str | None = None
    stream_url: str | None = None
    active: bool | None = None


class CameraOut(CameraBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime


# ---------- Detection events ----------
class DetectionEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    visit_id: int | None
    camera_id: int
    direction: Direction
    plate_raw: str
    confidence: float | None
    photo_path: str | None
    outcome: DetectionOutcome
    detected_at: datetime


class DetectRequest(BaseModel):
    camera_id: int
    plate: str = Field(..., min_length=2, max_length=20)
    confidence: float | None = 0.95
    detected_at: datetime | None = None


# ---------- Visits ----------
class VisitOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    plate: str
    status: VisitStatus
    entry_time: datetime
    exit_time: datetime | None
    entry_camera_id: int | None
    exit_camera_id: int | None
    ticket_number: str | None
    ticket_printed: bool
    ticket_printed_at: datetime | None
    reentry_count: int
    anomaly: bool
    anomaly_note: str | None


class VisitDetailOut(VisitOut):
    detection_events: list[DetectionEventOut] = []


# ---------- Settings ----------
class SettingsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    parking_name: str
    address: str | None
    reentry_threshold_minutes: int
    timezone: str
    printer_enabled: bool
    printer_connection_type: str
    printer_target: str | None


class SettingsUpdate(BaseModel):
    parking_name: str | None = None
    address: str | None = None
    reentry_threshold_minutes: int | None = Field(default=None, ge=1, le=180)
    timezone: str | None = None
    printer_enabled: bool | None = None
    printer_connection_type: str | None = None
    printer_target: str | None = None


# ---------- Ticket charges (audit) ----------
class TicketChargeCreate(BaseModel):
    ticket_number: str | None = None
    plate: str
    amount: float
    charged_at: datetime | None = None
    charged_by: str | None = None
    notes: str | None = None


class TicketChargeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    ticket_number: str | None
    plate: str
    amount: float
    charged_at: datetime
    charged_by: str | None
    notes: str | None
    matched_visit_id: int | None


# ---------- Dashboard ----------
class DashboardOut(BaseModel):
    vehicles_inside: int
    entries_today: int
    exits_today: int
    tickets_printed_today: int
    reentries_today: int
    anomalies_today: int


# ---------- Video plate-reading (testing/demo feature) ----------
class VideoFrameCandidate(BaseModel):
    plate: str
    confidence: float


class VideoAnalyzeFrame(BaseModel):
    frame_index: int
    timestamp_seconds: float | None
    thumbnail_data_url: str
    candidates: list[VideoFrameCandidate]


class VideoAnalyzeResponse(BaseModel):
    frames: list[VideoAnalyzeFrame]
    engine_note: str
