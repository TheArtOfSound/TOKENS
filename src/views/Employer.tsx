/**
 * Employer surface.
 *
 * Same job-site layout as the people directory (sticky filter rail + result
 * rows) so the two read as one product rather than two eras of the design.
 *
 * The buyer-specific difference: this view answers "what am I actually getting?"
 * before any token number — relevant work, evidence strength, availability, and
 * terms. Raw activity volume stays behind a disclosure so a recruiter never
 * mistakes a big number for capability or a pay grade.
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
  const [verifiedOnly, setVerifiedOnly] = useState(false);
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
        if (verifiedOnly && p.signature !== 'valid') return false;
        if (openToOnly && p.openTo.length === 0 && p.engagementTypes.length === 0) return false;
        return true;
      }),
    [profiles, tool, category, minDays, openToOnly, verifiedOnly],
  );

  if (error) {
    return (
      <div className="jcard jcard-pad">
        <h2>Find people</h2>
        <p className="muted">The directory could not be loaded ({error}).</p>
      </div>
    );
  }

  const filtersActive = Boolean(tool || category || minDays || openToOnly || verifiedOnly);

  return (
    <section className="employer-page" id="employer">
      <header className="jpage-head">
        <h1>Find people by evidence, not by résumé</h1>
        <p className="jresult-count">
          {results.length} {results.length === 1 ? 'candidate' : 'candidates'} · every figure read from their
          own signed snapshot and verified in your browser
        </p>
      </header>

      <div className="jsearch">
        <aside className="jfilters">
          <div className="jcard jcard-pad">
            <h2 className="jfilters-title">Refine candidates</h2>
            <div className="fgroup">
              <label htmlFor="emp-tool">Tool</label>
              <select id="emp-tool" value={tool} onChange={(e) => setTool(e.target.value)}>
                <option value="">Any tool</option>
                {TOOLS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="fgroup">
              <label htmlFor="emp-cat">Work category</label>
              <select id="emp-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Any category</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="fgroup">
              <label htmlFor="emp-days">Minimum experience</label>
              <select id="emp-days" value={minDays} onChange={(e) => setMinDays(Number(e.target.value))}>
                {[0, 10, 30, 60, 90].map((d) => (
                  <option key={d} value={d}>{d === 0 ? 'Any' : `${d}+ active days`}</option>
                ))}
              </select>
            </div>
            <div className="fgroup">
              <h2>Evidence</h2>
              <label><input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} /> Signature verified</label>
              <label><input type="checkbox" checked={openToOnly} onChange={(e) => setOpenToOnly(e.target.checked)} /> Open to opportunities</label>
            </div>
            {filtersActive ? (
              <div className="fgroup">
                <button
                  className="btn btn-ghost"
                  style={{ height: 34 }}
                  onClick={() => { setTool(''); setCategory(''); setMinDays(0); setOpenToOnly(false); setVerifiedOnly(false); }}
                >
                  Clear all
                </button>
              </div>
            ) : null}
          </div>
        </aside>

        <div>
          <div className="jcard">
            {results.length === 0 ? (
              <div className="jcard-pad">
                <p className="muted" style={{ margin: 0 }}>No candidates match these filters yet.</p>
              </div>
            ) : (
              results.map((p) => (
                <ErrorBoundary key={p.member.handle} label={`the profile for @${p.member.handle}`}>
                  <Candidate
                    p={p}
                    expanded={!!expanded[p.member.handle]}
                    onToggle={() => setExpanded((prev) => ({ ...prev, [p.member.handle]: !prev[p.member.handle] }))}
                  />
                </ErrorBoundary>
              ))
            )}
          </div>

          {profiles.length > 0 && profiles.length < 5 ? (
            <div className="jcard jcard-pad" style={{ marginTop: 12 }}>
              <h2 style={{ margin: '0 0 6px' }}>This talent pool is new.</h2>
              <p className="muted" style={{ margin: '0 0 14px' }}>
                {profiles.length === 1 ? 'There is' : 'There are'} {profiles.length} verified{' '}
                {profiles.length === 1 ? 'profile' : 'profiles'} so far. Everyone here is backed by a signed,
                browser-verifiable record rather than a self-written résumé — and the pool grows as people publish.
              </p>
              <a className="btn btn-primary" href={href({ name: 'join' })}>Invite someone to add theirs →</a>
            </div>
          ) : null}

          <div className="jcard jcard-pad" style={{ marginTop: 12 }}>
            <p className="muted" style={{ margin: 0, fontSize: '.88rem', lineHeight: 1.6 }}>
              A verified signature proves a snapshot is authentic and unaltered. A linked account proves the
              member controls that account — <strong>not</strong> their legal identity. Provider-attested usage
              and third-party-confirmed outcomes are separate, stronger tiers, shown per profile.{' '}
              <a href={href({ name: 'claims' })}>What each signal can and cannot establish →</a>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Candidate({ p, expanded, onToggle }: { p: MemberProfile; expanded: boolean; onToggle: () => void }) {
  const m = p.member;
  const openTo = p.openTo.length ? p.openTo : p.engagementTypes;
  const contact = p.contact ? safeUrl(p.contact.href, { allowMailto: true }) : null;

  return (
    <article className="jresult">
      <a href={href({ name: 'member', handle: m.handle })} aria-hidden="true" tabIndex={-1}>
        <span className="jresult-avatar">{initials(m.displayName)}</span>
      </a>

      <div className="jresult-body">
        <a className="jresult-name" href={href({ name: 'member', handle: m.handle })}>{m.displayName}</a>
        <p className="jresult-headline">{m.headline}</p>
        {m.location ? <p className="jresult-loc">{m.location}</p> : null}

        {/* Evidence and terms lead — never the token count. */}
        <dl className="candidate-facts">
          {p.identityProofs.length ? (
            <div><dt>Linked accounts</dt><dd>{p.identityProofs.map((x) => `${x.type}/${x.handle}`).join(' · ')}</dd></div>
          ) : null}
          {p.collectorObserved > 0 ? (
            <div><dt>Collector-observed work</dt><dd>{p.collectorObserved} artifact{p.collectorObserved === 1 ? '' : 's'}</dd></div>
          ) : null}
          {p.toolsUsed.length ? <div><dt>Tools</dt><dd>{p.toolsUsed.join(' · ')}</dd></div> : null}
          <div><dt>Experience</dt><dd>{p.activeDays} active days · {p.activeDaysLast30} in last 30</dd></div>
          {p.compensation ? <div><dt>Compensation</dt><dd>{p.compensation}</dd></div> : null}
          {p.workArrangement || p.timezone ? (
            <div><dt>Availability</dt><dd>{[p.workArrangement, p.timezone].filter(Boolean).join(' · ')}</dd></div>
          ) : null}
        </dl>

        {openTo.length ? (
          <div className="jchips">
            {openTo.slice(0, 4).map((o) => <span className="jchip jchip-open" key={o}>{o}</span>)}
          </div>
        ) : null}

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

      <div className="jresult-side">
        <SignatureBadge state={p.signature} reason={p.signatureReason ?? p.error} />
        {contact && p.contact ? (
          <a className="btn btn-primary" href={contact.href} {...linkProps(contact)}>{p.contact.label}</a>
        ) : null}
        <a className="btn btn-secondary" href={href({ name: 'member', handle: m.handle })}>View profile</a>
      </div>
    </article>
  );
}
