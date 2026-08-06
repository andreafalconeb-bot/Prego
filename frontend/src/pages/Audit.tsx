import { useState } from "react";
import type { FormEvent } from "react";
import { createTicketCharge, fetchAudit } from "../api/client";
import type { AuditReport } from "../api/types";
import { AnomalyBadge, Plate, StatusBadge } from "../components/Badges";
import { formatDateTime, todayISODate } from "../utils/format";
import { ApiError } from "../api/client";

const chargeFormDefaults = { plate: "", amount: "", ticket_number: "" };

export function Audit() {
  const [day, setDay] = useState(todayISODate());
  const [report, setReport] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [chargeForm, setChargeForm] = useState(chargeFormDefaults);
  const [chargeMsg, setChargeMsg] = useState<string | null>(null);
  const [chargeError, setChargeError] = useState<string | null>(null);

  async function loadAudit() {
    setLoading(true);
    try {
      const start = `${day}T00:00:00`;
      const endDate = new Date(`${day}T00:00:00`);
      endDate.setDate(endDate.getDate() + 1);
      const end = endDate.toISOString().slice(0, 19);
      const data = await fetchAudit(start, end);
      setReport(data);
    } finally {
      setLoading(false);
    }
  }

  async function submitCharge(e: FormEvent) {
    e.preventDefault();
    setChargeMsg(null);
    setChargeError(null);
    try {
      await createTicketCharge({
        plate: chargeForm.plate,
        amount: Number(chargeForm.amount),
        ticket_number: chargeForm.ticket_number || undefined,
      });
      setChargeForm(chargeFormDefaults);
      setChargeMsg("Cobro registrado correctamente.");
      if (report) loadAudit();
    } catch (err) {
      setChargeError(err instanceof ApiError ? err.message : "No se pudo registrar el cobro");
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Tickets y auditoría</h2>
          <p>
            Registra manualmente lo cobrado en caja y compáralo contra las entradas/salidas detectadas
            por el sistema, para auditar que todo lo que entró se haya cobrado.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Registrar cobro de ticket</div>
        <form onSubmit={submitCharge} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field">
            <label>Placa</label>
            <input
              value={chargeForm.plate}
              onChange={(e) => setChargeForm({ ...chargeForm, plate: e.target.value.toUpperCase() })}
              required
            />
          </div>
          <div className="field">
            <label>Monto cobrado</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={chargeForm.amount}
              onChange={(e) => setChargeForm({ ...chargeForm, amount: e.target.value })}
              required
            />
          </div>
          <div className="field">
            <label>N° de ticket (papel, opcional)</label>
            <input
              value={chargeForm.ticket_number}
              onChange={(e) => setChargeForm({ ...chargeForm, ticket_number: e.target.value })}
            />
          </div>
          <button className="btn" type="submit">
            Registrar cobro
          </button>
        </form>
        {chargeMsg && <p style={{ color: "var(--success)", marginTop: 10 }}>{chargeMsg}</p>}
        {chargeError && <p className="error-text" style={{ marginTop: 10 }}>{chargeError}</p>}
      </div>

      <div className="card">
        <div className="section-title">Auditoría diaria</div>
        <div className="toolbar">
          <div className="field">
            <label>Fecha</label>
            <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </div>
          <button className="btn" onClick={loadAudit} disabled={loading}>
            {loading ? "Calculando..." : "Auditar día"}
          </button>
        </div>

        {report && (
          <>
            <div className="stat-grid">
              <div className="stat-tile">
                <div className="label">Total cobrado</div>
                <div className="value">${report.total_charged.toFixed(2)}</div>
              </div>
              <div className="stat-tile">
                <div className="label">Coincidencias</div>
                <div className="value">{report.matched_count}</div>
              </div>
              <div className="stat-tile">
                <div className="label">Entradas sin cobro</div>
                <div className="value" style={{ color: report.visits_without_charge.length ? "var(--danger)" : undefined }}>
                  {report.visits_without_charge.length}
                </div>
              </div>
              <div className="stat-tile">
                <div className="label">Cobros sin entrada</div>
                <div className="value" style={{ color: report.charges_without_visit.length ? "var(--danger)" : undefined }}>
                  {report.charges_without_visit.length}
                </div>
              </div>
            </div>

            <div className="section-title">Vehículos que entraron sin un cobro registrado</div>
            {report.visits_without_charge.length === 0 ? (
              <p className="muted">Todas las visitas del día tienen un cobro asociado.</p>
            ) : (
              <table style={{ marginBottom: 20 }}>
                <thead>
                  <tr>
                    <th>Placa</th>
                    <th>Entrada</th>
                    <th>Salida</th>
                    <th>Ticket</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {report.visits_without_charge.map((v) => (
                    <tr key={v.id}>
                      <td>
                        <Plate value={v.plate} />
                      </td>
                      <td>{formatDateTime(v.entry_time)}</td>
                      <td>{formatDateTime(v.exit_time)}</td>
                      <td>{v.ticket_number || "—"}</td>
                      <td>
                        <StatusBadge status={v.status} /> <AnomalyBadge anomaly={v.anomaly} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="section-title">Cobros sin una entrada correspondiente</div>
            {report.charges_without_visit.length === 0 ? (
              <p className="muted">Todos los cobros del día coinciden con una visita registrada.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Placa</th>
                    <th>Monto</th>
                    <th>Hora de cobro</th>
                    <th>N° Ticket</th>
                    <th>Registrado por</th>
                  </tr>
                </thead>
                <tbody>
                  {report.charges_without_visit.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Plate value={c.plate} />
                      </td>
                      <td>${c.amount.toFixed(2)}</td>
                      <td>{formatDateTime(c.charged_at)}</td>
                      <td>{c.ticket_number || "—"}</td>
                      <td>{c.charged_by || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}
