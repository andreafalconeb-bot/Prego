"""Reference worker for connecting a real standard IP/USB camera.

This is intentionally a standalone script (not started by the API server)
because it needs OpenCV + a real RTSP/USB stream, and typically runs on a
small box near the camera rather than inside the API container.

Pipeline:
  1. Grab frames from the camera (RTSP URL, or a USB device index).
  2. Every FRAME_INTERVAL_SECONDS, run the frame through the ALPR engine.
  3. On a confident plate read, POST it (with the frame as the photo) to
     POST /api/events/detect on the backend.

Setup:
  pip install -r requirements.txt -r requirements-hardware.txt
  export PARKING_ALPR_ENGINE=openalpr   # see app/services/alpr/openalpr_engine.py
  python scripts/camera_worker.py --camera-id 1 --source rtsp://user:pass@192.168.1.10/stream1 --api http://localhost:8000 --token <JWT>

This script is a starting point, not a finished production worker: add
retry/reconnect handling, health checks, and run it under a process
supervisor (systemd, supervisord, docker restart policy) for real use.
"""

import argparse
import time

import cv2
import requests

from app.services.alpr import get_alpr_engine

FRAME_INTERVAL_SECONDS = 1.0
MIN_CONFIDENCE = 0.75


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--camera-id", type=int, required=True, help="ID de la cámara en el backend")
    parser.add_argument("--source", required=True, help="RTSP URL o índice de dispositivo USB (0, 1, ...)")
    parser.add_argument("--api", default="http://localhost:8000", help="URL base del backend")
    parser.add_argument("--token", required=True, help="JWT de una cuenta con acceso a /api/events/detect")
    args = parser.parse_args()

    source = int(args.source) if args.source.isdigit() else args.source
    cap = cv2.VideoCapture(source)
    engine = get_alpr_engine()
    headers = {"Authorization": f"Bearer {args.token}"}

    last_seen: dict[str, float] = {}

    while True:
        ok, frame = cap.read()
        if not ok:
            print("No se pudo leer el frame, reintentando...")
            time.sleep(2)
            cap = cv2.VideoCapture(source)
            continue

        ok, jpeg = cv2.imencode(".jpg", frame)
        if not ok:
            continue

        candidates = engine.recognize(jpeg.tobytes())
        now = time.time()
        for candidate in candidates:
            if candidate.confidence < MIN_CONFIDENCE:
                continue
            # Debounce repeated reads of the same plate while it's in frame.
            if now - last_seen.get(candidate.plate, 0) < 5:
                continue
            last_seen[candidate.plate] = now

            resp = requests.post(
                f"{args.api}/api/events/detect",
                headers=headers,
                data={"camera_id": args.camera_id, "plate": candidate.plate, "confidence": candidate.confidence},
                files={"photo": ("frame.jpg", jpeg.tobytes(), "image/jpeg")},
                timeout=10,
            )
            print(candidate.plate, resp.status_code, resp.text[:200])

        time.sleep(FRAME_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
