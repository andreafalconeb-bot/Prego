import io
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from PIL import Image, ImageDraw, ImageFont

from ..config import settings

_FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]


def _load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in _FONT_CANDIDATES:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def _placeholder_photo(plate: str, camera_name: str) -> Image.Image:
    """Synthesizes a plain image standing in for a real camera frame, used by
    the detection simulator / tests when no actual photo is supplied.
    """
    img = Image.new("RGB", (640, 480), color=(35, 42, 54))
    draw = ImageDraw.Draw(img)
    font = _load_font(36)
    draw.text((40, 190), "SIMULACION", fill=(120, 130, 145), font=font)
    draw.text((40, 240), plate, fill=(230, 230, 230), font=_load_font(48))
    draw.text((40, 300), camera_name, fill=(150, 160, 175), font=_load_font(24))
    return img


def save_photo_with_timestamp(
    image_bytes: bytes | None,
    plate: str,
    detected_at: datetime,
    camera_name: str,
) -> str:
    """Saves a vehicle photo with a burned-in date/time (and plate/camera)
    stamp, as required for entry/exit records. Returns a path relative to
    PARKING_PHOTO_STORAGE_DIR suitable for storing on DetectionEvent.photo_path.

    If image_bytes is None, a placeholder frame is synthesized so the rest of
    the pipeline (storage, reporting, console viewer) can be exercised before
    a real camera feed is wired in.
    """
    if image_bytes:
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    else:
        image = _placeholder_photo(plate, camera_name)

    draw = ImageDraw.Draw(image)
    stamp = f"{detected_at.strftime('%Y-%m-%d %H:%M:%S')}  |  {plate}  |  {camera_name}"
    font = _load_font(max(16, image.width // 32))

    bbox = draw.textbbox((0, 0), stamp, font=font)
    text_w, text_h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    padding = 8
    bar_h = text_h + padding * 2
    draw.rectangle(
        [(0, image.height - bar_h), (image.width, image.height)],
        fill=(0, 0, 0),
    )
    draw.text((padding, image.height - bar_h + padding // 2), stamp, fill=(255, 255, 255), font=font)

    day_dir = detected_at.strftime("%Y/%m/%d")
    target_dir = settings.photo_storage_dir / day_dir
    target_dir.mkdir(parents=True, exist_ok=True)

    filename = f"{detected_at.strftime('%H%M%S')}_{plate}_{uuid4().hex[:8]}.jpg"
    target_path = target_dir / filename
    image.save(target_path, format="JPEG", quality=85)

    return str(Path(day_dir) / filename)


def resolve_photo_path(relative_path: str) -> Path:
    return settings.photo_storage_dir / relative_path
