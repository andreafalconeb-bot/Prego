from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class PlateCandidate:
    plate: str
    confidence: float


class ALPREngine(ABC):
    """Interface for a license-plate recognition engine.

    Swap the active implementation via ALPR_ENGINE in app/services/alpr/__init__.py
    once a real engine (OpenALPR, a custom YOLO+OCR model, a cloud API, etc.) is
    wired to a live camera feed. Everything above this interface (visit_service,
    the /events API) is agnostic to which engine produced the plate.
    """

    @abstractmethod
    def recognize(self, image_bytes: bytes) -> list[PlateCandidate]:
        """Return plate candidates found in the given image, best first."""
        raise NotImplementedError
