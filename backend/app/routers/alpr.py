import base64

from fastapi import APIRouter, Depends, HTTPException, UploadFile

from .. import models, schemas
from ..deps import get_current_user
from ..services import video_service
from ..services.alpr.tesseract_engine import analyze_frame, get_tesseract_engine

router = APIRouter(prefix="/api/alpr", tags=["alpr"])

MAX_VIDEO_BYTES = 40 * 1024 * 1024  # 40MB
RESULT_FRAME_COUNT = 6
SAMPLE_FRAME_COUNT = 16

ENGINE_NOTE = (
    "Lectura automática de prueba (OpenCV + Tesseract OCR de código abierto). "
    "Confirmá siempre la placa a simple vista antes de usarla — no tiene la "
    "precisión de una cámara ALPR entrenada específicamente para placas."
)


@router.post("/analyze-video", response_model=schemas.VideoAnalyzeResponse)
async def analyze_video(
    video: UploadFile,
    _user: models.User = Depends(get_current_user),
):
    """Extracts a spread of frames from an uploaded video and runs best-effort
    OCR plate recognition on each, so an operator can preview and confirm a
    reading before it's used — see tesseract_engine.py for the accuracy
    caveats of this approach vs. a real ALPR camera.
    """
    try:
        get_tesseract_engine()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    video_bytes = await video.read()
    if not video_bytes:
        raise HTTPException(status_code=400, detail="El archivo de video está vacío")
    if len(video_bytes) > MAX_VIDEO_BYTES:
        raise HTTPException(status_code=413, detail="El video supera el límite de 40MB para esta prueba")

    try:
        sampled = video_service.extract_sample_frames(video_bytes, sample_count=SAMPLE_FRAME_COUNT)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    analyzed = []
    for frame in sampled:
        candidates = analyze_frame(frame.frame)
        analyzed.append((frame, candidates))

    # Prefer frames where something plate-shaped was actually read, ranked by
    # confidence; fall back to the sharpest frames so the operator still has
    # something usable to look at and confirm by eye even if OCR came up empty.
    with_hits = sorted(
        (item for item in analyzed if item[1]), key=lambda item: -item[1][0].confidence
    )
    without_hits = sorted(
        (item for item in analyzed if not item[1]), key=lambda item: -item[0].sharpness
    )
    selected = (with_hits + without_hits)[:RESULT_FRAME_COUNT]
    selected.sort(key=lambda item: item[0].index)

    result_frames = []
    for frame, candidates in selected:
        jpeg = video_service.encode_jpeg(frame.frame)
        thumbnail = "data:image/jpeg;base64," + base64.b64encode(jpeg).decode("ascii")
        result_frames.append(
            schemas.VideoAnalyzeFrame(
                frame_index=frame.index,
                timestamp_seconds=frame.timestamp_seconds,
                thumbnail_data_url=thumbnail,
                candidates=[schemas.VideoFrameCandidate(plate=c.plate, confidence=c.confidence) for c in candidates[:3]],
            )
        )

    return schemas.VideoAnalyzeResponse(frames=result_frames, engine_note=ENGINE_NOTE)
