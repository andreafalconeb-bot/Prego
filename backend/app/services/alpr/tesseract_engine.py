"""Best-effort ALPR engine using OpenCV (plate-region localization) +
Tesseract OCR — both open-source, no trained plate-detection model involved.

This is what powers "Analizar video" in the console: a way to test the idea
of automatic plate reading with a phone video before installing a real ALPR
camera. Set expectations accordingly — generic OCR on a hand-drawn contour
crop is nowhere near as accurate as OpenALPR's trained models
(`openalpr_engine.py`), which is what should drive a real live camera. It
does noticeably better with good lighting, a front-on angle and a sharp,
close frame than with glare, extreme angles or motion blur.

Requires the system `tesseract-ocr` binary (not just the `pytesseract` pip
package) — see README "Probar el reconocimiento con un video".
"""

import re
import shutil

import cv2
import numpy as np
import pytesseract

from .base import ALPREngine, PlateCandidate

PLATE_RE = re.compile(r"^[A-Z0-9]{5,8}$")
_TESSERACT_CHARSET = "-c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"


def _find_plate_regions(frame: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Best-effort localization of plate-shaped rectangles via edge/contour
    detection (no trained model — just aspect ratio + size heuristics).
    """
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    smoothed = cv2.bilateralFilter(gray, 11, 17, 17)
    edges = cv2.Canny(smoothed, 30, 200)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:25]

    h_img, w_img = gray.shape[:2]
    seen: set[tuple[int, int, int, int]] = set()
    regions: list[tuple[int, int, int, int]] = []
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        if w == 0 or h == 0:
            continue
        aspect = w / h
        area_ratio = (w * h) / (w_img * h_img)
        key = (x // 10, y // 10, w // 10, h // 10)
        if 1.8 <= aspect <= 6.0 and 0.002 <= area_ratio <= 0.35 and key not in seen:
            seen.add(key)
            regions.append((x, y, w, h))
    return regions


def _ocr_region(frame: np.ndarray, box: tuple[int, int, int, int], pad: int = 8) -> list[PlateCandidate]:
    x, y, w, h = box
    x0, y0 = max(0, x - pad), max(0, y - pad)
    x1, y1 = min(frame.shape[1], x + w + pad), min(frame.shape[0], y + h + pad)
    crop = frame[y0:y1, x0:x1]
    if crop.size == 0:
        return []

    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    scale = max(1, 200 // max(1, gray.shape[0]))
    if scale > 1:
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)

    out = []
    for psm in (7, 8):
        data = pytesseract.image_to_data(
            gray, config=f"--psm {psm} {_TESSERACT_CHARSET}", output_type=pytesseract.Output.DICT
        )
        text = "".join(data["text"]).upper().replace(" ", "")
        confs = [float(c) for c in data["conf"] if c not in ("-1", -1)]
        if text and PLATE_RE.match(text):
            raw = (sum(confs) / len(confs) / 100.0) if confs else 0.0
            # Tesseract's own per-word confidence is occasionally near-zero even
            # on a clean, correctly-read crop (a known quirk of its LSTM engine
            # on small/binarized inputs). Since this text already passed a
            # plate-shaped region AND the plate regex, treat a near-zero engine
            # score as "moderately confident" rather than displaying a
            # misleading 0% next to what is often a correct read.
            out.append(PlateCandidate(plate=text, confidence=max(raw, 0.4) if raw < 0.05 else raw))
    return out


def _ocr_whole_frame(frame: np.ndarray) -> list[PlateCandidate]:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    data = pytesseract.image_to_data(
        gray, config=f"--psm 11 {_TESSERACT_CHARSET}", output_type=pytesseract.Output.DICT
    )
    out = []
    for text, conf in zip(data["text"], data["conf"]):
        text = text.upper().strip()
        if text and conf not in ("-1", -1) and PLATE_RE.match(text):
            out.append(PlateCandidate(plate=text, confidence=float(conf) / 100.0))
    return out


def analyze_frame(frame: np.ndarray) -> list[PlateCandidate]:
    """Returns plate-shaped candidates found in a single BGR frame, best
    confidence first, deduplicated by text.
    """
    found: list[PlateCandidate] = []
    for box in _find_plate_regions(frame):
        found.extend(_ocr_region(frame, box))
    found.extend(_ocr_whole_frame(frame))

    best: dict[str, float] = {}
    for c in found:
        if c.plate not in best or c.confidence > best[c.plate]:
            best[c.plate] = c.confidence
    return [PlateCandidate(plate=p, confidence=conf) for p, conf in sorted(best.items(), key=lambda kv: -kv[1])]


class TesseractPlateEngine(ALPREngine):
    def __init__(self):
        if shutil.which("tesseract") is None:
            raise RuntimeError(
                "El binario 'tesseract' no está instalado en este servidor. "
                "Instalalo con `apt-get install tesseract-ocr` (y opcionalmente "
                "`tesseract-ocr-spa` para español) para habilitar el reconocimiento por video."
            )

    def recognize(self, image_bytes: bytes) -> list[PlateCandidate]:
        arr = np.frombuffer(image_bytes, dtype=np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if frame is None:
            return []
        return analyze_frame(frame)


_engine: TesseractPlateEngine | None = None
_engine_error: str | None = None


def get_tesseract_engine() -> TesseractPlateEngine:
    """Cached singleton. Raises RuntimeError (with a message safe to show the
    user) the first time if tesseract isn't installed; remembers that so we
    don't retry the expensive probe on every request.
    """
    global _engine, _engine_error
    if _engine is not None:
        return _engine
    if _engine_error is not None:
        raise RuntimeError(_engine_error)
    try:
        _engine = TesseractPlateEngine()
        return _engine
    except RuntimeError as exc:
        _engine_error = str(exc)
        raise
