import { useState } from "react";
import { downloadDailyReport, downloadRangeReport } from "../api/client";
import { todayISODate } from "../utils/format";

export function Reports() {
  const [day, setDay] = useState(todayISODate());
  const [start, setStart] = useState(todayISODate());
  const [end, setEnd] = useState(todayISODate());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runDaily() {
    setError(null);
    setBusy(true);
    try {
      await downloadDailyReport(day);
    } catch {
      setError("No se pudo generar el reporte diario.");
    } finally {
      setBusy(false);
    }
  }

  async function runRange() {
    setError(null);
    setBusy(true);
    try {
      await downloadRangeReport(start, end);
    } catch {
      setError("No se pudo generar el reporte del rango.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Reportes en Excel</h2>
          <p>Entradas y salidas por vehículo, con las reglas de reingreso ya aplicadas (una sola fila por estadía).</p>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="section-title">Reporte de un día</div>
          <div className="toolbar">
            <div className="field">
              <label>Fecha</label>
              <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            </div>
            <button className="btn" onClick={runDaily} disabled={busy}>
              Descargar Excel
            </button>
          </div>
        </div>

        <div className="card">
          <div className="section-title">Reporte por rango de fechas</div>
          <div className="toolbar">
            <div className="field">
              <label>Desde</label>
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="field">
              <label>Hasta</label>
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
            <button className="btn" onClick={runRange} disabled={busy}>
              Descargar Excel
            </button>
          </div>
          <p className="hint-text">Cada día se genera en una hoja separada dentro del mismo archivo (máx. 62 días).</p>
        </div>
      </div>

      {error && <div className="error-text" style={{ marginTop: 12 }}>{error}</div>}
    </div>
  );
}
