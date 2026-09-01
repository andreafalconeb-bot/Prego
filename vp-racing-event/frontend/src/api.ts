const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export interface Participant {
  id: number;
  name: string;
}

export interface Match {
  id: number;
  round_number: number;
  match_index: number;
  participant1: Participant | null;
  participant2: Participant | null;
  time1_seconds: number | null;
  time2_seconds: number | null;
  winner: Participant | null;
  is_bye: boolean;
}

export interface Tournament {
  id: number;
  name: string;
  participants: Participant[];
  matches: Match[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail ?? `Error ${response.status}`);
  }
  return response.json();
}

export function createTournament(name: string, participantNames: string[]) {
  return request<Tournament>("/tournaments", {
    method: "POST",
    body: JSON.stringify({ name, participant_names: participantNames }),
  });
}

export function getTournament(id: number) {
  return request<Tournament>(`/tournaments/${id}`);
}

export function recordResult(
  tournamentId: number,
  matchId: number,
  time1Seconds: number,
  time2Seconds: number,
) {
  return request<Match>(`/tournaments/${tournamentId}/matches/${matchId}/result`, {
    method: "POST",
    body: JSON.stringify({ time1_seconds: time1Seconds, time2_seconds: time2Seconds }),
  });
}

export interface TransformResponse {
  image_base64: string;
  demo_mode: boolean;
}

export async function transformPhoto(style: string, file: Blob): Promise<TransformResponse> {
  const formData = new FormData();
  formData.append("file", file, "photo.jpg");
  const response = await fetch(
    `${API_URL}/photobooth/transform?style=${encodeURIComponent(style)}`,
    { method: "POST", body: formData },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail ?? `Error ${response.status}`);
  }
  return response.json();
}
