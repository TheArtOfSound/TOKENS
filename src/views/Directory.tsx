/**
 * People directory — a job-site search results page.
 *
 * Layout follows the pattern people already know from LinkedIn/Indeed: a sticky
 * filter rail on the left, result rows on the right, each row leading with
 * identity and the strongest evidence.
 *
 * What does NOT change from the original: results are never ranked by token
 * volume, every figure comes from that member's own signed snapshot verified in
 * the visitor's browser, and each row states how strong its evidence actually is.
 */

import { useEffect, useMemo, useState } from 'react';
import { useMemberProfiles, type MemberProfile } from '../lib/members';
import { compactNumber } from '../lib/format';
import { href } from '../lib/router';
import { SignatureBadge } from './SignatureBadge';
import { ActivityDisclaimer } from './ActivityDisclaimer';
import { ErrorBoundary } from './ErrorBoundary';
import { EvidenceNote } from './EvidenceNote';

export { SignatureBadge };

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || 'Q';
}

export function Directory() {
  const { profiles, loading, error } = useMemberProfiles();
  // The header search sends ?q= here.
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get('q') ?? '');
  const [openToOnly, setOpenToOnly] = useState(false);
  const [tool, setTool] = useState('');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    const onPop = () => setQuery(new URLSearchParams(window.location.search).get('q') ?? '');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const tools = useMemo(() => {
    const set = new Set<string>();
    profiles.forEach((p) => p.toolsUsed.forEach((t) => set.add(t)));
    return [...set].sort();
  }, [profiles]);

  const filtersActive = Boolean(query || tool || verifiedOnly || openToOnly);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return profiles.filter((p) => {
      if (!p.member) return false;
      if (tool && !p.toolsUsed.includes(tool)) return false;
      if (verifiedOnly && p.signature !== 'valid') return false;
      if (openToOnly && p.openTo.length === 0 && p.engagementTypes.length === 0) return false;
      if (!q) return true;
      return [
        p.member.displayName,
        p.member.headline,
        p.member.location ?? '',
        ...p.workCategories,
        ...p.toolsUsed,
        ...p.identityProofs.map((x) => x.handle),
      ].join(' ').toLowerCase().includes(q);
    });
  }, [profiles, query, tool, openToOnly, verifiedOnly]);

  if (error) {
    return (
      <div className="jcard jcard-pad">
        <h2>People</h2>
        <p className="muted">The member directory could not be loaded ({error}).</p>
      </div>
    );
  }

  return (
    <section className="directory-page" id="people">
      <header className="jpage-head">
        <h1>People measuring their AI work</h1>
        <p className="jresult-count">
          {loading ? 'Loading profiles…' : (
            <>
              {results.length} {results.length === 1 ? 'profile' : 'profiles'}
              {query ? <> for “{query}”</> : null} · never ranked by token volume
            </>
          )}
        </p>
      </header>

      <div className="jsearch">
        {/* Filter rail — collapsible on small screens so results lead. */}
        <aside className={`jfilters ${filtersOpen ? 'is-open' : ''}`}>
          <button
            type="button"
            className="jfilters-toggle"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((o) => !o)}
          >
            <span>Filters{filtersActive ? ' · on' : ''}</span>
            <span aria-hidden="true">{filtersOpen ? '▴' : '▾'}</span>
          </button>
          <div className="jcard jcard-pad jfilters-body">
            <h2 className="jfilters-title">Refine</h2>
            <div className="fgroup">
              <label className="visually-hidden" htmlFor="dir-q">Search people</label>
              <input
                id="dir-q"
                className="jfilters-search"
                type="search"
                placeholder="Name, skill, tool…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="fgroup">
              <label htmlFor="dir-tool">Tool</label>
              <select id="dir-tool" value={tool} onChange={(e) => setTool(e.target.value)}>
                <option value="">Any tool</option>
                {tools.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="fgroup">
              <h2>Evidence</h2>
              <label><input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} /> Signature verified</label>
              <label><input type="checkbox" checked={openToOnly} onChange={(e) => setOpenToOnly(e.target.checked)} /> Open to opportunities</label>
            </div>
            {filtersActive ? (
              <div className="fgroup">
                <button type="button" className="btn btn-ghost" style={{ height: 34 }} onClick={() => { setQuery(''); setTool(''); setVerifiedOnly(false); setOpenToOnly(false); }}>
                  Clear all
                </button>
              </div>
            ) : null}
          </div>
        </aside>

        {/* Results */}
        <div>
          <div className="jresult-head">
            <a className="btn btn-primary" href={href({ name: 'join' })}>Add your profile</a>
          </div>

          <div className="jcard">
            {loading ? (
              <div className="jcard-pad list-loading" aria-busy="true" aria-label="Loading people">
                <div className="skeleton sk-row" style={{ width: '55%', height: 18 }} />
                <div className="skeleton sk-row" style={{ width: '80%', height: 14 }} />
                <div className="skeleton sk-row" style={{ width: '40%', height: 14 }} />
                <div className="skeleton" style={{ height: 72, borderRadius: 12, marginTop: 12 }} />
              </div>
            ) : results.length === 0 ? (
              <div className="jcard-pad empty-state">
                <p className="empty-title">No profiles match these filters</p>
                <p className="muted" style={{ margin: '0 0 14px' }}>
                  Try clearing filters, or be the first to publish a signed profile.
                </p>
                <div className="empty-actions">
                  {filtersActive ? (
                    <button type="button" className="btn btn-ghost" onClick={() => { setQuery(''); setTool(''); setVerifiedOnly(false); setOpenToOnly(false); }}>
                      Clear filters
                    </button>
                  ) : null}
                  <a className="btn btn-primary" href={href({ name: 'join' })}>Add your profile</a>
                </div>
              </div>
            ) : (
              results.map((p) => (
                <ErrorBoundary key={p.member.handle} label={`the profile for @${p.member.handle}`}>
                  <ResultRow p={p} />
                </ErrorBoundary>
              ))
            )}
          </div>

          {profiles.length > 0 && profiles.length < 5 ? (
            <div className="jcard jcard-pad" style={{ marginTop: 12 }}>
              <h2 style={{ margin: '0 0 6px' }}>This directory is just getting started.</h2>
              <p className="muted" style={{ margin: '0 0 14px' }}>
                Every profile here is a signed, browser-verifiable record of real AI work — not a self-written
                résumé. Be one of the first; it takes about ten minutes.
              </p>
              <a className="btn btn-primary" href={href({ name: 'join' })}>Add your profile →</a>
            </div>
          ) : null}

          <div className="jcard jcard-pad" style={{ marginTop: 12 }}>
            <ActivityDisclaimer compact />
            <EvidenceNote />
          </div>
        </div>
      </div>
    </section>
  );
}

