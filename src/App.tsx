import { useEffect, useMemo, useState } from 'react';
import { compactNumber, currency, dateTime, fullNumber, percent } from './lib/format';
import { MEASUREMENT_LABEL, PublicUsageSnapshot, QiraProjectScan, sampleSnapshot } from './lib/usage';
import { ProfileView } from './views/ProfileView';
import { ActivityDisclaimer } from './views/ActivityDisclaimer';
import { Directory } from './views/Directory';
import { Join } from './views/Join';
import { Member } from './views/Member';
import { Verify } from './views/Verify';
import { Employer } from './views/Employer';
import { Compare } from './views/Compare';
import { Claims } from './views/Claims';
import { Privacy } from './views/Privacy';
import { Terms } from './views/Terms';
import { href, navigate, useRoute } from './lib/router';
import { safeUrl, linkProps } from './lib/safeUrl';
import { CAVEATS } from './lib/caveats';

const dataUrl = `${import.meta.env.BASE_URL}data/latest.json`;

type Tone = 'default' | 'dark' | 'quiet';

function MetricCard(props: { label: string; value: string; detail?: string; tone?: Tone; evidence?: string }) {
  return (
    <article className={`metric metric--${props.tone ?? 'default'}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      {props.detail ? <small>{props.detail}</small> : null}
      {props.evidence ? <em className="evidence-tag">{props.evidence}</em> : null}
    </article>
  );
}

function MethodologyPanel({ snapshot }: { snapshot: PublicUsageSnapshot }) {
  const classes = snapshot.measurement?.classes ?? {};
  const families: Array<[string, string]> = [
    ['inputTokens', 'Input tokens'],
    ['outputTokens', 'Output tokens'],
    ['cacheReadTokens', 'Cache-read tokens'],
    ['totalTokens', 'Total tokens'],
    ['estimatedCostUsd', 'Estimated cost'],
  ];
  const rows = families.filter(([key]) => classes[key]);
  return (
    <section className="panel wide-panel" id="methodology">
      <div className="section-kicker"><span /> MEASUREMENT &amp; METHODOLOGY</div>
      <h2>What each number is — and is not.</h2>
      <p className="panel-copy">
        {snapshot.measurement?.note ??
          'Token counts are provider-reported usage accounting or deterministic sums of them; cost is a price-table estimate, not an invoice. Activity volume is not a measure of skill, productivity, or employability.'}
      </p>
      {rows.length ? (
        <div className="methodology-grid">
          {rows.map(([key, label]) => {
            const provenance = classes[key];
            return (
              <div className="methodology-row" key={key}>
                <div className="methodology-head">
                  <strong>{label}</strong>
                  <span className={`evidence-chip evidence-${provenance.measurementClass}`}>
                    {MEASUREMENT_LABEL[provenance.measurementClass]}
                  </span>
                </div>
                <small>{provenance.method}</small>
              </div>
            );
          })}
        </div>
      ) : null}
      <ul className="methodology-not">
        <li>Not a claim that token volume equals intelligence or expertise.</li>
        <li>Not a universal AI score.</li>
        <li>Estimated cost is never added into token totals.</li>
      </ul>
    </section>
  );
}

/**
 * Brand mark: ledger rows resolving into a verification check.
 *
 * Inline rather than an <img> so it inherits crisp rendering at any size and
 * needs no extra request. Mirrors public/favicon.svg — keep the two in sync.
 * Plain filled polygons only (no strokes, no nested transforms) so every
 * rasteriser produces the same shape.
 */
function LedgerMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="15" fill="#0d1220" />
      <rect x="11" y="17" width="19" height="4.5" rx="2.25" fill="#8593ad" />
      <rect x="11" y="28" width="12" height="4.5" rx="2.25" fill="#66738d" />
      <rect x="11" y="39" width="16" height="4.5" rx="2.25" fill="#4d5a73" />
      <path d="M45.4,18.2 L54.6,25.8 L32.4,52.9 L18.8,39.2 L27.2,30.8 L31.6,35.1 Z" fill="#0d1220" />
      <path d="M47.3,19.8 L52.7,24.2 L32.3,49.2 L20.5,37.5 L25.5,32.5 L31.7,38.8 Z" fill="#22c55e" />
    </svg>
  );
}

function NetworkField() {
  return (
    <svg className="network-field" viewBox="0 0 1200 760" preserveAspectRatio="none" aria-hidden="true">
      <g opacity="0.42">
        <path d="M70 120 L180 190 L330 140 L470 210 L620 150 L760 230 L910 170 L1120 250" />
        <path d="M120 520 L260 430 L410 470 L560 380 L760 460 L910 360 L1110 420" />
        <path d="M250 80 L300 250 L210 410 L350 620" />
        <path d="M850 80 L820 240 L930 410 L880 650" />
        {[70,180,330,470,620,760,910,1120,120,260,410,560,1110,250,300,210,350,850,820,930,880].map((x, i) => (
          <circle key={`${x}-${i}`} cx={x} cy={[120,190,140,210,150,230,170,250,520,430,470,380,420,80,250,410,620,80,240,410,650][i]} r="3" />
        ))}
      </g>
    </svg>
  );
}

function CachePanel({ snapshot }: { snapshot: PublicUsageSnapshot }) {
  const cached = snapshot.totals.cachedTokens;
  const fresh = snapshot.totals.freshTokens;
  const total = snapshot.totals.totalTokens;
  const cachedWidth = total ? Math.max(0, Math.min(100, (cached / total) * 100)) : 0;

  return (
    <section className="panel wide-panel">
      <div className="section-kicker"><span /> CACHE RATIO</div>
      <h2>Separating reused context from fresh generation.</h2>
      <p className="panel-copy">Huge coding-agent totals are easy to misread. This view makes cache usage explicit so the dashboard reads as evidence, not hype.</p>
      <div className="ratio-track"><div style={{ width: `${cachedWidth}%` }} /></div>
      <div className="split-two">
        <div><span>Cached context</span><strong>{percent(cached, total)}</strong><small>{fullNumber(cached)} tokens</small></div>
        <div><span>Fresh input/output</span><strong>{percent(fresh, total)}</strong><small>{fullNumber(fresh)} tokens</small></div>
      </div>
    </section>
  );
}

function ProviderPanel({ snapshot }: { snapshot: PublicUsageSnapshot }) {
  const providers = useMemo(() => Object.values(snapshot.providers), [snapshot.providers]);
  return (
    <section className="panel">
      <div className="section-kicker"><span /> AGENT SOURCES</div>
      <h2>Claude Code / Codex.</h2>
      <div className="rows">
        {providers.length ? providers.map((provider) => (
          <div className="data-row" key={provider.provider}>
            <div><strong>{provider.displayName}</strong><small>{provider.models.length ? provider.models.join(' · ') : 'model unknown'}</small></div>
            <div><strong>{compactNumber(provider.totalTokens)}</strong><small>{currency(provider.estimatedCostUsd)}</small></div>
          </div>
        )) : <p className="panel-copy">Provider data appears after the collector parses local ccusage output.</p>}
      </div>
    </section>
  );
}

function DailyChart({ snapshot }: { snapshot: PublicUsageSnapshot }) {
  const days = snapshot.daily.slice(-28);
  const max = Math.max(...days.map((day) => day.totalTokens), 1);
  return (
    <section className="panel full-panel">
      <div className="section-kicker"><span /> DAILY LEDGER</div>
      <h2>Recent agent workload.</h2>
      {days.length ? (
        <div className="bars">
          {days.map((day) => (
            <div className="bar-wrap" key={`${day.date}-${day.provider}`} title={`${day.date}: ${fullNumber(day.totalTokens)} tokens`}>
              <div className="bar" style={{ height: `${Math.max(4, (day.totalTokens / max) * 100)}%` }}><span style={{ height: `${day.totalTokens ? (day.freshTokens / day.totalTokens) * 100 : 0}%` }} /></div>
              <small>{day.date.slice(5)}</small>
            </div>
          ))}
        </div>
      ) : <p className="panel-copy">No daily records yet. Run the collector on the local Mac.</p>}
    </section>
  );
}

function ProjectScanner({ projects }: { projects: QiraProjectScan[] }) {
  const found = projects.filter((project) => project.found).length;
  const changed = projects.reduce((sum, project) => sum + (project.git?.changedFiles ?? 0), 0);
  const fileCount = projects.reduce((sum, project) => sum + Object.values(project.fileCounts ?? {}).reduce((a, b) => a + b, 0), 0);

  return (
    <section className="project-section" id="projects">
      <div className="tier-label"><span /> TIER 1 — ALLOWLISTED PROJECTS ONLY</div>
      <div className="section-title-row project-title-row">
        <div>
          <h2>Qira project matrix.</h2>
          <p>One clean grid for the allowlisted Qira repos. The scanner reports state, stack, scripts, file surface, and git signal without publishing local paths.</p>
        </div>
        <div className="scanner-summary" aria-label="Qira scanner summary">
          <div><strong>{found}/{projects.length}</strong><span>found</span></div>
          <div><strong>{changed}</strong><span>changed files</span></div>
          <div><strong>{fileCount}</strong><span>indexed files</span></div>
        </div>
      </div>
      <div className="project-matrix">
        {projects.map((project, index) => <ProjectCard key={project.name} project={project} index={index + 1} />)}
      </div>
    </section>
  );
}

function shortText(value: string | null | undefined, max = 22) {
  if (!value) return null;
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function totalFiles(project: QiraProjectScan) {
  return Object.values(project.fileCounts ?? {}).reduce((sum, count) => sum + count, 0);
}

function ProjectCard({ project, index }: { project: QiraProjectScan; index: number }) {
  const counts = Object.entries(project.fileCounts ?? {}).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const branch = shortText(project.git?.branch, 24);
  const commit = shortText(project.git?.commit, 12);
  const changed = typeof project.git?.changedFiles === 'number' ? project.git.changedFiles : null;
  const files = totalFiles(project);
  const modified = project.lastModified ? new Date(project.lastModified).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null;

  return (
    <article className={`project-card ${project.found ? 'is-found' : 'is-missing'}`}>
      <div className="project-index">{String(index).padStart(2, '0')}</div>
      <div className="project-head">
        <div>
          <strong>{project.name}</strong>
          <span>{project.category} · {project.status}</span>
        </div>
        <b>{project.found ? 'FOUND' : 'WAITING'}</b>
      </div>
      <p>{project.description}</p>
      <div className="project-diagnostics">
        {branch ? <div><span>branch</span><strong>{branch}</strong></div> : null}
        {commit ? <div><span>commit</span><strong>{commit}</strong></div> : null}
        {changed !== null ? <div><span>changes</span><strong>{changed}</strong></div> : null}
        {files ? <div><span>files</span><strong>{files}</strong></div> : null}
        {modified ? <div><span>modified</span><strong>{modified}</strong></div> : null}
      </div>
      <div className="project-links">
        {(() => {
          const safe = safeUrl(project.publicUrl);
          return safe ? <a href={safe.href} {...linkProps(safe)}>public surface</a> : null;
        })()}
        {!project.found ? <span>map local path</span> : null}
      </div>
      {project.stack.length ? <div className="tag-row">{project.stack.slice(0, 6).map((item) => <span key={item}>{item}</span>)}</div> : null}
      {counts.length ? <div className="count-row">{counts.map(([kind, count]) => <span key={kind}>{kind}: {count}</span>)}</div> : null}
      {project.scripts.length ? <small>scripts: {project.scripts.slice(0, 8).join(' · ')}</small> : <small>{project.found ? 'No package scripts detected.' : 'Waiting for local scanner mapping.'}</small>}
    </article>
  );
}

function VerificationPanel({ snapshot }: { snapshot: PublicUsageSnapshot }) {
  return (
    <section className="panel">
      <div className="section-kicker"><span /> PROOF LAYER</div>
      <h2>Sanitized snapshot.</h2>
      <dl className="proof-list">
        <div><dt>Generated</dt><dd>{dateTime(snapshot.generatedAt)}</dd></div>
        <div><dt>Source</dt><dd>{snapshot.source}</dd></div>
        <div><dt>Schema</dt><dd>{snapshot.verification.schemaVersion}</dd></div>
        <div><dt>Snapshot hash</dt><dd>{snapshot.verification.snapshotSha256 ?? 'pending local collector'}</dd></div>
        <div><dt>Raw logs</dt><dd>{snapshot.verification.rawLogsPublished ? 'published' : 'withheld'}</dd></div>
        <div><dt>Hash proves</dt><dd>{snapshot.verification.proves ?? 'The public snapshot is intact; it does not prove the private source logs were immutable.'}</dd></div>
      </dl>
    </section>
  );
}

function ScannerPanel({ snapshot }: { snapshot: PublicUsageSnapshot }) {
  return (
    <section className="panel">
      <div className="section-kicker"><span /> LOCAL SCANNER</div>
      <h2>More than token totals.</h2>
      <p className="panel-copy">The collector inspects an allowlist of Qira repositories for stack, scripts, git state, file counts, and modification signal while refusing to publish local paths.</p>
      <div className="split-two compact">
        <div><span>Roots checked</span><strong>{snapshot.scanner?.rootsChecked ?? 0}</strong></div>
        <div><span>Projects found</span><strong>{snapshot.scanner?.foundProjects ?? 0}</strong></div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="band how" id="how">
      <div className="band-head">
        <div className="section-kicker"><span /> HOW IT WORKS</div>
        <h2>Three steps. Nothing leaves your machine you didn&apos;t choose.</h2>
      </div>
      <ol className="how-steps">
        <li>
          <span className="how-num">1</span>
          <h3>Measure locally</h3>
          <p>You install a small open-source program — the <strong>collector</strong> — which reads the usage logs Claude Code and Codex already write on your machine and counts tokens into a private local ledger. Prompts, code, and file paths are never read.</p>
        </li>
        <li>
          <span className="how-num">2</span>
          <h3>Sign on your device</h3>
          <p>The collector writes your totals to a single file — your <strong>snapshot</strong> — and signs it with a key generated on your own machine and kept in your keychain. The private key never leaves the device, and the signature is what makes the numbers tamper-evident.</p>
        </li>
        <li>
          <span className="how-num">3</span>
          <h3>Publish &amp; be verified</h3>
          <p>You host the signed summary yourself. Anyone who opens your profile re-checks the signature in their own browser — they don&apos;t have to trust you, this site, or us.</p>
        </li>
      </ol>
      <div className="band-cta">
        <a className="cta" href={href({ name: 'join' })}>Add your profile →</a>
        <a className="ghost" href={href({ name: 'verify' })}>How verification works</a>
      </div>
    </section>
  );
}

function WhyDifferent() {
  const points = [
    { t: 'Measured, not self-reported', d: 'Token counts come from the providers’ own usage accounting in your local logs — not a number you type in.' },
    { t: 'Private by construction', d: 'Extraction is an allowlist: only a handful of named fields are ever read. Identifiers are kept as keyed hashes. Nothing is uploaded to us.' },
    { t: 'Cryptographically verifiable', d: 'Every profile is signed on-device and re-verified in the visitor’s browser. Tampering breaks the signature.' },
    { t: 'You own your data', d: 'You host your own snapshot. Remove it and you’re gone — there is no account and nothing of yours for us to keep.' },
  ];
  return (
    <section className="band why" id="why">
      <div className="band-head">
        <div className="section-kicker"><span /> WHY IT&apos;S DIFFERENT</div>
        <h2>A record built to survive scrutiny.</h2>
      </div>
      <div className="why-grid">
        {points.map((p) => (
          <div key={p.t} className="why-card">
            <h3>{p.t}</h3>
            <p>{p.d}</p>
          </div>
        ))}
      </div>
      <p className="why-honest">
        What a signature does <strong>not</strong> prove: who you are, or that your provider logs were genuine.
        Identity verification isn&apos;t built yet, and every profile says so. We&apos;d rather state that plainly than imply a check we don&apos;t run.
      </p>
    </section>
  );
}

function ValueForBoth() {
  return (
    <section className="value-both" id="value">
      <div className="section-kicker"><span /> WHAT EACH SIDE GETS</div>
      <div className="value-grid">
        <div className="value-col">
          <h3>If you do AI-assisted work</h3>
          <ul>
            <li><strong>Free to use.</strong> Run the collector, publish a profile, keep hosting your own data.</li>
            <li><strong>Portable evidence</strong> of what you built and how you work — not just claims on a résumé.</li>
            <li><strong>You control everything:</strong> what's read, what's published per field, and one command to export or delete.</li>
            <li><strong>Opportunities come to you</strong> — evaluations, research, beta programs, contract work — via your contact action.</li>
            <li><strong>You are never paid by token volume.</strong> That would reward waste. Efficiency and outcomes are what matter.</li>
          </ul>
          <a className="cta cta-sm" href={href({ name: 'join' })}>Add your profile →</a>
        </div>
        <div className="value-col">
          <h3>If you hire or recruit</h3>
          <ul>
            <li><strong>See evidence, not adjectives:</strong> tools and models used, duration and consistency, connected repos and deployments.</li>
            <li><strong>Signed and browser-verifiable</strong> — you don't have to trust us or the candidate.</li>
            <li><strong>An explicit evidence ladder</strong> tells you exactly how strong each claim is.</li>
            <li><strong>Availability and terms up front:</strong> engagement type, compensation, work arrangement, time zone.</li>
            <li><strong>Activity volume is behind a click,</strong> so a big number is never mistaken for capability.</li>
          </ul>
          <a className="cta cta-sm" href={href({ name: 'employer' })}>Find people →</a>
        </div>
      </div>
    </section>
  );
}

/**
 * Compact preview of the operator's real, signed profile.
 *
 * The full ProfileView used to render inline here — 2,277px of it, on a page
 * already 9,700px long. The point of this section is "this is real, not a
 * mockup", which a summary card makes just as well while sending people to the
 * actual verifiable profile.
 */
function ExampleProfileCard({ snapshot }: { snapshot: PublicUsageSnapshot }) {
  const profile = snapshot.profile!;
  const a = profile.activity;
  const stats: Array<[string, string]> = [
    ['Active AI-work days', String(a.activeDays)],
    ['Tools', a.toolsUsed.join(' · ') || '—'],
    ['Projects observed', String(a.projectsActive)],
    ['Work artifacts', String(profile.work.totalArtifacts)],
  ];
  return (
    <section className="example-card">
      <div className="example-card-head">
        <span className="member-avatar" aria-hidden="true">
          {profile.identity.displayName.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')}
        </span>
        <div>
          <strong>{profile.identity.displayName}</strong>
          <span>{profile.identity.headline}</span>
        </div>
        <span className="sig sig-valid"><span aria-hidden="true" className="sig-dot" />Signature verified</span>
      </div>
      <dl className="example-card-stats">
        {stats.map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
        ))}
      </dl>
      <div className="example-card-actions">
        <a className="cta cta-sm" href={href({ name: 'member', handle: 'bryan' })}>Open the full profile →</a>
        <a href="./data/latest.json" target="_blank" rel="noopener noreferrer">Read the raw snapshot</a>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <div className="brand"><LedgerMark /> <span>LEDGER</span></div>
          <p>A local-first evidence layer for AI-assisted work. Measured on your machine, signed on your device, verified in your browser.</p>
        </div>
        <nav className="footer-cols" aria-label="Footer">
          <div>
            <h3>Product</h3>
            <a href={href({ name: 'directory' })}>People</a>
            <a href={href({ name: 'join' })}>Add your profile</a>
            <a href={href({ name: 'verify' })}>Verification</a>
          </div>
          <div>
            <h3>Open source</h3>
            <a href="https://github.com/TheArtOfSound/TOKENS" target="_blank" rel="noopener noreferrer">Repository</a>
            <a href="https://github.com/TheArtOfSound/TOKENS/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">MIT License</a>
            <a href="./data/latest.json" target="_blank" rel="noopener noreferrer">Inspect a snapshot</a>
          </div>
          <div>
            <h3>Trust</h3>
            <a href={href({ name: 'claims' })}>What evidence proves</a>
            <a href={href({ name: 'privacy' })}>Privacy</a>
            <a href={href({ name: 'terms' })}>Terms</a>
            <a href="https://github.com/TheArtOfSound/TOKENS/blob/main/SECURITY.md" target="_blank" rel="noopener noreferrer">Security policy</a>
          </div>
          <div>
            <h3>Qira</h3>
            <a href="https://imagineqira.com" target="_blank" rel="noopener noreferrer">imagineqira.com</a>
          </div>
        </nav>
      </div>
      <div className="footer-legal">
        <span>© {new Date().getFullYear()} Qira LLC</span>
        <span>No analytics. No accounts. No data collected from visitors.</span>
        <span>{CAVEATS.volume}</span>
      </div>
    </footer>
  );
}

export default function App() {
  const route = useRoute();
  // Grey page + white cards is the job-site convention; set once at the root.
  useEffect(() => { document.body.classList.add('jobsite'); }, []);
  const [snapshot, setSnapshot] = useState<PublicUsageSnapshot>(sampleSnapshot);
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'fallback'>('loading');

  useEffect(() => {
    let cancelled = false;
    fetch(dataUrl, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load ${dataUrl}`);
        return res.json() as Promise<PublicUsageSnapshot>;
      })
      .then((data) => {
        if (!cancelled) {
          setSnapshot(data);
          setLoadState('loaded');
        }
      })
      .catch(() => { if (!cancelled) setLoadState('fallback'); });
    return () => { cancelled = true; };
  }, []);

  const largestDay = snapshot.daily.reduce((max, day) => (day.totalTokens > max.totalTokens ? day : max), snapshot.daily[0]);
  const qiraProjects = snapshot.qiraProjects ?? sampleSnapshot.qiraProjects ?? [];

  return (
    <>
      {/* Lets keyboard users bypass the nav; the first thing Tab reaches. */}
      <a className="skip-link" href="#top">Skip to main content</a>
      <NetworkField />
      <header className="topbar">
        <a className="brand" href={href({ name: 'home' })}><LedgerMark /> <span>LEDGER</span></a>
        {/* Job sites put search in the header. Submitting jumps to the people
            directory with the query applied. */}
        <form
          className="topsearch"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            const q = new FormData(event.currentTarget).get('q');
            const query = typeof q === 'string' && q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
            navigate(`${href({ name: 'directory' })}${query}`);
          }}
        >
          <span className="topsearch-icon" aria-hidden="true">⌕</span>
          <label className="visually-hidden" htmlFor="global-search">Search people by name, skill, or tool</label>
          <input id="global-search" name="q" type="search" placeholder="Search people, skills, or tools" />
        </form>
        <nav>
          <a href={href({ name: 'directory' })} aria-current={route.name === 'directory' ? 'page' : undefined}>People</a>
          <a href={href({ name: 'employer' })} aria-current={route.name === 'employer' ? 'page' : undefined}>For employers</a>
          <a href={href({ name: 'verify' })} aria-current={route.name === 'verify' ? 'page' : undefined}>Verification</a>
          <a href={href({ name: 'claims' })} aria-current={route.name === 'claims' ? 'page' : undefined}>Evidence</a>
          <a href={href({ name: 'compare' })} aria-current={route.name === 'compare' ? 'page' : undefined}>Compare</a>
          <a className="nav-button" href={href({ name: 'join' })}>Add your profile</a>
        </nav>
      </header>

      <main>
      {route.name === 'directory' && <Directory />}
      {route.name === 'employer' && <Employer />}
      {route.name === 'compare' && <Compare />}
      {route.name === 'claims' && <Claims />}
      {route.name === 'privacy' && <Privacy />}
      {route.name === 'terms' && <Terms />}
      {route.name === 'join' && <Join />}
      {route.name === 'verify' && <Verify />}
      {route.name === 'member' && <Member handle={route.handle} />}

      {route.name === 'home' && (
        <>
        <section className="hero" id="top">
          <div className="hero-pill"><span /> Local-first evidence layer for AI-assisted work</div>
          <h1>Evidence of how you work with AI — not a token leaderboard.</h1>
          <p>Ledger turns the AI work you already do into a portable professional record: what you built, the tools and models you use, how efficiently you work, and which parts are independently trustworthy. It runs on your machine — no account, and your prompts, code, and file paths never leave your computer.</p>
          <div className="hero-actions"><a className="cta" href={href({ name: 'join' })}>Add your profile →</a><a href={href({ name: 'directory' })}>Browse people</a></div>
          <ul className="hero-facts"><li>Work &amp; outcomes first</li><li>Signed on your device</li><li>Verified in your browser</li><li>You host your own data</li></ul>
          {snapshot.isSampleData || loadState !== 'loaded' ? <div className="notice">Sample mode is active. Run <code>npm run collect</code> locally to publish the real scanner snapshot.</div> : null}
        </section>

        <HowItWorks />
        <WhyDifferent />
        <ValueForBoth />

        <section className="example-intro" id="example">
          <div className="section-kicker"><span /> A LIVE, SIGNED PROFILE</div>
          <h2>See it working — on real, measured data.</h2>
          <p>This is the operator&apos;s own profile, generated by the collector and signed on-device. It isn&apos;t a mockup. Open <a href={href({ name: 'member', handle: 'bryan' })}>the verifiable version</a> to watch your browser re-check the signature, or <a href="./data/latest.json" target="_blank" rel="noopener noreferrer">read the raw snapshot</a>.</p>
        </section>

        {snapshot.profile ? <ExampleProfileCard snapshot={snapshot} /> : null}

        {/*
          These are the operator's own dashboards. They're real and worth keeping
          — methodology especially — but ~4,700px of one person's telemetry does
          not belong on the default path of a marketing page. Collapsed by
          default, one click for anyone who wants the depth.
        */}
        <details className="home-deep" id="scanner">
          <summary>
            <span>Explore the underlying data</span>
            <small>Methodology, cache ratio, provider split, daily ledger, verification, and the local project scan</small>
          </summary>
          <div className="panel-grid">
            <CachePanel snapshot={snapshot} />
            <ProviderPanel snapshot={snapshot} />
            <ScannerPanel snapshot={snapshot} />
            <MethodologyPanel snapshot={snapshot} />
            <VerificationPanel snapshot={snapshot} />
            <DailyChart snapshot={snapshot} />
          </div>
        </details>

        {/* Raw activity totals come LAST and are explicitly not a score. */}
        <section className="activity-details" id="activity-details">
          <div className="section-kicker"><span /> ACTIVITY &amp; RESOURCE USAGE</div>
          <h2>Activity details</h2>
          <ActivityDisclaimer />
          <div className="metrics-grid">
            <MetricCard label="AI activity volume" value={compactNumber(snapshot.totals.totalTokens)} detail={`${fullNumber(snapshot.totals.totalTokens)} tokens`} tone="dark" evidence="derived" />
            <MetricCard label="Cached context" value={compactNumber(snapshot.totals.cachedTokens)} detail={`${percent(snapshot.totals.cachedTokens, snapshot.totals.totalTokens)} — efficiency signal`} evidence="provider-reported" />
            <MetricCard label="Fresh tokens" value={compactNumber(snapshot.totals.freshTokens)} detail="input + output" evidence="provider-reported" />
            <MetricCard label="Estimated cost" value={currency(snapshot.totals.estimatedCostUsd)} detail="ccusage estimate" evidence="estimated" />
            <MetricCard label="Busiest day" value={largestDay ? compactNumber(largestDay.totalTokens) : '—'} detail={largestDay?.date ?? 'pending'} evidence="derived" />
            <MetricCard label="Qira projects" value={String(qiraProjects.length)} detail="allowlisted only" tone="quiet" evidence="metadata" />
          </div>
        </section>
  
        {/* The operator's local project scan: also real, also 2,300px. Same treatment. */}
        <details className="home-deep">
          <summary>
            <span>Projects observed on the operator's machine</span>
            <small>What the collector saw locally — stack, git state, and file counts per allowlisted project</small>
          </summary>
          <ProjectScanner projects={qiraProjects} />
        </details>
  
        {snapshot.warnings.length ? <section className="panel warnings"><div className="section-kicker"><span /> SAFE WARNINGS</div><ul>{snapshot.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></section> : null}
        </>
      )}
      </main>
      <SiteFooter />
    </>
  );
}
