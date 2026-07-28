/**
 * Shared professional-profile view.
 *
 * Extracted from App so the same profile renders for the site operator on the
 * home route and for any member at #/u/<handle>. One implementation means a
 * member's profile can never quietly render with weaker labeling than the
 * operator's.
 */

import { useEffect, useMemo, useState } from 'react';
import { compactNumber, fullNumber } from '../lib/format';
import { MEASUREMENT_LABEL, PublicUsageSnapshot } from '../lib/usage';
import { verifyIdentityProof, type IdentityResult } from '../lib/identity';
import { href } from '../lib/router';
import { safeUrl, safeImageUrl, linkProps } from '../lib/safeUrl';
import { ActivityDisclaimer, SignatureDisclaimer } from './ActivityDisclaimer';
import { EvidenceBadgeRow } from './EvidenceBadge';
import { DurabilityPanel } from './DurabilityPanel';

/**
 * Contact link for member-controlled data.
 *
 * The href is sanitized because a member's snapshot is hand-writable: the old
 * code set href unconditionally and only used startsWith('http') to pick
 * target/rel, so `javascript:` URLs rendered as working links. If the value is
 * unsafe we render the label as plain text rather than a link.
 */
function ContactLink({ contact, className }: { contact: { label: string; href: string }; className: string }) {
  const safe = safeUrl(contact.href, { allowMailto: true });
  if (!safe) return <span className={className} aria-disabled="true">{contact.label}</span>;
  return <a className={className} href={safe.href} {...linkProps(safe)}>{contact.label}</a>;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'Q';
}

function VerificationChip({ item }: { item: NonNullable<PublicUsageSnapshot['profile']>['verification'][number] }) {
  const icon = item.status === 'verified' ? '✓' : item.status === 'reported' ? '◆' : item.status === 'pending' ? '…' : '○';
  return (
    <span className={`vchip vchip-${item.status}`} title={item.basis}>
      <b>{icon}</b> {item.label}
    </span>
  );
}

