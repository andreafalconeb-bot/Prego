import shutil
import tempfile
from pathlib import Path

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import _bootstrap, app
from app.services import video_service
from app.services.alpr.tesseract_engine import analyze_frame

TESSERACT_AVAILABLE = shutil.which("tesseract") is not None
pytestmark = pytest.mark.skipif(not TESSERACT_AVAILABLE, reason="tesseract-ocr no está instalado en este entorno")


@pytest.fixture(autouse=True)
def _seed_admin_user():
    # conftest's _fresh_schema fixture drops all tables after every test, which
    # wipes the admin user main.py's module-level _bootstrap() only creates
    # once (at import time). Re-seed it before each test in this module so
    # login works regardless of test order.
    _bootstrap()


def _plate_frame(text="ABC123", w=960, h=540):
    frame = np.full((h, w, 3), (60, 70, 80), dtype=np.uint8)
    px, py, pw, ph = w // 2, h // 2, 180, 60
    cv2.rectangle(frame, (px - pw // 2, py - ph // 2), (px + pw // 2, py + ph // 2), (235, 235, 235), -1)
    cv2.rectangle(frame, (px - pw // 2, py - ph // 2), (px + pw // 2, py + ph // 2), (20, 20, 20), 2)
    (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.9, 2)
    cv2.putText(frame, text, (px - tw // 2, py + th // 2), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (10, 10, 10), 2, cv2.LINE_AA)
    return frame


def _make_video_bytes(n_frames=12, fps=12) -> bytes:
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "clip.mp4"
        writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (960, 540))
        for _ in range(n_frames):
            writer.write(_plate_frame())
        writer.release()
        return path.read_bytes()


def test_analyze_frame_returns_plate_shaped_candidates():
    # OCR output is inherently non-deterministic across environments/tesseract
    # versions, so this checks the pipeline runs end-to-end and returns
    # well-formed, plate-shaped candidates rather than asserting exact text.
    candidates = analyze_frame(_plate_frame())
    assert isinstance(candidates, list)
    for c in candidates:
        assert 2 <= len(c.plate) <= 10
        assert c.plate.isalnum()
        assert 0.0 <= c.confidence <= 1.0


def test_extract_sample_frames_spreads_across_video():
    video_bytes = _make_video_bytes(n_frames=24)
    frames = video_service.extract_sample_frames(video_bytes, sample_count=6)
    assert 1 <= len(frames) <= 6
    indices = [f.index for f in frames]
    assert indices == sorted(indices)


def test_extract_sample_frames_rejects_garbage_bytes():
    with pytest.raises(ValueError):
        video_service.extract_sample_frames(b"not a real video", sample_count=4)


def test_analyze_video_endpoint_requires_auth():
    client = TestClient(app)
    video_bytes = _make_video_bytes(n_frames=6)
    r = client.post("/api/alpr/analyze-video", files={"video": ("clip.mp4", video_bytes, "video/mp4")})
    assert r.status_code == 401


def test_analyze_video_endpoint_returns_frame_candidates():
    client = TestClient(app)
    login = client.post("/api/auth/login", data={"username": "admin", "password": "admin123"})
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    video_bytes = _make_video_bytes(n_frames=24)
    r = client.post(
        "/api/alpr/analyze-video", headers=headers, files={"video": ("clip.mp4", video_bytes, "video/mp4")}
    )
    assert r.status_code == 200
    data = r.json()
    assert "engine_note" in data
    assert 1 <= len(data["frames"]) <= 6
    for frame in data["frames"]:
        assert frame["thumbnail_data_url"].startswith("data:image/jpeg;base64,")
        for candidate in frame["candidates"]:
            assert 0.0 <= candidate["confidence"] <= 1.0


def test_analyze_video_endpoint_rejects_empty_upload():
    client = TestClient(app)
    login = client.post("/api/auth/login", data={"username": "admin", "password": "admin123"})
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    r = client.post("/api/alpr/analyze-video", headers=headers, files={"video": ("empty.mp4", b"", "video/mp4")})
    assert r.status_code == 400
