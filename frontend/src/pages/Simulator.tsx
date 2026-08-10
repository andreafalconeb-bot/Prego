import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { analyzeVideo, detectPlate, fetchCameras } from "../api/client";
import type { Camera, DetectionEvent, VideoAnalyzeResponse } from "../api/types";
import { OutcomeBadge } from "../components/Badges";
import { ApiError } from "../api/client";
import { formatDateTime } from "../utils/format";

async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type || "image/jpeg" });
}

export function Simulator() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [cameraId, setCameraId] = useState<number | "">("");
  const [plate, setPlate] = useState("ABC123");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [log, setLog] = useState<DetectionEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoResult, setVideoResult] = useState<VideoAnalyzeResponse | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [selectedFrameIndex, setSelectedFrameIndex] = useState<number | null>(null);

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

  async function runVideoAnalysis() {
    if (!videoFile) return;
    setVideoError(null);
    setAnalyzing(true);
    setVideoResult(null);
    setSelectedFrameIndex(null);
    try {
      const result = await analyzeVideo(videoFile);
      setVideoResult(result);
    } catch (err) {
      setVideoError(err instanceof ApiError ? err.message : "No se pudo analizar el video");
    } finally {
      setAnalyzing(false);
    }
  }

  async function useFrame(frameIndex: number, thumbnailDataUrl: string, candidatePlate?: string) {
    setSelectedFrameIndex(frameIndex);
    if (candidatePlate) setPlate(candidatePlate);
    const file = await dataUrlToFile(thumbnailDataUrl, `fotograma_${frameIndex}.jpg`);
    setPhoto(file);
    setPhotoPreview(thumbnailDataUrl);
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

      <div className="card">
        <div className="section-title">Analizar video (reconocimiento automático de prueba)</div>
        <p className="hint-text" style={{ marginBottom: 12, maxWidth: 640 }}>
          Subí un video corto (por ejemplo, grabado con el celular apuntando a un auto entrando) y el
          sistema va a intentar leer la placa solo, usando OCR de código abierto. Es una prueba de
          concepto, no tiene la precisión de una cámara ALPR real — siempre vas a poder revisar el
          fotograma y confirmar o corregir la placa antes de usarla.
        </p>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="file"
            accept="video/*"
            onChange={(e) => {
              setVideoFile(e.target.files?.[0] ?? null);
              setVideoResult(null);
              setVideoError(null);
            }}
          />
          <button className="btn" onClick={runVideoAnalysis} disabled={!videoFile || analyzing}>
            {analyzing ? "Analizando..." : "Analizar video"}
          </button>
        </div>
        {videoError && <div className="error-text" style={{ marginTop: 10 }}>{videoError}</div>}

        {videoResult && (
          <div style={{ marginTop: 18 }}>
            <p className="hint-text" style={{ marginBottom: 12 }}>{videoResult.engine_note}</p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: 14,
              }}
            >
              {videoResult.frames.map((frame) => (
                <div
                  key={frame.frame_index}
                  className="card"
                  style={{
                    padding: 10,
                    border: selectedFrameIndex === frame.frame_index ? "2px solid var(--primary)" : undefined,
                  }}
                >
                  <img
                    src={frame.thumbnail_data_url}
                    alt={`Fotograma ${frame.frame_index}`}
                    style={{ width: "100%", height: 130, objectFit: "cover", borderRadius: 6, marginBottom: 8 }}
                  />
                  <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                    {frame.timestamp_seconds != null ? `t = ${frame.timestamp_seconds.toFixed(1)}s` : `fotograma ${frame.frame_index}`}
                  </div>
                  {frame.candidates.length === 0 ? (
                    <button
                      type="button"
                      className="btn secondary"
                      style={{ width: "100%", fontSize: 12.5 }}
                      onClick={() => useFrame(frame.frame_index, frame.thumbnail_data_url)}
                    >
                      Sin lectura — usar esta foto
                    </button>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {frame.candidates.map((c) => (
                        <button
                          type="button"
                          key={c.plate}
                          className="btn secondary"
                          style={{ width: "100%", fontSize: 12.5, justifyContent: "space-between" }}
                          onClick={() => useFrame(frame.frame_index, frame.thumbnail_data_url, c.plate)}
                        >
                          <span className="plate">{c.plate}</span>
                          <span className="muted">{(c.confidence * 100).toFixed(0)}%</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid-2" style={{ marginTop: 18 }}>
        <div className="card">
          <div className="section-title">Registrar detección</div>
          {photoPreview && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
              <img src={photoPreview} alt="Fotograma seleccionado" style={{ width: 90, height: 64, objectFit: "cover", borderRadius: 6 }} />
              <span className="hint-text">Fotograma del video seleccionado como foto de esta detección.</span>
            </div>
          )}
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
              <label>Foto (opcional; si no se sube ni se elige un fotograma, se genera una imagen de prueba)</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  setPhoto(e.target.files?.[0] ?? null);
                  setPhotoPreview(null);
                  setSelectedFrameIndex(null);
                }}
              />
            </div>
            {error && <div className="error-text">{error}</div>}
            <button className="btn" type="submit" disabled={loading || !cameraId}>
              {loading ? "Enviando..." : "Simular lectura de placa"}
            </button>
          </form>
        </div>

        <div className="card">
          <div className="section-title">Resultado de esta sesión</div>
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
