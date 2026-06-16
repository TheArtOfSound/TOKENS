import { useEffect, useMemo, useState } from 'react';
import { compactNumber, currency, dateTime, fullNumber, percent } from './lib/format';
import { PublicUsageSnapshot, QiraProjectScan, sampleSnapshot } from './lib/usage';

const dataUrl = `${import.meta.env.BASE_URL}data/latest.json`;

type Tone = 'default' | 'dark' | 'quiet';

function MetricCard(props: { label: string; value: string; detail?: string; tone?: Tone }) {
  return (
    <article className={`metric metric--${props.tone ?? 'default'}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      {props.detail ? <small>{props.detail}</small> : null}
    </article>
  );
}

function QiraLogo() {
  return <div className="brand-mark" aria-hidden="true"><span /></div>;
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
  const categories = [...new Set(projects.map((project) => project.category))];

  return (
    <section className="project-section" id="projects">
      <div className="tier-label"><span /> TIER 1 — QIRA SYSTEMS ONLY</div>
      <div className="section-title-row">
        <h2>Scanned Qira project surface.</h2>
        <p>{found} of {projects.length} allowlisted Qira projects found locally. No AutoHustle, no unrelated products, no raw paths.</p>
      </div>
      <div className="project-groups">
        {categories.map((category) => (
          <div className="project-group" key={category}>
            <h3>{category}</h3>
            <div className="project-cards">
              {projects.filter((project) => project.category === category).map((project) => <ProjectCard key={project.name} project={project} />)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProjectCard({ project }: { project: QiraProjectScan }) {
  const counts = Object.entries(project.fileCounts ?? {}).filter(([, count]) => count > 0).slice(0, 4);
  return (
    <article className={`project-card ${project.found ? 'is-found' : 'is-missing'}`}>
      <div className="project-head">
        <div><strong>{project.name}</strong><span>{project.status}</span></div>
        <b>{project.found ? 'FOUND' : 'WAITING'}</b>
      </div>
      <p>{project.description}</p>
      <div className="project-meta">
        {project.publicUrl ? <a href={project.publicUrl} target="_blank" rel="noreferrer">public surface</a> : null}
        {project.git?.branch ? <span>{project.git.branch}</span> : null}
        {project.git?.commit ? <span>{project.git.commit}</span> : null}
        {typeof project.git?.changedFiles === 'number' ? <span>{project.git.changedFiles} changed</span> : null}
      </div>
      {project.stack.length ? <div className="tag-row">{project.stack.slice(0, 6).map((item) => <span key={item}>{item}</span>)}</div> : null}
      {counts.length ? <div className="count-row">{counts.map(([kind, count]) => <span key={kind}>{kind}: {count}</span>)}</div> : null}
      {project.scripts.length ? <small>scripts: {project.scripts.slice(0, 8).join(' · ')}</small> : <small>scanner has not found local build scripts yet</small>}
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
      </dl>
    </section>
  );
}

function ScannerPanel({ snapshot }: { snapshot: PublicUsageSnapshot }) {
  return (
    <section className="panel">
      <div className="section-kicker"><span /> LOCAL SCANNER</div>
      <h2>More than token totals.</h2>
      <p className="panel-copy">The collector now inspects an allowlist of Qira repositories for stack, scripts, git state, file counts, and modification signal while refusing to publish local paths.</p>
      <div className="split-two compact">
        <div><span>Roots checked</span><strong>{snapshot.scanner?.rootsChecked ?? 0}</strong></div>
        <div><span>Projects found</span><strong>{snapshot.scanner?.foundProjects ?? 0}</strong></div>
      </div>
    </section>
  );
}

export default function App() {
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
    <main>
      <NetworkField />
      <header className="topbar">
        <a className="brand" href="#top"><QiraLogo /> <span>QIRA</span></a>
        <nav><a href="#projects">Research</a><a href="#projects">Products</a><a href="#scanner">Approach</a><a href="https://github.com/TheArtOfSound/TOKENS" target="_blank" rel="noreferrer">Repository</a><a className="nav-button" href="./data/latest.json" target="_blank" rel="noreferrer">Inspect JSON</a></nav>
      </header>

      <section className="hero" id="top">
        <div className="hero-pill"><span /> Qira LLC · local AI-agent work ledger</div>
        <h1>Instrumented systems for Qira research.</h1>
        <p>A public, sanitized telemetry surface for Claude Code and Codex usage across Qira-only work: cached context, fresh output, model/provider split, local repo health, and snapshot verification.</p>
        <div className="hero-actions"><a href="#projects">Explore Qira projects →</a><a href="https://imagineqira.com" target="_blank" rel="noreferrer">Imagine Qira</a></div>
        <ul className="hero-facts"><li>Raw prompts withheld</li><li>Local paths withheld</li><li>Qira-only allowlist</li><li>Updated from Bryan's Mac</li></ul>
        {snapshot.isSampleData || loadState !== 'loaded' ? <div className="notice">Sample mode is active. Run <code>npm run collect</code> locally to publish the real scanner snapshot.</div> : null}
      </section>

      <section className="metrics-grid">
        <MetricCard label="All-time tokens" value={compactNumber(snapshot.totals.totalTokens)} detail={fullNumber(snapshot.totals.totalTokens)} tone="dark" />
        <MetricCard label="Cached context" value={compactNumber(snapshot.totals.cachedTokens)} detail={percent(snapshot.totals.cachedTokens, snapshot.totals.totalTokens)} />
        <MetricCard label="Fresh tokens" value={compactNumber(snapshot.totals.freshTokens)} detail="input + output" />
        <MetricCard label="Estimated cost" value={currency(snapshot.totals.estimatedCostUsd)} detail="ccusage estimate" />
        <MetricCard label="Largest day" value={largestDay ? compactNumber(largestDay.totalTokens) : '—'} detail={largestDay?.date ?? 'pending'} />
        <MetricCard label="Qira projects" value={String(qiraProjects.length)} detail="allowlisted only" tone="quiet" />
      </section>

      <div className="panel-grid" id="scanner">
        <CachePanel snapshot={snapshot} />
        <ProviderPanel snapshot={snapshot} />
        <ScannerPanel snapshot={snapshot} />
        <VerificationPanel snapshot={snapshot} />
        <DailyChart snapshot={snapshot} />
      </div>

      <ProjectScanner projects={qiraProjects} />

      {snapshot.warnings.length ? <section className="panel warnings"><div className="section-kicker"><span /> SAFE WARNINGS</div><ul>{snapshot.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></section> : null}
    </main>
  );
}