export function ActivityHeatmap({ daily, referenceDate }: { daily: PublicUsageSnapshot['daily']; referenceDate: string }) {
  const weeks = 26;
  const dayMs = 86_400_000;
  const totals = new Map<string, number>();
  for (const row of daily) totals.set(row.date, (totals.get(row.date) ?? 0) + row.totalTokens);
  const max = Math.max(1, ...Array.from(totals.values()));
  const end = Date.parse(`${referenceDate}T00:00:00Z`);
  const endDow = Number.isNaN(end) ? 6 : new Date(end).getUTCDay();
  const gridEnd = (Number.isNaN(end) ? Date.parse('2026-01-01T00:00:00Z') : end) + (6 - endDow) * dayMs;
  const gridStart = gridEnd - (weeks * 7 - 1) * dayMs;

  const columns: Array<Array<{ date: string; level: number; tokens: number }>> = [];
  for (let w = 0; w < weeks; w += 1) {
    const column: Array<{ date: string; level: number; tokens: number }> = [];
    for (let d = 0; d < 7; d += 1) {
      const ms = gridStart + (w * 7 + d) * dayMs;
      const date = new Date(ms).toISOString().slice(0, 10);
      const tokens = totals.get(date) ?? 0;
      const ratio = tokens / max;
      const level = ms > (Number.isNaN(end) ? gridEnd : end) ? -1 : tokens === 0 ? 0 : ratio > 0.6 ? 4 : ratio > 0.3 ? 3 : ratio > 0.1 ? 2 : 1;
      column.push({ date, level, tokens });
    }
    columns.push(column);
  }

  const activeCells = columns.flat().filter((cell) => cell.level >= 0 && cell.tokens > 0);

  return (
    <div className="heatmap">
      {/*
        The coloured grid is decorative: colour alone cannot convey the values, so
        it is hidden from assistive tech and the same data is exposed as a real
        table below. Previously this was role="img" with one aria-label, which
        hid every per-day value from screen readers with no alternative.
      */}
      <div className="heatmap-grid" aria-hidden="true">
        {columns.map((column, i) => (
          <div className="heatmap-col" key={i}>
            {column.map((cell) => (
              <div
                key={cell.date}
                className={`heatmap-cell ${cell.level < 0 ? 'hm-empty' : `hm-${cell.level}`}`}
                title={cell.level < 0 ? '' : `${cell.date}: ${fullNumber(cell.tokens)} tokens`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="heatmap-legend" aria-hidden="true"><span>Less</span><i className="hm-0" /><i className="hm-1" /><i className="hm-2" /><i className="hm-3" /><i className="hm-4" /><span>More</span></div>

      {/* The accessible equivalent: every active day with its real token count. */}
      <details className="heatmap-data">
        <summary>
          Activity data as a table ({activeCells.length} active {activeCells.length === 1 ? 'day' : 'days'} in the last 26 weeks)
        </summary>
        <div className="heatmap-table-wrap">
          <table>
            <caption>Daily AI-work activity, last 26 weeks. Only days with measured activity are listed.</caption>
            <thead>
              <tr><th scope="col">Date</th><th scope="col">Tokens</th></tr>
            </thead>
            <tbody>
              {activeCells.map((cell) => (
                <tr key={cell.date}>
                  <th scope="row">{cell.date}</th>
                  <td>{fullNumber(cell.tokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

type WorkBlock = NonNullable<PublicUsageSnapshot['profile']>['work'];
type WorkArtifactItem = WorkBlock['artifacts'][number];

const WORK_TYPE_LABEL: Record<WorkArtifactItem['type'], string> = {
  repository: 'Repository',
  deployment: 'Deployment',
  publication: 'Publication',
  case_study: 'Case study',
  evaluation: 'Evaluation',
  research: 'Research',
};

const WORK_BADGE: Record<WorkArtifactItem['verification'], { icon: string; label: string }> = {
  collector_observed: { icon: '✓', label: 'Collector observed' },
  link_provided: { icon: '↗', label: 'Link provided' },
  self_reported: { icon: '○', label: 'Self-reported' },
};

const WORK_RANK: Record<WorkArtifactItem['verification'], number> = {
  collector_observed: 0,
  link_provided: 1,
  self_reported: 2,
};

/**
 * Connected work + outcomes. Strongest evidence first. Every card states exactly
 * how it is backed, so a self-submitted link never reads like verified work.
 */
function WorkEvidenceSection({ work }: { work: WorkBlock | undefined }) {
  if (!work || (!work.artifacts?.length && !work.outcomes?.length)) return null;
  const artifacts = [...(work.artifacts ?? [])].sort((a, b) => WORK_RANK[a.verification] - WORK_RANK[b.verification]);

  return (
    <div className="profile-work" id="work">
      <div className="section-kicker"><span /> CONNECTED WORK &amp; EVIDENCE</div>
      <div className="work-head">
        <h2>Featured work</h2>
        <p>
          {work.collectorObserved} of {work.totalArtifacts} connected {work.totalArtifacts === 1 ? 'artifact was' : 'artifacts were'}{' '}
          independently observed by the local collector. The rest are self-submitted links or claims and are labeled as such.
        </p>
        <p className="work-caveat">
          <strong>“Collector observed”</strong> means the collector saw this project active on the member’s device. It does{' '}
          <strong>not</strong> independently verify authorship, quality, ownership, or commercial results.
        </p>
      </div>

      <div className="work-grid">
        {artifacts.map((item) => {
          const badge = WORK_BADGE[item.verification];
          return (
            <article className={`work-card work-${item.verification}`} key={`${item.type}-${item.title}`}>
              <div className="work-top">
                <span className="work-type">{WORK_TYPE_LABEL[item.type]}</span>
                <span className={`work-badge wb-${item.verification}`} title={item.basis}>
                  <b>{badge.icon}</b> {badge.label}
                </span>
              </div>
              <strong className="work-title">{item.title}</strong>
              {item.description ? <p className="work-desc">{item.description}</p> : null}
              <div className="work-foot">
                {item.period ? <span>{item.period}</span> : null}
                {item.linkedProject ? <span>linked: {item.linkedProject}</span> : null}
                {(() => {
                  const safe = safeUrl(item.url);
                  return safe ? <a href={safe.href} {...linkProps(safe)}>Open ↗</a> : null;
                })()}
              </div>
            </article>
          );
        })}
      </div>

      <div className="work-outcomes">
        <h2>Outcomes</h2>
        {work.outcomes?.length ? (
          <>
            <p className="work-outcome-note">
              Self-reported. Outcome verification requires third-party confirmation and is not implemented yet.
            </p>
            <div className="work-grid">
              {work.outcomes.map((item) => (
                <article className="work-card work-self_reported" key={item.title}>
                  <div className="work-top">
                    <span className="work-type">Outcome</span>
                    <span className="work-badge wb-self_reported" title={item.basis}><b>○</b> Self-reported</span>
                  </div>
                  <strong className="work-title">{item.title}</strong>
                  {item.description ? <p className="work-desc">{item.description}</p> : null}
                  <div className="work-foot">
                    {item.metric ? <span>{item.metric}</span> : null}
                    {item.period ? <span>{item.period}</span> : null}
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : (
          <p className="work-empty">
            No confirmed outcomes yet. Outcomes appear here only when a client or employer confirms them — usage volume alone
            is never treated as an outcome.
          </p>
        )}
      </div>
    </div>
  );
}

type ProfileBlockT = NonNullable<PublicUsageSnapshot['profile']>;

function OpportunityPanel({
  opportunity,
  openTo,
  contact,
}: {
  opportunity: ProfileBlockT['opportunity'];
  openTo: string[];
  contact: { label: string; href: string } | null;
}) {
  if (!opportunity) return null;
  const rows: Array<[string, string | null]> = [
    ['Open to', openTo.length ? openTo.join(' · ') : (opportunity.engagementTypes.join(' · ') || null)],
    ['Compensation', opportunity.compensation],
    ['Typical engagement', opportunity.typicalProjectSize],
    ['Work arrangement', opportunity.workArrangement],
    ['Time zone', opportunity.timezone],
    ['Response time', opportunity.responseTime],
    ['Compute profile', opportunity.computeCostRange],
  ];
  const shown = rows.filter(([, value]) => value);
  if (!shown.length && !contact) return null;
  return (
    <div className="opportunity-panel" id="availability">
      <div className="section-kicker"><span /> AVAILABILITY &amp; ENGAGEMENT</div>
      <div className="opportunity-grid">
        {shown.map(([label, value]) => (
          <div className="opportunity-row" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </div>
      <div className="opportunity-foot">
        {contact ? (
          <ContactLink contact={contact} className="cta cta-sm" />
        ) : null}
        <span className="opportunity-note">{opportunity.note}</span>
      </div>
    </div>
  );
}

function EfficiencyPanel({ efficiency }: { efficiency: ProfileBlockT['efficiency'] }) {
  if (!efficiency) return null;
  const cells: Array<[string, string]> = [];
  if (efficiency.cachedSharePct != null) cells.push(['Cache reuse', `${efficiency.cachedSharePct}%`]);
  if (efficiency.outputSharePct != null) cells.push(['Output share', `${efficiency.outputSharePct}%`]);
  if (efficiency.avgTokensPerActiveDay != null) cells.push(['Avg / active day', compactNumber(efficiency.avgTokensPerActiveDay)]);
  if (!cells.length) return null;
  return (
    <div className="efficiency-panel">
      <h2>Efficiency signals</h2>
      <div className="efficiency-cells">
        {cells.map(([label, value]) => (
          <div key={label}><strong>{value}</strong><span>{label}</span></div>
        ))}
      </div>
      <p className="efficiency-note">{efficiency.note}</p>
    </div>
  );
}

type PracticeBlock = NonNullable<ProfileBlockT['practice']>;

function PracticePanel({ practice }: { practice: PracticeBlock | undefined }) {
  if (!practice) return null;
  const sections: Array<[string, string[]]> = [
    ['Token efficiency architecture', practice.tokenEfficiencyArchitecture ?? []],
    ['Context injection systems', practice.contextInjectionSystems ?? []],
    ['Problem focus', practice.problemFocus ?? []],
    ['Leverage patterns', practice.leveragePatterns ?? []],
  ].filter(([, items]) => items.length > 0) as Array<[string, string[]]>;
  if (!sections.length && !practice.operatingCostNote && !practice.valueDeliveredNote) return null;
  return (
    <div className="practice-panel jcard jcard-pad" id="practice">
      <div className="section-kicker"><span /> AGENT PRACTICE</div>
      <h2 className="jcard-title">How they work with agents</h2>
      <p className="jcard-sub">
        Self-declared practice — architecture, context systems, problem types, and leverage.
        Not measured by the collector. Measured efficiency sits under Activity details.
      </p>
      {sections.map(([title, items]) => (
        <div className="practice-block" key={title}>
          <h3>{title}</h3>
          <ul>
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
      {(practice.operatingCostNote || practice.valueDeliveredNote) ? (
        <div className="practice-value">
          {practice.operatingCostNote ? (
            <div>
              <h3>Operating cost</h3>
              <p>{practice.operatingCostNote}</p>
            </div>
          ) : null}
          {practice.valueDeliveredNote ? (
            <div>
              <h3>Value delivered</h3>
              <p>{practice.valueDeliveredNote}</p>
            </div>
          ) : null}
        </div>
      ) : null}
      <p className="efficiency-note">{practice.note}</p>
    </div>
  );
}

function TelemetryPanel({ telemetry }: { telemetry: PublicUsageSnapshot['telemetry'] }) {
  if (!telemetry || !telemetry.totalEvents) return null;
  const s = telemetry.sessions;
  return (
    <div className="telemetry-panel jcard jcard-pad" id="telemetry">
      <div className="section-kicker"><span /> AGENT TELEMETRY</div>
      <h2 className="jcard-title">Operation telemetry (sanitized)</h2>
      <p className="jcard-sub">
        Hierarchical counts from local usage events. Casual users rarely track this;
        operators who diagnose agent failures do. No prompts, tool payloads, or raw session ids.
      </p>
      <div className="profile-stats telemetry-stats">
        <div><strong>{fullNumber(telemetry.totalEvents)}</strong><span>Usage events</span></div>
        <div><strong>{fullNumber(s.distinctSessions)}</strong><span>Distinct sessions</span></div>
        <div><strong>{s.medianEventsPerSession ?? '—'}</strong><span>Median events / session</span></div>
        <div><strong>{s.p95EventsPerSession ?? '—'}</strong><span>p95 events / session</span></div>
        <div><strong>{s.medianInterEventSeconds != null ? `${s.medianInterEventSeconds}s` : '—'}</strong><span>Median inter-event gap</span></div>
        <div><strong>{telemetry.hierarchy.length}</strong><span>Providers</span></div>
      </div>
      <div className="telemetry-hierarchy">
        {telemetry.hierarchy.map((node) => (
          <details key={node.provider} className="telemetry-node">
            <summary>
              <strong>{node.provider}</strong>
              <span>{fullNumber(node.events)} events · {fullNumber(node.sessions)} sessions</span>
            </summary>
            <ul>
              {node.models.map((m) => (
                <li key={m.model}>
                  <code>{m.model}</code>
                  <span>{fullNumber(m.events)} events · {fullNumber(m.sessions)} sessions</span>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
      <p className="efficiency-note">{telemetry.note}</p>
      {telemetry.limitations?.length ? (
        <details className="telemetry-limits">
          <summary>Limitations &amp; non-claims</summary>
          <ul>
            {telemetry.limitations.map((item) => <li key={item}>{item}</li>)}
          </ul>
          {telemetry.doesNotEstablish?.length ? (
            <p className="efficiency-note">Does not establish: {telemetry.doesNotEstablish.join(', ')}.</p>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}

function EvidenceExport({ handle }: { handle?: string }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://ledger.imagineqira.com';
  const mdUrl = `${origin}${import.meta.env.BASE_URL}data/agent-evidence.md`;
  const jsonUrl = `${origin}${import.meta.env.BASE_URL}data/latest.json`;
  return (
    <div className="evidence-export jcard jcard-pad" id="evidence-export">
      <div className="section-kicker"><span /> AI-EVALUABLE EXPORT</div>
      <h2 className="jcard-title">Evidence dossier for review</h2>
      <p className="jcard-sub">
        A single Markdown file any AI or hiring evaluator can read — projects, practice,
        activity, telemetry hierarchy, and claim boundaries. Same privacy boundary as the
        signed JSON (no prompts, code, or paths).
      </p>
      <div className="evidence-export-actions">
        <a className="btn btn-primary" href={mdUrl} target="_blank" rel="noopener noreferrer">
          Open agent-evidence.md
        </a>
        <a className="btn btn-secondary" href={jsonUrl} target="_blank" rel="noopener noreferrer">
          Open signed latest.json
        </a>
        {handle ? (
          <a className="btn btn-ghost" href={href({ name: 'member', handle })}>
            Profile URL
          </a>
        ) : null}
      </div>
    </div>
  );
}

function IntegrityPanel({ integrity }: { integrity: PublicUsageSnapshot['integrity'] }) {
  if (!integrity || !integrity.checks?.length) return null;
  const passed = integrity.checks.length - integrity.flags;
  return (
    <details className="integrity-panel">
      <summary>
        <span className={`sig sig-${integrity.flags === 0 ? 'valid' : 'unsigned'}`}>
          <span aria-hidden="true" className="sig-dot" />
          {passed}/{integrity.checks.length} integrity checks passed
        </span>
      </summary>
      <ul className="integrity-list">
        {integrity.checks.map((check) => (
          <li key={check.name} className={`integrity-${check.status}`}>
            <strong>{check.status === 'ok' ? '✓' : '⚠'} {check.name}</strong>
            <span>{check.detail}</span>
          </li>
        ))}
      </ul>
      <p className="efficiency-note">{integrity.note}</p>
    </details>
  );
}

function IdentityProofs({
  proofs,
  keyId,
}: {
  proofs: NonNullable<PublicUsageSnapshot['profile']>['identity']['identityProofs'];
  keyId?: string;
}) {
  const [results, setResults] = useState<IdentityResult[]>([]);
  useEffect(() => {
    if (!proofs?.length) return;
    setResults(proofs.map((p) => ({ type: 'github' as const, handle: p.handle, url: `https://github.com/${p.handle}`, state: 'checking' as const, detail: '' })));
    proofs.forEach((proof, i) => {
      verifyIdentityProof(proof, keyId).then((r) =>
        setResults((prev) => {
          const next = [...prev];
          next[i] = r;
          return next;
        }),
      );
    });
  }, [proofs, keyId]);
  if (!proofs?.length) return null;
  return (
    <div className="identity-proofs">
      {results.map((r) => (
        <a
          key={r.handle}
          className={`idp idp-${r.state}`}
          href={r.url}
          target="_blank"
          rel="noopener noreferrer"
          title={r.detail}
        >
          <span aria-hidden="true" className="idp-dot" />
          {r.state === 'verified'
            ? `Controls github.com/${r.handle} ✓`
            : r.state === 'failed'
              ? `Identity proof failed (@${r.handle})`
              : r.state === 'unreachable'
                ? `Identity proof unreachable (@${r.handle})`
                : `Verifying @${r.handle}…`}
        </a>
      ))}
      <a className="idp-explain" href={href({ name: 'claims' })}>what this proves →</a>
    </div>
  );
}

/**
 * Embeddable badge — the distribution loop.
 *
 * A member pastes this into their README or site and it links back to their
 * verifiable profile. It deliberately reports ACTIVE DAYS, never token volume:
 * a token count on a README is precisely the vanity metric this project refuses.
 */
const BADGE_VARIANTS = [
  {
    id: 'inline',
    file: 'badge.svg',
    name: 'Inline',
    blurb: 'Your active-day count. Sits inline with other README badges.',
  },
  {
    id: 'mark',
    file: 'badge-mark.svg',
    name: 'Mark',
    blurb: 'No numbers at all — just that a signed snapshot exists.',
  },
  {
    id: 'card',
    file: 'badge-card.svg',
    name: 'Card',
    blurb: 'The full record, and the caveats that go with it, on one image.',
  },
] as const;

function BadgeEmbed({ handle }: { handle?: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [variant, setVariant] = useState<string>('inline');
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://ledger.imagineqira.com';
  const chosen = BADGE_VARIANTS.find((v) => v.id === variant) ?? BADGE_VARIANTS[0];

  // Each member serves their own badge next to their own snapshot. Pointing at
  // this site's file would hand every member the operator's numbers to paste
  // into their README.
  const badgeUrl = `${origin}${import.meta.env.BASE_URL}data/${chosen.file}`;
  const profileUrl = handle ? `${origin}${href({ name: 'member', handle })}` : origin;
  const alt = 'Ledger — signed record of AI-assisted work, verifiable in your browser';
  const snippets: Array<[string, string]> = [
    ['Markdown', `[![${alt}](${badgeUrl})](${profileUrl})`],
    ['HTML', `<a href="${profileUrl}"><img src="${badgeUrl}" alt="${alt}"></a>`],
  ];
  const copy = (label: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1600);
    }, () => setCopied(null));
  };

  return (
    <div className="jcard jcard-pad badge-embed">
      <h2 className="jcard-title">Put this on your README</h2>
      <p className="jcard-sub">
        Every badge links back here so a reader can re-check the signature themselves. Pick how much you want
        to publish — none of them show token volume.
      </p>

      <div className="badge-picker" role="radiogroup" aria-label="Badge style">
        {BADGE_VARIANTS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={v.id === variant}
            className={`badge-option${v.id === variant ? ' is-on' : ''}`}
            onClick={() => setVariant(v.id)}
          >
            <span className="badge-option-name">{v.name}</span>
            <span className="badge-option-blurb">{v.blurb}</span>
          </button>
        ))}
      </div>

      <img className="badge-preview" src={badgeUrl} alt={`${chosen.name} badge preview`} />

      <div className="badge-snippets">
        {snippets.map(([label, text]) => (
          <div className="badge-snippet" key={label}>
            <span className="badge-snippet-label">{label}</span>
            <code>{text}</code>
            <button type="button" className="btn btn-ghost" onClick={() => copy(label, text)}>
              {copied === label ? 'Copied' : 'Copy'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProfileView({
  profile,
  daily,
  integrity,
  keyId,
  handle,
  claimAuthority,
  durability,
  telemetry,
}: {
  profile: NonNullable<PublicUsageSnapshot['profile']>;
  daily: PublicUsageSnapshot['daily'];
  integrity?: PublicUsageSnapshot['integrity'];
  keyId?: string;
  handle?: string;
  claimAuthority?: PublicUsageSnapshot['claimAuthority'];
  durability?: PublicUsageSnapshot['durability'];
  telemetry?: PublicUsageSnapshot['telemetry'];
}) {
  const { identity, activity, verification } = profile;
  const contact = identity.contact ?? null;
  // Only a member's own declaration turns this on — never inferred from activity.
  const isOpenToWork =
    identity.openTo.length > 0 ||
    (profile.opportunity?.engagementTypes?.length ?? 0) > 0 ||
    Boolean(identity.availability);
  return (
    <section className="profile" id="profile">
      {/* LinkedIn-style masthead: cover, overlapping avatar, identity, actions. */}
      <div className="jcard jprofile">
        <div className="jprofile-cover" aria-hidden="true" />
        <div className="jprofile-body">
          <div className={`jprofile-avatar-wrap ${isOpenToWork ? 'is-open' : ''}`}>
            {safeImageUrl(identity.avatarUrl) ? (
              <div className="jprofile-avatar">
                <img src={safeImageUrl(identity.avatarUrl) ?? ''} alt={`${identity.displayName} headshot`} loading="lazy" />
              </div>
            ) : (
              <div className="jprofile-avatar" aria-hidden="true">{initials(identity.displayName)}</div>
            )}
            {isOpenToWork ? <span className="open-ring">Open to work</span> : null}
          </div>

          <div className="jprofile-top">
            <div className="jprofile-id">
              <h1 className="jprofile-name">
                {identity.displayName}
                {identity.pronouns ? <span className="profile-pronouns"> · {identity.pronouns}</span> : null}
              </h1>
              <p className="jprofile-headline">{identity.headline}</p>
              <p className="jprofile-meta">
                {identity.location ? <span>{identity.location}</span> : null}
                {activity.toolsUsed.length ? <span>{activity.toolsUsed.join(' · ')}</span> : null}
                {identity.links.map((link) => {
                  const safe = safeUrl(link.url);
                  if (!safe) return null; // member-controlled: drop anything not https
                  return <a key={link.url} href={safe.href} {...linkProps(safe)}>{link.label} ↗</a>;
                })}
              </p>
              <IdentityProofs proofs={identity.identityProofs} keyId={keyId} />

              <div className="jprofile-actions">
                {contact ? (
                  <ContactLink contact={contact} className="btn btn-primary" />
                ) : null}
                <a className="btn btn-secondary" href="#work">View work</a>
                <a className="btn btn-ghost" href={href({ name: 'claims' })}>What this proves</a>
              </div>
            </div>
          </div>

          {/* The green "open to work" card, shown only when the member actually
              declared availability — never inferred. */}
          {isOpenToWork ? (
            <div className="open-card">
              <h2>Open to work</h2>
              <p>{(identity.openTo.length ? identity.openTo : profile.opportunity?.engagementTypes ?? []).join(' · ')}</p>
              {identity.availability ? <p className="open-detail">{identity.availability}</p> : null}
            </div>
          ) : null}

          {/* Claim-bounded evidence: prefer snapshot claimAuthority when present. */}
          <div className="profile-verify">
            {claimAuthority?.signals?.length ? (
              <EvidenceBadgeRow signals={claimAuthority.signals} onlyPresent max={8} />
            ) : (
              <>
                {verification.filter((v) => v.status !== 'pending').map((item) => (
                  <VerificationChip key={item.label} item={item} />
                ))}
                {verification.some((v) => v.status === 'pending') ? (
                  <a className="vchip vchip-more" href={href({ name: 'claims' })}>
                    +{verification.filter((v) => v.status === 'pending').length} evidence tiers not yet met →
                  </a>
                ) : null}
              </>
            )}
          </div>
          <SignatureDisclaimer compact />
        </div>
      </div>

      {identity.bio ? (
        <div className="jcard jcard-pad">
          <h2 className="jcard-title">About</h2>
          <p className="profile-bio">{identity.bio}</p>
        </div>
      ) : null}

      <BadgeEmbed handle={handle} />

      {/* Availability & engagement — a buyer sees terms without inferring cost from tokens. */}
      <OpportunityPanel opportunity={profile.opportunity} openTo={identity.openTo} contact={contact} />

      {/* Business value framing (cost of operating + value delivered) sits with practice. */}
      <PracticePanel practice={profile.practice} />

      {/* 2 + 3. Featured work and outcomes — what they built comes before telemetry. */}
      <WorkEvidenceSection work={profile.work} />

      {/* Post-merge durability — evidence only, never a quality score. */}
      <DurabilityPanel durability={durability} />

      {/* AI-evaluable dossier for reviewers / other agents. */}
      <EvidenceExport handle={handle} />

      {/* Hierarchical agent-operation telemetry (sanitized). */}
      <TelemetryPanel telemetry={telemetry} />

      {/* 4. AI-tool experience. */}
      <div className="profile-cols">
        <div className="profile-block">
          <h2>AI tools &amp; models</h2>
          <div className="tag-row">{activity.toolsUsed.map((tool) => <span key={tool} className="tag-strong">{tool}</span>)}</div>
          {activity.modelsUsed.length ? <div className="tag-row">{activity.modelsUsed.slice(0, 10).map((model) => <span key={model}>{model}</span>)}</div> : null}
        </div>
        <div className="profile-block">
          {identity.workCategories.length ? <><h2>Work categories</h2><div className="tag-row">{identity.workCategories.map((category) => <span key={category}>{category}</span>)}</div></> : null}
          {identity.openTo.length ? <><h2>Open to</h2><div className="tag-row">{identity.openTo.map((item) => <span key={item} className="tag-open">{item}</span>)}</div></> : null}
        </div>
      </div>

      {/* 5. Detailed activity, last — and explicitly framed as not a score. */}
      <div className="profile-telemetry">
        <div className="section-kicker"><span /> ACTIVITY &amp; EFFICIENCY DETAILS</div>
        <ActivityDisclaimer compact />
        <div className="profile-stats">
          <div><strong>{fullNumber(activity.activeDays)}</strong><span>Active AI-work days</span></div>
          <div><strong>{activity.currentStreakDays}</strong><span>Current streak (days)</span></div>
          <div><strong>{activity.longestStreakDays}</strong><span>Longest streak (days)</span></div>
          <div><strong>{activity.activeDaysLast30}</strong><span>Active in last 30 days</span></div>
          <div><strong>{activity.toolsUsed.length}</strong><span>AI tools used</span></div>
          <div><strong>{activity.projectsActive}</strong><span>Projects active</span></div>
        </div>
        <EfficiencyPanel efficiency={profile.efficiency} />
        <IntegrityPanel integrity={integrity} />
        <ActivityHeatmap daily={daily} referenceDate={activity.referenceDate} />
        <p className="profile-note">{profile.note}</p>
      </div>
    </section>
  );
}

