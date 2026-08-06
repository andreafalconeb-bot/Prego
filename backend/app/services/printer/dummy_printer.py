import logging

from .base import TicketData, TicketPrinter

logger = logging.getLogger("parking.printer")


class DummyPrinter(TicketPrinter):
    """Default printer used until a physical thermal printer is connected.

    Instead of sending anything to hardware, it just logs the ticket that
    would have been printed. This keeps the ticket-issuing business logic
    (visit_service) fully exercised and testable without requiring a
    physical ESC/POS printer to be attached.
    """

    def print_entry_ticket(self, ticket: TicketData) -> None:
        logger.info(
            "[TICKET SIMULADO] %s | Placa: %s | Entrada: %s | %s",
            ticket.ticket_number,
            ticket.plate,
            ticket.entry_time.strftime("%Y-%m-%d %H:%M:%S"),
            ticket.parking_name,
        )
