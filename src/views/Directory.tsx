/**
 * Member directory — the "people" surface.
 *
 * Every figure shown here is read from that member's own signed snapshot and
 * verified in the visitor's browser. Nothing is self-reported except the
 * identity fields, which are labeled as such. There is no ranking by token
 * volume: the dossier is explicit that raw volume must never be presented as
 * skill, and a leaderboard would do exactly that.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  loadRegistry,
  type MemberSummary,
  type Registry,
  type RegistryMember,
  type SignatureState,
} from '../lib/registry';
import { verifySnapshotInBrowser } from '../lib/verify';
import { compactNumber } from '../lib/format';
import { href } from '../lib/router';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function SignatureBadge({ state, reason }: { state: SignatureState; reason?: string }) {
  const label: Record<SignatureState, string> = {
    checking: 'Verifying…',
    valid: 'Signature verified',
    invalid: 'Signature failed',
    unsigned: 'Unsigned',
    unreachable: 'Unreachable',
  };
  return (
    <span className={`sig sig-${state}`} title={reason ?? label[state]}>
      <span aria-hidden="true" className="sig-dot" />
      {label[state]}
    </span>
  );
}

async function summarize(member: RegistryMember): Promise<MemberSummary> {
  const base: MemberSummary = {
    member,
    activeDays: 0,
    totalTokens: 0,
    toolsUsed: [],
    lastActiveDate: null,
    currentStreakDays: 0,
    projectsActive: 0,
    collectorObserved: 0,
    signatureState: 'checking',
  };
  try {
    const url = member.snapshotUrl.startsWith('/')
      ? `${import.meta.env.BASE_URL.replace(/\/$/, '')}${member.snapshotUrl}`
      : member.snapshotUrl;
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) {
      return { ...base, signatureState: 'unreachable', error: `HTTP ${response.status}` };
    }
    const snapshot = (await response.json()) as Record<string, unknown>;
    const outcome = await verifySnapshotInBrowser(snapshot);
    const profile = snapshot.profile as
      | { activity?: Record<string, unknown>; work?: Record<string, unknown> }
      | undefined;
    const activity = profile?.activity ?? {};
    const totals = (snapshot.totals ?? {}) as Record<string, unknown>;

    return {
      ...base,
      activeDays: Number(activity.activeDays) || 0,
      totalTokens: Number(totals.totalTokens) || 0,
      toolsUsed: Array.isArray(activity.toolsUsed) ? (activity.toolsUsed as string[]) : [],
      lastActiveDate: (activity.lastActiveDate as string) ?? null,
      currentStreakDays: Number(activity.currentStreakDays) || 0,
      projectsActive: Number(activity.projectsActive) || 0,
      collectorObserved: Number((profile?.work as Record<string, unknown>)?.collectorObserved) || 0,
      signatureState: outcome.state,
      signatureReason: outcome.reason,
      generatedAt: (snapshot.generatedAt as string) ?? undefined,
    };
  } catch (error) {
    return { ...base, signatureState: 'unreachable', error: error instanceof Error ? error.message : 'fetch failed' };
  }
}

export function Directory() {
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [summaries, setSummaries] = useState<MemberSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [openToOnly, setOpenToOnly] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    loadRegistry(controller.signal)
      .then((reg) => {
        setRegistry(reg);
        setSummaries(reg.members.map((member) => ({ ...({} as MemberSummary), member, signatureState: 'checking' as const })));
        // Verify every member independently and in parallel.
        reg.members.forEach((member, index) => {
          summarize(member).then((summary) =>
            setSummaries((prev) => {
              const next = [...prev];
              next[index] = summary;
              return next;
            }),
          );
        });
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(String(e));
      });
    return () => controller.abort();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return summaries.filter((s) => {
      if (!s.member) return false;
      if (openToOnly && !s.member.availability) return false;
      if (!q) return true;
      const haystack = [
        s.member.displayName,
        s.member.headline,
        s.member.location ?? '',
        ...(s.member.workCategories ?? []),
        ...(s.toolsUsed ?? []),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [summaries, query, openToOnly]);

  if (error) {
    return (
      <section className="panel wide-panel">
        <h2>People</h2>
        <p className="muted">The member directory could not be loaded ({error}).</p>
      </section>
    );
  }

  return (
    <section className="directory" id="people">
      <header className="directory-head">
        <div>
          <h2>People measuring their AI work</h2>
          <p className="muted">
            Every figure below comes from that person's own signed snapshot and is verified in your browser.
            Profiles are not ranked by token volume — volume is evidence of practice, not of skill.
          </p>
        </div>
        <a className="cta" href={href({ name: 'join' })}>
          Add your profile
        </a>
      </header>

      <div className="directory-controls">
        <label className="visually-hidden" htmlFor="people-search">
          Search people
        </label>
        <input
          id="people-search"
          type="search"
          placeholder="Search by name, headline, tool, or category…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <label className="toggle">
          <input type="checkbox" checked={openToOnly} onChange={(event) => setOpenToOnly(event.target.checked)} />
          Open to opportunities
        </label>
      </div>

      {registry && filtered.length === 0 && (
        <p className="muted">No members match that search.</p>
      )}

      <ul className="member-grid">
        {filtered.map((summary) => {
          const m = summary.member;
          return (
            <li key={m.handle} className="member-card">
              <a className="member-link" href={href({ name: 'member', handle: m.handle })}>
                <span className="member-avatar" aria-hidden="true">
                  {initials(m.displayName)}
                </span>
                <span className="member-identity">
                  <strong>{m.displayName}</strong>
                  <span className="member-headline">{m.headline}</span>
                  {m.location && <span className="member-location">{m.location}</span>}
                </span>
              </a>

              <dl className="member-stats">
                <div>
                  <dt>Active days</dt>
                  <dd>{summary.activeDays || '—'}</dd>
                </div>
                <div>
                  <dt>Measured tokens</dt>
                  <dd>{summary.totalTokens ? compactNumber(summary.totalTokens) : '—'}</dd>
                </div>
                <div>
                  <dt>Projects</dt>
                  <dd>{summary.projectsActive || '—'}</dd>
                </div>
              </dl>

              {summary.toolsUsed?.length > 0 && (
                <p className="member-tools">{summary.toolsUsed.join(' · ')}</p>
              )}

              {m.availability && <p className="member-availability">{m.availability}</p>}

              <SignatureBadge state={summary.signatureState} reason={summary.signatureReason ?? summary.error} />
            </li>
          );
        })}
      </ul>

      <p className="directory-footnote">
        A verified signature proves the snapshot was produced by that device key and has not been altered.
        It does <strong>not</strong> prove who the person is — identity verification is not built yet, and every
        profile says so.
      </p>
    </section>
  );
}
