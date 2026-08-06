import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchVisits } from "../api/client";
import type { Visit } from "../api/types";
import { AnomalyBadge, Plate, StatusBadge } from "../components/Badges";
import { VisitDetailModal } from "../components/VisitDetailModal";
import { formatDateTime, formatDuration } from "../utils/format";

export function Visits() {
  const [visits, setVisits] = useState<Visit[]>([]);
  const [plate, setPlate] = useState("");
  const [status, setStatus] = useState("");
  const [day, setDay] = useState("");
  const [anomalyOnly, setAnomalyOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [params, setParams] = useSearchParams();

  const openId = params.get("open");

  async function load() {
    setLoading(true);
    try {
      const data = await fetchVisits({
        plate: plate || undefined,
        status: status || undefined,
        day: day || undefined,
        anomaly: anomalyOnly ? true : undefined,
        limit: 200,
      });
      setVisits(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Registros de entrada y salida</h2>
          <p>Historial de visitas con reglas de reingreso ya aplicadas</p>
        </div>
      </div>

      <div className="toolbar">
        <div className="field">
          <label>Placa</label>
          <input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="ABC123" />
        </div>
        <div className="field">
          <label>Estado</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todos</option>
            <option value="OPEN">Dentro</option>
            <option value="EXITED">Salió</option>
          </select>
        </div>
        <div className="field">
          <label>Fecha</label>
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </div>
        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={anomalyOnly}
              onChange={(e) => setAnomalyOnly(e.target.checked)}
              style={{ marginRight: 6 }}
            />
            Solo anomalías
          </label>
        </div>
        <button className="btn" onClick={load} disabled={loading}>
          {loading ? "Buscando..." : "Buscar"}
        </button>
      </div>

      <div className="card">
        {visits.length === 0 ? (
          <div className="empty-state">Sin resultados para los filtros seleccionados.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Placa</th>
                <th>Entrada</th>
                <th>Salida</th>
                <th>Duración</th>
                <th>Reingresos</th>
                <th>Ticket</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {visits.map((v) => (
                <tr key={v.id} onClick={() => setParams({ open: String(v.id) })}>
                  <td>
                    <Plate value={v.plate} />
                  </td>
                  <td>{formatDateTime(v.entry_time)}</td>
                  <td>{formatDateTime(v.exit_time)}</td>
                  <td>{formatDuration(v.entry_time, v.exit_time)}</td>
                  <td>{v.reentry_count}</td>
                  <td>{v.ticket_number || "—"}</td>
                  <td>
                    <StatusBadge status={v.status} /> <AnomalyBadge anomaly={v.anomaly} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {openId && (
        <VisitDetailModal
          visitId={Number(openId)}
          onClose={() => {
            params.delete("open");
            setParams(params);
          }}
        />
      )}
    </div>
  );
}
