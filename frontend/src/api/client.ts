import type {
  AuditReport,
  Camera,
  DashboardData,
  DetectionEvent,
  Settings,
  TicketCharge,
  User,
  VideoAnalyzeResponse,
  Visit,
  VisitDetail,
} from "./types";

export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8000";

const TOKEN_KEY = "parking_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      // ignore
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function jsonHeaders(): HeadersInit {
  return { "Content-Type": "application/json" };
}

// ---------- Auth ----------
export async function login(username: string, password: string): Promise<string> {
  const body = new URLSearchParams({ username, password });
  const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new ApiError(res.status, "Usuario o contraseña incorrectos");
  }
  const data = await res.json();
  return data.access_token as string;
}

export function fetchMe(): Promise<User> {
  return request("/api/auth/me");
}

// ---------- Dashboard ----------
export function fetchDashboard(): Promise<DashboardData> {
  return request("/api/dashboard");
}

// ---------- Cameras ----------
export function fetchCameras(): Promise<Camera[]> {
  return request("/api/cameras");
}

export function createCamera(payload: Partial<Camera>): Promise<Camera> {
  return request("/api/cameras", { method: "POST", headers: jsonHeaders(), body: JSON.stringify(payload) });
}

export function updateCamera(id: number, payload: Partial<Camera>): Promise<Camera> {
  return request(`/api/cameras/${id}`, { method: "PATCH", headers: jsonHeaders(), body: JSON.stringify(payload) });
}

export function deleteCamera(id: number): Promise<void> {
  return request(`/api/cameras/${id}`, { method: "DELETE" });
}

// ---------- Visits ----------
export interface VisitFilters {
  plate?: string;
  status?: string;
  day?: string;
  anomaly?: boolean;
  limit?: number;
}

export function fetchVisits(filters: VisitFilters = {}): Promise<Visit[]> {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  const qs = params.toString();
  return request(`/api/visits${qs ? `?${qs}` : ""}`);
}

export function fetchVisitDetail(id: number): Promise<VisitDetail> {
  return request(`/api/visits/${id}`);
}

export async function fetchEventPhotoUrl(eventId: number): Promise<string> {
  const token = getToken();
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_BASE_URL}/api/events/${eventId}/photo`, { headers });
  if (!res.ok) throw new ApiError(res.status, "No se pudo cargar la foto");
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// ---------- Events (detection simulator) ----------
export interface DetectPayload {
  camera_id: number;
  plate: string;
  confidence?: number;
  detected_at?: string;
  photo?: File | null;
}

export async function detectPlate(payload: DetectPayload): Promise<DetectionEvent> {
  const form = new FormData();
  form.set("camera_id", String(payload.camera_id));
  form.set("plate", payload.plate);
  if (payload.confidence !== undefined) form.set("confidence", String(payload.confidence));
  if (payload.detected_at) form.set("detected_at", payload.detected_at);
  if (payload.photo) form.set("photo", payload.photo);

  const token = getToken();
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_BASE_URL}/api/events/detect`, { method: "POST", headers, body: form });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      // ignore
    }
    throw new ApiError(res.status, detail);
  }
  return res.json();
}

// ---------- Video plate-reading (testing/demo feature) ----------
export async function analyzeVideo(video: File): Promise<VideoAnalyzeResponse> {
  const form = new FormData();
  form.set("video", video);

  const token = getToken();
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_BASE_URL}/api/alpr/analyze-video`, { method: "POST", headers, body: form });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      // ignore
    }
    throw new ApiError(res.status, detail);
  }
  return res.json();
}

// ---------- Settings ----------
export function fetchSettings(): Promise<Settings> {
  return request("/api/settings");
}

export function updateSettings(payload: Partial<Settings>): Promise<Settings> {
  return request("/api/settings", { method: "PUT", headers: jsonHeaders(), body: JSON.stringify(payload) });
}

// ---------- Reports ----------
export async function downloadDailyReport(day: string): Promise<void> {
  await downloadFile(`/api/reports/daily?day=${day}`, `reporte_${day}.xlsx`);
}

export async function downloadRangeReport(start: string, end: string): Promise<void> {
  await downloadFile(`/api/reports/range?start=${start}&end=${end}`, `reporte_${start}_a_${end}.xlsx`);
}

async function downloadFile(path: string, filename: string): Promise<void> {
  const token = getToken();
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_BASE_URL}${path}`, { headers });
  if (!res.ok) throw new ApiError(res.status, "No se pudo generar el reporte");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------- Ticket charges / audit ----------
export interface TicketChargeCreate {
  ticket_number?: string;
  plate: string;
  amount: number;
  charged_at?: string;
  charged_by?: string;
  notes?: string;
}

export function createTicketCharge(payload: TicketChargeCreate): Promise<TicketCharge> {
  return request("/api/ticket-charges", { method: "POST", headers: jsonHeaders(), body: JSON.stringify(payload) });
}

export function fetchTicketCharges(start?: string, end?: string): Promise<TicketCharge[]> {
  const params = new URLSearchParams();
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  const qs = params.toString();
  return request(`/api/ticket-charges${qs ? `?${qs}` : ""}`);
}

export function fetchAudit(start?: string, end?: string): Promise<AuditReport> {
  const params = new URLSearchParams();
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  const qs = params.toString();
  return request(`/api/audit${qs ? `?${qs}` : ""}`);
}
