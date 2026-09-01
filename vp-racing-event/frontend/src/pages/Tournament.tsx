import { useEffect, useState } from "react";
import { createTournament, getTournament, recordResult, type Match, type Tournament } from "../api";

const STORAGE_KEY = "vp-racing-tournament-id";

function roundLabel(roundNumber: number, totalRounds: number): string {
  const roundsFromEnd = totalRounds - roundNumber;
  if (roundsFromEnd === 0) return "Final";
  if (roundsFromEnd === 1) return "Semifinal";
  if (roundsFromEnd === 2) return "Cuartos de final";
  return `Ronda ${roundNumber}`;
}

function CreateTournamentForm({ onCreated }: { onCreated: (t: Tournament) => void }) {
  const [names, setNames] = useState(
    Array.from({ length: 12 }, (_, i) => `Participante ${i + 1}`).join("\n"),
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const participantNames = names
      .split("\n")
      .map((n) => n.trim())
      .filter(Boolean);
    if (participantNames.length < 2) {
      setError("Cargá al menos 2 participantes");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const tournament = await createTournament("Torneo VP Racing", participantNames);
      localStorage.setItem(STORAGE_KEY, String(tournament.id));
      onCreated(tournament);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error creando el torneo");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="page">
      <h1>Nuevo torneo</h1>
      <p className="hint">Un nombre por línea. Se arma el bracket automáticamente (con pases directos si no es potencia de 2).</p>
      <textarea
        rows={14}
        value={names}
        onChange={(event) => setNames(event.target.value)}
        className="names-textarea"
      />
      {error && <p className="error">{error}</p>}
      <button type="submit" className="primary-button" disabled={submitting}>
        {submitting ? "Creando…" : "Crear torneo"}
      </button>
    </form>
  );
}

function MatchCard({ tournamentId, match, onUpdated }: { tournamentId: number; match: Match; onUpdated: () => void }) {
  const [time1, setTime1] = useState("");
  const [time2, setTime2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canPlay = !match.is_bye && match.participant1 && match.participant2;
  const decided = match.winner !== null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const t1 = Number(time1);
    const t2 = Number(time2);
    if (!Number.isFinite(t1) || !Number.isFinite(t2)) {
      setError("Ingresá ambos tiempos");
      return;
    }
    setSubmitting(true);
    try {
      await recordResult(tournamentId, match.id, t1, t2);
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cargando el resultado");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={`match-card ${decided ? "decided" : ""} ${match.is_bye ? "bye" : ""}`}>
      {match.is_bye ? (
        <p>
          <strong>{match.winner?.name ?? match.participant1?.name}</strong> — pase directo
        </p>
      ) : (
        <>
          <p className={match.winner?.id === match.participant1?.id ? "winner" : ""}>
            {match.participant1?.name ?? "Por definir"}
            {match.time1_seconds != null && ` — ${match.time1_seconds}s`}
          </p>
          <p className={match.winner?.id === match.participant2?.id ? "winner" : ""}>
            {match.participant2?.name ?? "Por definir"}
            {match.time2_seconds != null && ` — ${match.time2_seconds}s`}
          </p>
          {canPlay && !decided && (
            <form onSubmit={submit} className="match-form">
              <input
                type="number"
                step="0.01"
                placeholder={`Tiempo ${match.participant1?.name}`}
                value={time1}
                onChange={(event) => setTime1(event.target.value)}
              />
              <input
                type="number"
                step="0.01"
                placeholder={`Tiempo ${match.participant2?.name}`}
                value={time2}
                onChange={(event) => setTime2(event.target.value)}
              />
              <button type="submit" disabled={submitting}>
                {submitting ? "Cargando…" : "Cargar resultado"}
              </button>
              {error && <p className="error">{error}</p>}
            </form>
          )}
        </>
      )}
    </div>
  );
}

function BracketView({ tournament, onRefresh }: { tournament: Tournament; onRefresh: () => void }) {
  const totalRounds = Math.max(...tournament.matches.map((m) => m.round_number));
  const rounds = Array.from({ length: totalRounds }, (_, i) => i + 1).map((roundNumber) => ({
    roundNumber,
    matches: tournament.matches
      .filter((m) => m.round_number === roundNumber)
      .sort((a, b) => a.match_index - b.match_index),
  }));
  const champion = rounds[rounds.length - 1]?.matches[0]?.winner;

  return (
    <div className="page">
      <h1>{tournament.name}</h1>
      {champion && <p className="champion">🏆 Campeón: {champion.name}</p>}
      <button
        type="button"
        className="link-button"
        onClick={() => {
          localStorage.removeItem(STORAGE_KEY);
          window.location.reload();
        }}
      >
        Empezar un torneo nuevo
      </button>
      <div className="bracket">
        {rounds.map(({ roundNumber, matches }) => (
          <div key={roundNumber} className="bracket-round">
            <h3>{roundLabel(roundNumber, totalRounds)}</h3>
            {matches.map((match) => (
              <MatchCard key={match.id} tournamentId={tournament.id} match={match} onUpdated={onRefresh} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TournamentPage() {
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const id = localStorage.getItem(STORAGE_KEY);
    if (!id) {
      setLoading(false);
      return;
    }
    try {
      setTournament(await getTournament(Number(id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cargando el torneo");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  if (loading) return <p className="page">Cargando…</p>;
  if (error) return <p className="page error">{error}</p>;
  if (!tournament) return <CreateTournamentForm onCreated={setTournament} />;
  return <BracketView tournament={tournament} onRefresh={refresh} />;
}
