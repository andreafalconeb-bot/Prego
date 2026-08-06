import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { fetchSettings, updateSettings } from "../api/client";
import type { Settings } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";

export function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings().then(setSettings);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const updated = await updateSettings(settings);
      setSettings(updated);
      setMessage("Configuración guardada.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar la configuración");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return <div className="empty-state">Cargando configuración...</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Configuración</h2>
          <p>Parámetros generales del estacionamiento, reglas de reingreso e impresora de tickets.</p>
        </div>
      </div>

      <form onSubmit={submit}>
        <div className="card">
          <div className="section-title">General</div>
          <div className="toolbar">
            <div className="field">
              <label>Nombre del estacionamiento</label>
              <input
                value={settings.parking_name}
                onChange={(e) => setSettings({ ...settings, parking_name: e.target.value })}
                disabled={!isAdmin}
              />
            </div>
            <div className="field">
              <label>Dirección</label>
              <input
                value={settings.address ?? ""}
                onChange={(e) => setSettings({ ...settings, address: e.target.value })}
                disabled={!isAdmin}
              />
            </div>
            <div className="field">
              <label>Zona horaria</label>
              <input
                value={settings.timezone}
                onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
                disabled={!isAdmin}
              />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="section-title">Regla de reingreso</div>
          <p className="muted" style={{ marginBottom: 12, maxWidth: 640 }}>
            Si un vehículo sale y vuelve a entrar antes de este número de minutos, se considera que
            está maniobrando dentro del mismo período de estacionamiento: no se genera un ticket nuevo,
            y el reporte muestra la hora de la <strong>primera entrada</strong> y la hora de la{" "}
            <strong>última salida</strong>. Si regresa después de este tiempo, se cuenta como una
            entrada nueva (con su propio ticket).
          </p>
          <div className="field" style={{ maxWidth: 260 }}>
            <label>Minutos para considerar la misma estadía</label>
            <input
              type="number"
              min={1}
              max={180}
              value={settings.reentry_threshold_minutes}
              onChange={(e) =>
                setSettings({ ...settings, reentry_threshold_minutes: Number(e.target.value) })
              }
              disabled={!isAdmin}
            />
          </div>
        </div>

        <div className="card">
          <div className="section-title">Impresora de tickets</div>
          <p className="muted" style={{ marginBottom: 12, maxWidth: 640 }}>
            Mientras no haya una impresora térmica conectada, deja esta opción desactivada: el sistema
            sigue asignando número de ticket y registrando el evento, solo no envía nada a una
            impresora física.
          </p>
          <div className="toolbar">
            <div className="field">
              <label>
                <input
                  type="checkbox"
                  checked={settings.printer_enabled}
                  onChange={(e) => setSettings({ ...settings, printer_enabled: e.target.checked })}
                  disabled={!isAdmin}
                  style={{ marginRight: 6 }}
                />
                Impresora habilitada
              </label>
            </div>
            <div className="field">
              <label>Tipo de conexión</label>
              <select
                value={settings.printer_connection_type}
                onChange={(e) => setSettings({ ...settings, printer_connection_type: e.target.value })}
                disabled={!isAdmin}
              >
                <option value="dummy">Ninguna (simulada)</option>
                <option value="network">Red (IP:puerto)</option>
                <option value="usb">USB</option>
              </select>
            </div>
            <div className="field">
              <label>Destino</label>
              <input
                value={settings.printer_target ?? ""}
                onChange={(e) => setSettings({ ...settings, printer_target: e.target.value })}
                placeholder="192.168.1.50:9100 ó 04b8:0202"
                disabled={!isAdmin}
              />
            </div>
          </div>
        </div>

        {isAdmin && (
          <button className="btn" type="submit" disabled={saving} style={{ marginTop: 16 }}>
            {saving ? "Guardando..." : "Guardar cambios"}
          </button>
        )}
        {message && <p style={{ color: "var(--success)", marginTop: 10 }}>{message}</p>}
        {error && <p className="error-text" style={{ marginTop: 10 }}>{error}</p>}
      </form>
    </div>
  );
}
