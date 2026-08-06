from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime


@dataclass
class TicketData:
    ticket_number: str
    plate: str
    entry_time: datetime
    parking_name: str


class TicketPrinter(ABC):
    """Interface for printing the entry ticket. Implementations are swapped via
    Setting.printer_connection_type (dummy | network | usb) — see printer/__init__.py.
    """

    @abstractmethod
    def print_entry_ticket(self, ticket: TicketData) -> None:
        raise NotImplementedError
