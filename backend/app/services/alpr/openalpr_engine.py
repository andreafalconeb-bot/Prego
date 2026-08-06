"""Real ALPR engine backed by OpenALPR.

This module is intentionally NOT imported by default (see __init__.py) because
OpenALPR is a native library that must be installed on the deployment host —
it is not a pip package. To activate it in production:

  1. Install OpenALPR on the server (or run its Docker image) that has access
     to the camera network. See https://github.com/openalpr/openalpr.
  2. `pip install openalpr` (the Python bindings) inside backend/requirements-hardware.txt.
  3. Set PARKING_ALPR_ENGINE=openalpr in the environment.
  4. Point PARKING_OPENALPR_CONFIG / PARKING_OPENALPR_RUNTIME_DATA at the
     openalpr.conf and runtime_data directory for your country/plate style.

Until then, plate reads are expected to come from the /api/events/detect
endpoint (fed by a camera worker script, or manually via the console).
"""

import os

from .base import ALPREngine, PlateCandidate


class OpenALPREngine(ALPREngine):
    def __init__(self, country: str = "us", config_file: str | None = None, runtime_data: str | None = None):
        try:
            from openalpr import Alpr  # type: ignore
        except ImportError as exc:  # pragma: no cover - exercised only with real install
            raise RuntimeError(
                "openalpr python bindings are not installed. "
                "Install OpenALPR + `pip install openalpr` to use OpenALPREngine."
            ) from exc

        config_file = config_file or os.environ.get("PARKING_OPENALPR_CONFIG", "/etc/openalpr/openalpr.conf")
        runtime_data = runtime_data or os.environ.get("PARKING_OPENALPR_RUNTIME_DATA", "/usr/share/openalpr/runtime_data")
        self._alpr = Alpr(country, config_file, runtime_data)
        if not self._alpr.is_loaded():  # pragma: no cover
            raise RuntimeError("OpenALPR failed to load (check config_file/runtime_data paths).")
        self._alpr.set_top_n(5)

    def recognize(self, image_bytes: bytes) -> list[PlateCandidate]:  # pragma: no cover
        results = self._alpr.recognize_array(image_bytes)
        candidates = []
        for plate in results.get("results", []):
            for match in plate.get("candidates", []):
                candidates.append(
                    PlateCandidate(plate=match["plate"].upper(), confidence=match["confidence"] / 100.0)
                )
        return candidates

    def __del__(self):  # pragma: no cover
        alpr = getattr(self, "_alpr", None)
        if alpr is not None:
            alpr.unload()
