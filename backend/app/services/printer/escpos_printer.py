"""Real thermal ticket printer backed by python-escpos (ESC/POS protocol),
compatible with common receipt printers (Epson TM-T20/T88, and most
clones) over network or USB.

Not imported by default (see printer/__init__.py) because python-escpos and
pyusb are hardware-facing deps kept out of the base requirements.txt — see
backend/requirements-hardware.txt. To activate:

  1. pip install -r requirements-hardware.txt
  2. In Configuración (Settings) set:
       printer_connection_type = "network"  (target = "192.168.1.50:9100")
       or "usb" (target = "vendor_id:product_id", e.g. "04b8:0202")
     printer_enabled = true
"""

from .base import TicketData, TicketPrinter


class EscposPrinter(TicketPrinter):
    def __init__(self, connection_type: str, target: str):
        try:
            from escpos.printer import Network, Usb  # type: ignore
        except ImportError as exc:  # pragma: no cover - exercised only with real install
            raise RuntimeError(
                "python-escpos is not installed. Install backend/requirements-hardware.txt "
                "to use EscposPrinter."
            ) from exc

        if connection_type == "network":
            host, _, port = target.partition(":")
            self._printer = Network(host, int(port or 9100))
        elif connection_type == "usb":
            vendor_id, _, product_id = target.partition(":")
            self._printer = Usb(int(vendor_id, 16), int(product_id, 16))
        else:
            raise ValueError(f"Tipo de conexión de impresora no soportado: {connection_type}")

    def print_entry_ticket(self, ticket: TicketData) -> None:  # pragma: no cover
        p = self._printer
        p.set(align="center", bold=True, width=2, height=2)
        p.text(f"{ticket.parking_name}\n")
        p.set(align="center", bold=False, width=1, height=1)
        p.text("-" * 32 + "\n")
        p.set(align="left")
        p.text(f"Ticket:  {ticket.ticket_number}\n")
        p.text(f"Placa:   {ticket.plate}\n")
        p.text(f"Entrada: {ticket.entry_time.strftime('%Y-%m-%d %H:%M:%S')}\n")
        p.text("-" * 32 + "\n")
        p.set(align="center")
        p.text("Conserve este ticket\n")
        p.cut()
