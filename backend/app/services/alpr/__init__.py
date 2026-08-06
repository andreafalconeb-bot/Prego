import os

from .base import ALPREngine, PlateCandidate
from .mock_engine import MockALPREngine

_engine: ALPREngine | None = None


def get_alpr_engine() -> ALPREngine:
    """Returns the active ALPR engine, selected via PARKING_ALPR_ENGINE.

    Defaults to the mock engine since plate recognition normally happens
    in the camera worker / console simulator before hitting this backend.
    Set PARKING_ALPR_ENGINE=openalpr to use OpenALPREngine once it's installed
    (see openalpr_engine.py for setup instructions).
    """
    global _engine
    if _engine is not None:
        return _engine

    engine_name = os.environ.get("PARKING_ALPR_ENGINE", "mock")
    if engine_name == "openalpr":
        from .openalpr_engine import OpenALPREngine

        _engine = OpenALPREngine()
    else:
        _engine = MockALPREngine()
    return _engine


__all__ = ["ALPREngine", "PlateCandidate", "get_alpr_engine"]
