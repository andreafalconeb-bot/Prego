import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createCamera, deleteCamera, fetchCameras, updateCamera } from "../api/client";
import type { Camera, CameraRole } from "../api/types";
import { useAuth } from "../auth/AuthContext";

const emptyForm = { name: "", role: "ENTRY" as CameraRole, location: "", stream_url: "" };

export function Cameras() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  function load() {
    fetchCameras().then(setCameras);
  }

  useEffect(load, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await createCamera({ ...form, location: form.location || null, stream_url: form.stream_url || null });
      setForm(emptyForm);
      load();
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(camera: Camera) {
    await updateCamera(camera.id, { active: !camera.active });
    load();
  }

  async function remove(camera: Camera) {
    if (!confirm(`¿Eliminar la cámara "${camera.name}"?`)) return;
    await deleteCamera(camera.id);
    load();
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Cámaras</h2>
          <p>
            Configura las cámaras de entrada y salida. El campo "URL de transmisión" queda listo para
            cuando se conecte una cámara IP/RTSP real; por ahora las lecturas se generan desde el
            simulador.
          </p>
        </div>
      </div>

      {isAdmin && (
        <div className="card">
          <div className="section-title">Agregar cámara</div>
          <form onSubmit={submit} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div className="field">
              <label>Nombre</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="field">
              <label>Rol</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as CameraRole })}>
                <option value="ENTRY">Entrada</option>
                <option value="EXIT">Salida</option>
                <option value="GENERAL">General</option>
              </select>
            </div>
            <div className="field">
              <label>Ubicación</label>
              <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </div>
            <div className="field">
              <label>URL de transmisión (RTSP/HTTP)</label>
              <input
                value={form.stream_url}
                onChange={(e) => setForm({ ...form, stream_url: e.target.value })}
                placeholder="rtsp://usuario:clave@192.168.1.10/stream1"
              />
            </div>
            <button className="btn" type="submit" disabled={saving}>
              Agregar
            </button>
          </form>
        </div>
      )}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Rol</th>
              <th>Ubicación</th>
              <th>URL de transmisión</th>
              <th>Estado</th>
              {isAdmin && <th></th>}
            </tr>
          </thead>
          <tbody>
            {cameras.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.role === "ENTRY" ? "Entrada" : c.role === "EXIT" ? "Salida" : "General"}</td>
                <td>{c.location || "—"}</td>
                <td>{c.stream_url || "—"}</td>
                <td>
                  <span className={`badge ${c.active ? "open" : "exited"}`}>{c.active ? "Activa" : "Inactiva"}</span>
                </td>
                {isAdmin && (
                  <td style={{ display: "flex", gap: 8 }}>
                    <button className="btn secondary" onClick={() => toggleActive(c)}>
                      {c.active ? "Desactivar" : "Activar"}
                    </button>
                    <button className="btn danger" onClick={() => remove(c)}>
                      Eliminar
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
