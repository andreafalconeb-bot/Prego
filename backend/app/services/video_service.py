"""Frame sampling for the "analizar video" plate-recognition feature.

Pulls a spread of frames out of an uploaded video clip so the OCR engine
(and, as a fallback, the human operator) has more than one shot at a clean
read of the plate — a single frame from a moving car is often blurry or
badly angled.
"""

import tempfile
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

MAX_FRAMES_TO_SCAN = 400  # hard cap so a long/corrupt upload can't hang the request


@dataclass
class SampledFrame:
    index: int
    timestamp_seconds: float | None
    frame: np.ndarray
    sharpness: float


def _sharpness(frame: np.ndarray) -> float:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def extract_sample_frames(video_bytes: bytes, sample_count: int = 16) -> list[SampledFrame]:
    """Samples up to `sample_count` frames evenly spread across the video.

    OpenCV's VideoCapture needs a real file path, so the upload is written to
    a temp file first (removed again once decoding is done).
    """
    with tempfile.NamedTemporaryFile(suffix=".mp4") as tmp:
        tmp.write(video_bytes)
        tmp.flush()
        cap = cv2.VideoCapture(tmp.name)
        if not cap.isOpened():
            raise ValueError("No se pudo leer el archivo de video (formato no soportado o corrupto)")

        fps = cap.get(cv2.CAP_PROP_FPS) or 0
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total <= 0:
            total = MAX_FRAMES_TO_SCAN  # some containers/codecs don't report a frame count
        total = min(total, MAX_FRAMES_TO_SCAN)

        step = max(1, total // sample_count)
        sampled: list[SampledFrame] = []
        for idx in range(0, total, step):
            cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            ok, frame = cap.read()
            if not ok:
                continue
            timestamp = (idx / fps) if fps > 0 else None
            sampled.append(SampledFrame(index=idx, timestamp_seconds=timestamp, frame=frame, sharpness=_sharpness(frame)))
            if len(sampled) >= sample_count:
                break
        cap.release()

    if not sampled:
        raise ValueError("No se pudo extraer ningún fotograma del video")
    return sampled


def encode_jpeg(frame: np.ndarray, quality: int = 82) -> bytes:
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise ValueError("No se pudo codificar el fotograma")
    return buf.tobytes()
