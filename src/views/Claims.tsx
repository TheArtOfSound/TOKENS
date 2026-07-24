/**
 * Claim-authority page — the logical floor, made visible.
 *
 * Renders the published claim-authority ladder so a reader (especially an
 * employer) can hold every badge on a profile to exactly what it can establish:
 *
 *     signal → provenance → allowed claim → confidence → limitations
 *
 * The most important line on the page is the one that says there is no universal
 * score and that a combined figure never inherits more authority than its
 * weakest evidence.
 */

import { useEffect, useState } from 'react';
import { href } from '../lib/router';

interface Signal {
  id: string;
  signal: string;
  provenance: string;
  allowedClaim: string;
  confidence: string;
  establishes: string[];
  doesNotEstablish: string[];
  status: 'built' | 'roadmap';
}
interface ClaimAuthority {
  model: string;
  combinedAuthorityRule: string;
  universalNonClaims: string[];
  signals: Signal[];
  note: string;
}

export function Claims() {
  const [data, setData] = useState<ClaimAuthority | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/claim-authority.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) {
    return (
      <section className="panel wide-panel">
        <h2>What evidence can and cannot establish</h2>
        <p className="muted">The claim-authority reference could not be loaded ({error}).</p>
      </section>
    );
  }
  if (!data) {
    return (
      <section className="panel wide-panel">
        <p className="muted">Loading the claim-authority ladder…</p>
      </section>
    );
  }

  return (
    <section className="claims-page" id="claims">
      <h2>What each piece of evidence can — and cannot — establish</h2>
      <p className="lede">
        Every badge on a profile maps to a signal below, and it can support only that signal’s allowed claim,
        at its stated confidence. This is the logical floor: <code>{data.model}</code>.
      </p>

      <div className="claims-invariant" role="note">
        <strong>No universal score.</strong> {data.combinedAuthorityRule}
      </div>

      <div className="claims-universal">
        <h3>None of these signals — alone or combined — establish:</h3>
        <ul>
          {data.universalNonClaims.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </div>

      <ol className="claims-ladder">
        {data.signals.map((s) => (
          <li key={s.id} className={`claim-row claim-${s.status}`}>
            <div className="claim-head">
              <h3>{s.signal}</h3>
              <span className={`claim-status claim-status-${s.status}`}>
                {s.status === 'built' ? 'live' : 'roadmap'}
              </span>
              <span className={`claim-conf claim-conf-${s.confidence}`}>{s.confidence} confidence</span>
            </div>
            <dl className="claim-body">
              <div><dt>Provenance</dt><dd>{s.provenance}</dd></div>
              <div><dt>Allowed claim</dt><dd className="claim-allowed">{s.allowedClaim}</dd></div>
              <div>
                <dt>Establishes</dt>
                <dd><ul className="claim-yes">{s.establishes.map((e) => <li key={e}>{e}</li>)}</ul></dd>
              </div>
              <div>
                <dt>Does <strong>not</strong> establish</dt>
                <dd><ul className="claim-no">{s.doesNotEstablish.map((e) => <li key={e}>{e}</li>)}</ul></dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>

      <p className="muted">
        {data.note} <a href={href({ name: 'verify' })}>How verification works →</a>
      </p>
    </section>
  );
}
