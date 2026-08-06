import { useEffect, useState } from "react";
import { fetchEventPhotoUrl, fetchVisitDetail } from "../api/client";
import type { VisitDetail } from "../api/types";
import { formatDateTime, formatDuration } from "../utils/format";
import { AnomalyBadge, OutcomeBadge, Plate, StatusBadge } from "./Badges";

export function VisitDetailModal({ visitId, onClose }: { visitId: number; onClose: () => void }) {
  const [visit, setVisit] = useState<VisitDetail | null>(null);
  const [photos, setPhotos] = useState<Record<number, string>>({});

  useEffect(() => {
    let cancelled = false;
    fetchVisitDetail(visitId).then((v) => {
      if (cancelled) return;
      setVisit(v);
      v.detection_events.forEach((event) => {
        if (!event.photo_path) return;
        fetchEventPhotoUrl(event.id)
          .then((url) => {
            if (!cancelled) setPhotos((prev) => ({ ...prev, [event.id]: url }));
          })
          .catch(() => {});
      });
    });
    return () => {
      cancelled = true;
    };
  }, [visitId]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="section-title" style={{ marginBottom: 4 }}>
              {visit ? <Plate value={visit.plate} /> : "Cargando..."}
            </div>
            {visit && (
              <div style={{ display: "flex", gap: 6 }}>
                <StatusBadge status={visit.status} />
                <AnomalyBadge anomaly={visit.anomaly} />
              </div>
            )}
          </div>
          <button className="close-btn" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        {visit && (
          <>
            <dl className="kv" style={{ marginBottom: 20 }}>
              <dt>Entrada</dt>
              <dd>{formatDateTime(visit.entry_time)}</dd>
              <dt>Salida</dt>
              <dd>{formatDateTime(visit.exit_time)}</dd>
              <dt>Duración</dt>
              <dd>{formatDuration(visit.entry_time, visit.exit_time)}</dd>
              <dt>N° Ticket</dt>
              <dd>{visit.ticket_number || "—"}</dd>
              <dt>Ticket impreso</dt>
              <dd>{visit.ticket_printed ? "Sí" : "No"}</dd>
              <dt>Reingresos</dt>
              <dd>{visit.reentry_count}</dd>
              {visit.anomaly && (
                <>
                  <dt>Nota</dt>
                  <dd>{visit.anomaly_note}</dd>
                </>
              )}
            </dl>

            <div className="section-title">Historial de detecciones</div>
            <div className="timeline">
              {visit.detection_events.map((event) => (
                <div className="timeline-item" key={event.id}>
                  {photos[event.id] ? (
                    <img src={photos[event.id]} alt={`Foto ${event.plate_raw}`} />
                  ) : (
                    <div className="timeline-item img" />
                  )}
                  <div className="meta">
                    <strong>{formatDateTime(event.detected_at)}</strong>
                    <span>{event.direction === "IN" ? "Entrada" : "Salida"}</span>
                    <OutcomeBadge outcome={event.outcome} />
                    {event.confidence != null && (
                      <span className="muted">Confianza: {(event.confidence * 100).toFixed(0)}%</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
