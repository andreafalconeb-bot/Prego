import logging

from .base import TicketData, TicketPrinter
from .dummy_printer import DummyPrinter

logger = logging.getLogger("parking.printer")


def get_printer(connection_type: str, target: str | None) -> TicketPrinter:
    """Factory selecting the active printer implementation from Settings.

    Falls back to DummyPrinter (safe, hardware-free) on any misconfiguration
    so a bad printer setting never blocks the entry/ticket business logic.
    """
    if connection_type in ("network", "usb") and target:
        try:
            from .escpos_printer import EscposPrinter

            return EscposPrinter(connection_type, target)
        except Exception:
            logger.exception("No se pudo inicializar la impresora ESC/POS, usando DummyPrinter")
            return DummyPrinter()
    return DummyPrinter()


__all__ = ["TicketData", "TicketPrinter", "get_printer", "DummyPrinter"]
