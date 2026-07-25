/**
 * Employer surface.
 *
 * The buyer-facing view. It answers "what am I actually getting?" before any
 * token number: relevant work, evidence strength, availability, and engagement
 * terms. Raw activity volume is hidden behind "activity details" per the
 * feedback, so a recruiter never reads a big number as skill or salary.
 *
 * Filters operate on data read from each member's signed snapshot.
 */

import { useMemo, useState } from 'react';
import { useMemberProfiles, type MemberProfile } from '../lib/members';
import { compactNumber } from '../lib/format';
import { href } from '../lib/router';
import { safeUrl, linkProps } from '../lib/safeUrl';
import { SignatureBadge } from './SignatureBadge';
import { ErrorBoundary } from './ErrorBoundary';

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || 'Q';
}

const TOOLS = ['Claude Code', 'Codex'];

export function Employer() {
  const { profiles, error } = useMemberProfiles();
  const [tool, setTool] = useState('');
  const [category, setCategory] = useState('');
  const [minDays, setMinDays] = useState(0);
  const [openToOnly, setOpenToOnly] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const categories = useMemo(() => {
    const set = new Set<string>();
    profiles.forEach((p) => p.workCategories.forEach((c) => set.add(c)));
    return [...set].sort();
  }, [profiles]);

  const results = useMemo(
    () =>
      profiles.filter((p) => {
        if (!p.member) return false;
        if (tool && !p.toolsUsed.includes(tool)) return false;
        if (category && !p.workCategories.includes(category)) return false;
        if (minDays && p.activeDays < minDays) return false;
        if (openToOnly && p.openTo.length === 0 && p.engagementTypes.length === 0) return false;
        return true;
      }),
    [profiles, tool, category, minDays, openToOnly],
  );

  if (error) {
    return (
      <section className="panel wide-panel">
        <h2>Find people</h2>
        <p className="muted">The directory could not be loaded ({error}).</p>
      </section>
    );
  }

  return (
    <section className="employer" id="employer">
      <header className="employer-head">
        <div>
          <h2>Find people by evidence, not by résumé.</h2>
          <p className="muted">
            Every candidate below is backed by a signed snapshot verified in your browser. Results emphasize
            relevant work, evidence strength, and availability. Activity volume is available on request — it is
            never the ranking.
          </p>
        </div>
      </header>

      <div className="employer-filters jcard jcard-pad">
        <label>Tool
          <select value={tool} onChange={(e) => setTool(e.target.value)}>
            <option value="">Any</option>
            {TOOLS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>Work category
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Any</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label>Min. active days
          <select value={minDays} onChange={(e) => setMinDays(Number(e.target.value))}>
            {[0, 10, 30, 60, 90].map((d) => <option key={d} value={d}>{d === 0 ? 'Any' : `${d}+`}</option>)}
          </select>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={openToOnly} onChange={(e) => setOpenToOnly(e.target.checked)} />
          Open to opportunities
        </label>
      </div>

      {results.length === 0 ? <p className="muted">No candidates match these filters yet.</p> : null}

      {profiles.length > 0 && profiles.length < 5 ? (
        <div className="employer-early">
          <strong>This talent pool is new.</strong> {profiles.length === 1 ? 'There is' : 'There are'}{' '}
          {profiles.length} verified {profiles.length === 1 ? 'profile' : 'profiles'} so far. Everyone here is backed by a signed,
          browser-verifiable record rather than a self-written résumé — and the pool grows as people publish.
          <a href={href({ name: 'join' })}>Invite someone to add theirs →</a>
        </div>
      ) : null}

      <ul className="candidate-list jcard">
        {results.map((p) => (
          <ErrorBoundary key={p.member.handle} label={`the profile for @${p.member.handle}`}>
            <Candidate p={p} expanded={!!expanded[p.member.handle]} onToggle={() =>
              setExpanded((prev) => ({ ...prev, [p.member.handle]: !prev[p.member.handle] }))} />
          </ErrorBoundary>
        ))}
      </ul>

      <p className="directory-footnote">
        A verified signature proves a snapshot is authentic and unaltered. A linked account proves the member
        controls that account — <strong>not</strong> their legal identity. Provider-attested usage and
        third-party-confirmed outcomes are separate, stronger tiers, shown per profile.{' '}
        <a href={href({ name: 'claims' })}>What each signal can and cannot establish →</a>
      </p>
    </section>
  );
}

function Candidate({ p, expanded, onToggle }: { p: MemberProfile; expanded: boolean; onToggle: () => void }) {
  const m = p.member;
  return (
    <li className="candidate-card">
      <a className="candidate-id" href={href({ name: 'member', handle: m.handle })}>
        <span className="member-avatar" aria-hidden="true">{initials(m.displayName)}</span>
        <span className="member-identity">
          <strong>{m.displayName}</strong>
          <span className="member-headline">{m.headline}</span>
          {m.location ? <span className="member-location">{m.location}</span> : null}
        </span>
      </a>

      <div className="candidate-body">
        {p.workCategories.length ? (
          <div className="candidate-tags">{p.workCategories.slice(0, 5).map((c) => <span key={c}>{c}</span>)}</div>
        ) : null}

        <dl className="candidate-facts">
          {p.identityProofs.length ? (
            <div>
              <dt>Linked accounts</dt>
              <dd>{p.identityProofs.map((x) => `${x.type}/${x.handle}`).join(' · ')}</dd>
            </div>
          ) : null}
          {p.collectorObserved > 0 ? <div><dt>Collector-observed work</dt><dd>{p.collectorObserved} artifact(s)</dd></div> : null}
          {p.toolsUsed.length ? <div><dt>Tools</dt><dd>{p.toolsUsed.join(' · ')}</dd></div> : null}
          <div><dt>Experience</dt><dd>{p.activeDays} active days · {p.activeDaysLast30} in last 30</dd></div>
          {p.compensation ? <div><dt>Compensation</dt><dd>{p.compensation}</dd></div> : null}
          {p.workArrangement || p.timezone ? <div><dt>Availability</dt><dd>{[p.workArrangement, p.timezone].filter(Boolean).join(' · ')}</dd></div> : null}
          {(p.openTo.length || p.engagementTypes.length) ? <div><dt>Open to</dt><dd>{(p.openTo.length ? p.openTo : p.engagementTypes).join(' · ')}</dd></div> : null}
        </dl>

        <button className="candidate-toggle" type="button" onClick={onToggle} aria-expanded={expanded}>
          {expanded ? 'Hide activity details' : 'View activity details'}
        </button>
        {expanded ? (
          <p className="candidate-activity">
            AI activity volume: <strong>{p.totalTokens ? compactNumber(p.totalTokens) : '—'}</strong> tokens
            {p.cachedSharePct != null ? ` · ${p.cachedSharePct}% cache reuse` : ''}. Volume is one activity
            signal, not a skill or pay score.
          </p>
        ) : null}
      </div>

      <div className="candidate-foot">
        <SignatureBadge state={p.signature} reason={p.signatureReason ?? p.error} />
        <div className="candidate-actions">
          {(() => {
            // Member-controlled href: sanitize, or render the label as plain text.
            const safe = p.contact ? safeUrl(p.contact.href, { allowMailto: true }) : null;
            if (!p.contact) return null;
            return safe ? (
              <a className="cta cta-sm" href={safe.href} {...linkProps(safe)}>{p.contact.label}</a>
            ) : (
              <span className="cta cta-sm" aria-disabled="true">{p.contact.label}</span>
            );
          })()}
          <a className="candidate-view" href={href({ name: 'member', handle: m.handle })}>View profile →</a>
        </div>
      </div>
    </li>
  );
}
