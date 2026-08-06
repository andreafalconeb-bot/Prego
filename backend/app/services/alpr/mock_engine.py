import random
import string

from .base import ALPREngine, PlateCandidate


class MockALPREngine(ALPREngine):
    """Deterministic-ish stand-in engine used until a real camera/ALPR pipeline is
    connected. In production this is never actually invoked from live video —
    plates arrive already recognized via the /api/events/detect endpoint (from the
    camera worker or, for now, the console's detection simulator). It exists so the
    rest of the system (tests, local demos) has something to call.
    """

    def recognize(self, image_bytes: bytes) -> list[PlateCandidate]:
        if not image_bytes:
            return []
        letters = "".join(random.choices(string.ascii_uppercase, k=3))
        digits = "".join(random.choices(string.digits, k=3))
        return [PlateCandidate(plate=f"{letters}{digits}", confidence=0.5)]