function ResultRow({ p }: { p: MemberProfile }) {
  const m = p.member;
  const openTo = p.openTo.length ? p.openTo : p.engagementTypes;
  const profileHref = href({ name: 'member', handle: m.handle });
  return (
    <article className="jresult">
      <a className="jresult-hit" href={profileHref} aria-label={`View ${m.displayName}'s profile`}>
        <span className="jresult-avatar" aria-hidden="true">{initials(m.displayName)}</span>
        <div className="jresult-body">
          <span className="jresult-name">{m.displayName}</span>
          <p className="jresult-headline">{m.headline}</p>
          {m.location ? <p className="jresult-loc">{m.location}</p> : null}

          <div className="jresult-facts">
            {p.activeDays ? <span><b>{p.activeDays}</b> active AI-work days</span> : null}
            {p.collectorObserved ? <span><b>{p.collectorObserved}</b> collector-observed {p.collectorObserved === 1 ? 'artifact' : 'artifacts'}</span> : null}
            {p.identityProofs.length ? <span>Linked: <b>{p.identityProofs.map((x) => `${x.type}/${x.handle}`).join(', ')}</b></span> : null}
            {p.totalTokens ? <span>{compactNumber(p.totalTokens)} tokens measured</span> : null}
          </div>

          {(p.toolsUsed.length || openTo.length) ? (
            <div className="jchips">
              {p.toolsUsed.map((t) => <span className="jchip" key={t}>{t}</span>)}
              {openTo.slice(0, 3).map((o) => <span className="jchip jchip-open" key={o}>{o}</span>)}
            </div>
          ) : null}
        </div>
      </a>

      <div className="jresult-side">
        <SignatureBadge state={p.signature} reason={p.signatureReason ?? p.error} />
        <a className="btn btn-secondary" href={profileHref}>View profile</a>
      </div>
    </article>
  );
}
