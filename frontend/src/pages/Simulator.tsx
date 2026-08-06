import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { detectPlate, fetchCameras } from "../api/client";
import type { Camera, DetectionEvent } from "../api/types";
import { OutcomeBadge } from "../components/Badges";
import { ApiError } from "../api/client";
import { formatDateTime } from "../utils/format";

export function Simulator() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [cameraId, setCameraId] = useState<number | "">("");
  const [plate, setPlate] = useState("ABC123");
  const [photo, setPhoto] = useState<File | null>(null);
  const [log, setLog] = useState<DetectionEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchCameras().then((cams) => {
      setCameras(cams);
      const entry = cams.find((c) => c.role === "ENTRY" && c.active);
      if (entry) setCameraId(entry.id);
    });
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!cameraId) return;
    setError(null);
    setLoading(true);
    try {
      const event = await detectPlate({ camera_id: Number(cameraId), plate, photo });
      setLog((prev) => [event, ...prev]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo registrar la detección");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Simulador de cámara</h2>
          <p>
            Envía lecturas de placa como si vinieran de una cámara real, para probar las reglas de
            entrada/salida/reingreso y generar datos de demostración antes de conectar el hardware.
          </p>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="section-title">Registrar detección</div>
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="field">
              <label>Cámara</label>
              <select value={cameraId} onChange={(e) => setCameraId(Number(e.target.value))}>
                <option value="">Selecciona una cámara</option>
                {cameras.map((c) => (
                  <option key={c.id} value={c.id} disabled={!c.active}>
                    {c.name} ({c.role === "ENTRY" ? "Entrada" : c.role === "EXIT" ? "Salida" : "General"})
                    {!c.active ? " - inactiva" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Placa</label>
              <input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} required />
            </div>
            <div className="field">
              <label>Foto (opcional; si no se sube, se genera una imagen de prueba)</label>
              <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
            </div>
            {error && <div className="error-text">{error}</div>}
            <button className="btn" type="submit" disabled={loading || !cameraId}>
              {loading ? "Enviando..." : "Simular lectura de placa"}
            </button>
          </form>
        </div>

        <div className="card">
          <div className="section-title">Resultado de la última sesión</div>
          {log.length === 0 ? (
            <div className="empty-state">Aún no se han enviado detecciones.</div>
          ) : (
            <div className="timeline">
              {log.map((event) => (
                <div className="timeline-item" key={event.id} style={{ alignItems: "center" }}>
                  <div className="meta">
                    <strong>{event.plate_raw}</strong>
                    <span className="muted">{formatDateTime(event.detected_at)}</span>
                    <OutcomeBadge outcome={event.outcome} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
