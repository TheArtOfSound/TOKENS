/**
 * The permanent "not a score" statement.
 *
 * Reddit feedback was blunt: people read the token number as skill, productivity,
 * or pay. This line must appear NEXT TO every token total — never buried in a
 * methodology page — so the number is always framed the moment it is seen.
 */
export function ActivityDisclaimer({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <p className="activity-disclaimer activity-disclaimer-compact">
        Activity volume is one signal — not a skill, productivity, or pay score.
      </p>
    );
  }
  return (
    <p className="activity-disclaimer">
      <strong>Token volume is not a skill, productivity, or compensation score.</strong> It is one activity
      signal, interpreted alongside work artifacts, efficiency, assessments, and confirmed outcomes. Producing
      the same result with fewer tokens is better, not worse.
    </p>
  );
}
