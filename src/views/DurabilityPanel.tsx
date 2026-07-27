/**
 * Post-merge durability panel.
 *
 * Renders evidence sentences only — never a quality score or rank.
 */

import type { PublicUsageSnapshot } from '../lib/usage';
import { href } from '../lib/router';

type Durability = NonNullable<PublicUsageSnapshot['durability']>;

export function DurabilityPanel({ durability }: { durability?: Durability | null }) {
  if (!durability?.projects?.length) {
    return (
      <div className="jcard jcard-pad durability-panel">
        <h2 className="jcard-title">Work durability</h2>
        <p className="muted">
          Post-merge survival evidence is not present on this snapshot. When measured, TOKENS reports how
          linked work changed over 24h–90d windows — reverts, corrective commits, remaining lines —{' '}
          <strong>without</strong> converting that into a quality score.
        </p>
        <p className="muted">
          <a href={href({ name: 'claims' })}>Claim boundaries →</a>
        </p>
      </div>
    );
  }

  return (
    <div className="jcard jcard-pad durability-panel">
      <h2 className="jcard-title">Work durability (evidence, not a score)</h2>
      <p className="jcard-sub">{durability.note}</p>
      <p className="muted">
        Does not establish: {(durability.doesNotEstablish ?? []).join(', ') || 'expertise, quality, skill'}.
      </p>
      {durability.projects.map((p) => (
        <article key={p.projectName} className="durability-project">
          <h3>{p.projectName}</h3>
          <p className="muted">{p.note}</p>
          <ul className="durability-windows">
            {p.windows.map((w) => (
              <li key={w.window}>
                <strong>{w.window}</strong>
                <span>{w.summary}</span>
              </li>
            ))}
          </ul>
          {p.limitations?.length ? (
            <details>
              <summary>Limitations</summary>
              <ul className="muted">
                {p.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </article>
      ))}
    </div>
  );
}
