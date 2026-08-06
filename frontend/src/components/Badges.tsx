import type { DetectionOutcome, VisitStatus } from "../api/types";

export function StatusBadge({ status }: { status: VisitStatus }) {
  return (
    <span className={`badge ${status === "OPEN" ? "open" : "exited"}`}>
      {status === "OPEN" ? "Dentro" : "Salió"}
    </span>
  );
}

export function AnomalyBadge({ anomaly }: { anomaly: boolean }) {
  if (!anomaly) return null;
  return <span className="badge anomaly">Anomalía</span>;
}

const OUTCOME_LABELS: Record<DetectionOutcome, string> = {
  NEW_ENTRY: "Entrada nueva",
  SAME_STAY_REENTRY: "Reingreso (misma estadía)",
  EXIT: "Salida",
  DUPLICATE_ENTRY_ANOMALY: "Entrada duplicada (anomalía)",
  EXIT_WITHOUT_ENTRY_ANOMALY: "Salida sin entrada (anomalía)",
};

export function OutcomeBadge({ outcome }: { outcome: DetectionOutcome }) {
  const isAnomaly = outcome.includes("ANOMALY");
  const isReentry = outcome === "SAME_STAY_REENTRY";
  const cls = isAnomaly ? "anomaly" : isReentry ? "warn" : outcome === "NEW_ENTRY" ? "open" : "exited";
  return <span className={`badge ${cls}`}>{OUTCOME_LABELS[outcome]}</span>;
}

export function Plate({ value }: { value: string }) {
  return <span className="plate">{value}</span>;
}
