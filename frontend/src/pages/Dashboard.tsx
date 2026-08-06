import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchDashboard, fetchVisits } from "../api/client";
import type { DashboardData, Visit } from "../api/types";
import { StatusBadge, AnomalyBadge, Plate } from "../components/Badges";
import { formatDateTime, formatDuration } from "../utils/format";

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [recent, setRecent] = useState<Visit[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    fetchDashboard().then(setData).catch(() => setData(null));
    fetchVisits({ limit: 15 }).then(setRecent).catch(() => setRecent([]));
  }, []);

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Panel general</h2>
          <p>Resumen de la actividad del estacionamiento hoy</p>
        </div>
      </div>

      <div className="stat-grid">
        <Tile label="Vehículos dentro" value={data?.vehicles_inside} />
        <Tile label="Entradas hoy" value={data?.entries_today} />
        <Tile label="Salidas hoy" value={data?.exits_today} />
        <Tile label="Tickets impresos hoy" value={data?.tickets_printed_today} />
        <Tile label="Reingresos (misma estadía)" value={data?.reentries_today} />
        <Tile label="Anomalías hoy" value={data?.anomalies_today} highlight={!!data?.anomalies_today} />
      </div>

      <div className="card">
        <div className="section-title">Actividad reciente</div>
        {recent.length === 0 ? (
          <div className="empty-state">Aún no hay registros. Usa el simulador de cámara para generar actividad de prueba.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Placa</th>
                <th>Entrada</th>
                <th>Salida</th>
                <th>Duración</th>
                <th>Estado</th>
                <th>Ticket</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {recent.map((v) => (
                <tr key={v.id} onClick={() => navigate(`/visits?open=${v.id}`)}>
                  <td>
                    <Plate value={v.plate} />
                  </td>
                  <td>{formatDateTime(v.entry_time)}</td>
                  <td>{formatDateTime(v.exit_time)}</td>
                  <td>{formatDuration(v.entry_time, v.exit_time)}</td>
                  <td>
                    <StatusBadge status={v.status} /> <AnomalyBadge anomaly={v.anomaly} />
                  </td>
                  <td>{v.ticket_number || "—"}</td>
                  <td>›</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, highlight }: { label: string; value?: number; highlight?: boolean }) {
  return (
    <div className="stat-tile">
      <div className="label">{label}</div>
      <div className="value" style={highlight ? { color: "var(--danger)" } : undefined}>
        {value ?? "—"}
      </div>
    </div>
  );
}
