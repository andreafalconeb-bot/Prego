export type CameraRole = "ENTRY" | "EXIT" | "GENERAL";
export type Direction = "IN" | "OUT";
export type VisitStatus = "OPEN" | "EXITED";
export type DetectionOutcome =
  | "NEW_ENTRY"
  | "SAME_STAY_REENTRY"
  | "EXIT"
  | "DUPLICATE_ENTRY_ANOMALY"
  | "EXIT_WITHOUT_ENTRY_ANOMALY";
export type UserRole = "ADMIN" | "OPERATOR";

export interface User {
  id: number;
  username: string;
  full_name: string | null;
  role: UserRole;
  active: boolean;
}

export interface Camera {
  id: number;
  name: string;
  role: CameraRole;
  location: string | null;
  stream_url: string | null;
  active: boolean;
  created_at: string;
}

export interface DetectionEvent {
  id: number;
  visit_id: number | null;
  camera_id: number;
  direction: Direction;
  plate_raw: string;
  confidence: number | null;
  photo_path: string | null;
  outcome: DetectionOutcome;
  detected_at: string;
}

export interface Visit {
  id: number;
  plate: string;
  status: VisitStatus;
  entry_time: string;
  exit_time: string | null;
  entry_camera_id: number | null;
  exit_camera_id: number | null;
  ticket_number: string | null;
  ticket_printed: boolean;
  ticket_printed_at: string | null;
  reentry_count: number;
  anomaly: boolean;
  anomaly_note: string | null;
}

export interface VisitDetail extends Visit {
  detection_events: DetectionEvent[];
}

export interface Settings {
  parking_name: string;
  address: string | null;
  reentry_threshold_minutes: number;
  timezone: string;
  printer_enabled: boolean;
  printer_connection_type: string;
  printer_target: string | null;
}

export interface TicketCharge {
  id: number;
  ticket_number: string | null;
  plate: string;
  amount: number;
  charged_at: string;
  charged_by: string | null;
  notes: string | null;
  matched_visit_id: number | null;
}

export interface AuditReport {
  start: string;
  end: string;
  total_charged: number;
  matched_count: number;
  visits_without_charge: Visit[];
  charges_without_visit: TicketCharge[];
  matched: { visit: Visit; charge: TicketCharge }[];
}

export interface DashboardData {
  vehicles_inside: number;
  entries_today: number;
  exits_today: number;
  tickets_printed_today: number;
  reentries_today: number;
  anomalies_today: number;
}
