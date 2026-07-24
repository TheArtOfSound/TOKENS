/**
 * Comparison page.
 *
 * Reddit surfaced adjacent tools (metering: ccusage, Claude Code Usage Monitor;
 * audit: AgentRail) and asked what makes TOKENS different. The honest answer is
 * NOT "we're a better monitor." TOKENS is the portable evidence/identity layer
 * ABOVE specialized tools — it should import their machine-readable output, not
 * duplicate it. This page states that plainly, including where the other tools
 * are stronger.
 */

import { href } from '../lib/router';

interface Row {
  capability: string;
  metering: string;
  audit: string;
  tokens: string;
}

const ROWS: Row[] = [
  { capability: 'Live rate-limit / burn-down', metering: 'Strong', audit: '—', tokens: 'Not the goal (import instead)' },
  { capability: 'Local usage history', metering: 'Strong', audit: 'Partial', tokens: 'Event ledger (dedup, incremental)' },
  { capability: 'Issue → PR → CI audit trail', metering: '—', audit: 'Strong', tokens: 'Import target (planned)' },
  { capability: 'Deduplicated cross-session events', metering: 'Partial', audit: 'Partial', tokens: 'Yes — provider message-id keyed' },
  { capability: 'Privacy allowlist + local signing', metering: '—', audit: '—', tokens: 'Core' },
  { capability: 'Browser-verifiable signature', metering: '—', audit: '—', tokens: 'Core' },
  { capability: 'Portable professional profile', metering: '—', audit: '—', tokens: 'Core' },
  { capability: 'Evidence ladder (device → third-party)', metering: '—', audit: '—', tokens: 'Core' },
  { capability: 'Employer-facing discovery', metering: '—', audit: '—', tokens: 'Yes' },
];

export function Compare() {
  return (
    <section className="compare-page" id="compare">
      <h2>Where TOKENS fits</h2>
      <p className="lede">
        TOKENS is not trying to be the best usage monitor or the best audit trail. It is the portable evidence
        layer that sits above them: it turns measured activity, connected work, and independent verification
        into a professional record you own. Where specialized tools are stronger, the right move is to import
        their output — not reinvent it.
      </p>

      <div className="compare-table-wrap">
        <table className="compare-table">
          <caption className="visually-hidden">Capability comparison across tool categories</caption>
          <thead>
            <tr>
              <th scope="col">Capability</th>
              <th scope="col">Metering<br /><small>ccusage, Claude Code Usage Monitor</small></th>
              <th scope="col">Audit trail<br /><small>AgentRail</small></th>
              <th scope="col">TOKENS<br /><small>evidence layer</small></th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.capability}>
                <th scope="row">{r.capability}</th>
                <td>{r.metering}</td>
                <td>{r.audit}</td>
                <td className="compare-tokens">{r.tokens}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="join-honest">
        <h3>Integrations, not competitors</h3>
        <ul>
          <li>
            <strong>Metering tools</strong> are better at live monitoring, rate limits, and forecasting. TOKENS
            can <em>import</em> their machine-readable history rather than duplicate it — see{' '}
            <a href="https://github.com/TheArtOfSound/TOKENS/blob/main/docs/architecture/IMPORTING.md" target="_blank" rel="noreferrer">the import framework</a>.
          </li>
          <li>
            <strong>Audit tools</strong> are better at issue-to-PR provenance and cross-session workflow history.
            An adapter that imports completed-work evidence into a TOKENS profile is the intended direction.
          </li>
          <li>
            <strong>Résumés and LinkedIn</strong> carry claims. TOKENS carries signed, browser-verifiable
            evidence with an explicit ladder of how strong each piece is.
          </li>
        </ul>
        <p>
          <a href={href({ name: 'verify' })}>How verification works →</a> · <a href={href({ name: 'join' })}>Build your evidence record →</a>
        </p>
      </section>
    </section>
  );
}
