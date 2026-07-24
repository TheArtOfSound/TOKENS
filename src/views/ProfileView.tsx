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
import { ActivityDisclaimer } from './ActivityDisclaimer';

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
        <h3>Featured work</h3>
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
                {item.url ? <a href={item.url} target="_blank" rel="noreferrer">Open ↗</a> : null}
              </div>
            </article>
          );
        })}
      </div>

      <div className="work-outcomes">
        <h3>Outcomes</h3>
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
          <a className="cta cta-sm" href={contact.href} {...(contact.href.startsWith('http') ? { target: '_blank', rel: 'noreferrer' } : {})}>
            {contact.label}
          </a>
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
      <h3>Efficiency signals</h3>
      <div className="efficiency-cells">
        {cells.map(([label, value]) => (
          <div key={label}><strong>{value}</strong><span>{label}</span></div>
        ))}
      </div>
      <p className="efficiency-note">{efficiency.note}</p>
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
          rel="noreferrer"
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

export function ProfileView({
  profile,
  daily,
  integrity,
  keyId,
}: {
  profile: NonNullable<PublicUsageSnapshot['profile']>;
  daily: PublicUsageSnapshot['daily'];
  integrity?: PublicUsageSnapshot['integrity'];
  keyId?: string;
}) {
  const { identity, activity, verification } = profile;
  const contact = identity.contact ?? null;
  return (
    <section className="profile" id="profile">
      {/* 1. Identity, availability, and the recruiter action lead. */}
      <div className="profile-card">
        <div className="profile-id">
          {identity.avatarUrl ? (
            <img className="profile-avatar profile-photo" src={identity.avatarUrl} alt={`${identity.displayName} headshot`} loading="lazy" />
          ) : (
            <div className="profile-avatar" aria-hidden="true">{initials(identity.displayName)}</div>
          )}
          <div>
            <h2 className="profile-name">
              {identity.displayName}
              {identity.pronouns ? <span className="profile-pronouns"> · {identity.pronouns}</span> : null}
            </h2>
            <p className="profile-role">{identity.headline}</p>
            <div className="profile-meta">
              {identity.location ? <span>{identity.location}</span> : null}
              {identity.availability ? <span className="profile-avail">{identity.availability}</span> : null}
            </div>
            {identity.links.length ? (
              <div className="profile-links">
                {identity.links.map((link) => (
                  <a key={link.url} href={link.url} target="_blank" rel="noreferrer">{link.label} ↗</a>
                ))}
              </div>
            ) : null}
            <IdentityProofs proofs={identity.identityProofs} keyId={keyId} />
          </div>
        </div>

        {contact ? (
          <div className="profile-actions">
            <a
              className="profile-cta"
              href={contact.href}
              {...(contact.href.startsWith('http') ? { target: '_blank', rel: 'noreferrer' } : {})}
            >
              {contact.label}
            </a>
          </div>
        ) : null}

        {/* Evidence tiers span the full width below the header. Met tiers lead;
            unmet tiers collapse into one link so a recruiter isn't met by a wall
            of "pending". */}
        <div className="profile-verify">
          {verification.filter((v) => v.status !== 'pending').map((item) => (
            <VerificationChip key={item.label} item={item} />
          ))}
          {verification.some((v) => v.status === 'pending') ? (
            <a className="vchip vchip-more" href={href({ name: 'claims' })}>
              +{verification.filter((v) => v.status === 'pending').length} evidence tiers not yet met →
            </a>
          ) : null}
        </div>
      </div>

      {identity.bio ? <p className="profile-bio">{identity.bio}</p> : null}

      {/* Availability & engagement — a buyer sees terms without inferring cost from tokens. */}
      <OpportunityPanel opportunity={profile.opportunity} openTo={identity.openTo} contact={contact} />

      {/* 2 + 3. Featured work and outcomes — what they built comes before telemetry. */}
      <WorkEvidenceSection work={profile.work} />

      {/* 4. AI-tool experience. */}
      <div className="profile-cols">
        <div className="profile-block">
          <h3>AI tools &amp; models</h3>
          <div className="tag-row">{activity.toolsUsed.map((tool) => <span key={tool} className="tag-strong">{tool}</span>)}</div>
          {activity.modelsUsed.length ? <div className="tag-row">{activity.modelsUsed.slice(0, 10).map((model) => <span key={model}>{model}</span>)}</div> : null}
        </div>
        <div className="profile-block">
          {identity.workCategories.length ? <><h3>Work categories</h3><div className="tag-row">{identity.workCategories.map((category) => <span key={category}>{category}</span>)}</div></> : null}
          {identity.openTo.length ? <><h3>Open to</h3><div className="tag-row">{identity.openTo.map((item) => <span key={item} className="tag-open">{item}</span>)}</div></> : null}
        </div>
      </div>

      {/* 5. Detailed telemetry, last — and explicitly framed as not a score. */}
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

