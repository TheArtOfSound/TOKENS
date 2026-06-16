import { useEffect, useMemo, useState } from 'react';
import { compactNumber, currency, dateTime, fullNumber, percent } from './lib/format';
import { PublicUsageSnapshot, sampleSnapshot } from './lib/usage';

const dataUrl = `${import.meta.env.BASE_URL}data/latest.json`;

type Tone = 'default' | 'hot' | 'safe' | 'warn';
type Project = {
  name: string;
  category: 'Research Engines' | 'Public Products' | 'Growth Systems' | 'Proof Infrastructure';
  status: 'active' | 'shipping' | 'research' | 'instrumented';
  description: string;
  signal: string;
};

const projects: Project[] = [
  { name: 'Codey', category: 'Public Products', status: 'shipping', description: 'Multi-agent builder and product workspace under the Qira umbrella.', signal: 'product completion / auth / live UX' },
  { name: 'LOLM', category: 'Research Engines', status: 'research', description: 'Latent Order Language Model work: uncertainty, regimes, and nontrivial model behavior.', signal: 'model architecture / validation' },
  { name: 'NFET / QEV', category: 'Research Engines', status: 'research', description: 'Encryption, emergence, verification, and proof-layer experiments.', signal: 'math / proof / secure vaults' },
  { name: 'My Digital', category: 'Public Products', status: 'shipping', description: 'QEV-backed digital-goods marketplace and creator trust layer.', signal: 'payments / licensing / unlocks' },
  { name: 'WeSearch', category: 'Growth Systems', status: 'active', description: 'News aggregation, distribution, bots, and public web traffic systems.', signal: 'traffic / crawl / distribution' },
  { name: 'AutoHustle', category: 'Growth Systems', status: 'active', description: 'Automation products, Solana tools, lead systems, and monetized bots.', signal: 'automation / revenue experiments' },
  { name: 'TOKENS', category: 'Proof Infrastructure', status: 'instrumented', description: 'This public observatory: AI-agent workload, cache ratio, cost, and update history.', signal: 'public telemetry / snapshot hash' },
  { name: 'Qira Sites', category: 'Proof Infrastructure', status: 'active', description: 'The portfolio surface for Qira research, products, trust docs, and demos.', signal: 'brand / deploy / verification' },
];

function MetricCard(props: { label: string; value: string; detail?: string; tone?: Tone }) {
  return (
    <article className={`metric metric--${props.tone ?? 'default'}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      {props.detail ? <small>{props.detail}</small> : null}
    </article>
  );
}

function StatusPill({ children, tone = 'default' }: { children: string; tone?: Tone }) {
  return <span className={`pill pill--${tone}`}>{children}</span>;
}

function CacheRatio({ snapshot }: { snapshot: PublicUsageSnapshot }) {
  const cached = snapshot.totals.cachedTokens;
  const fresh = snapshot.totals.freshTokens;
  const total = snapshot.totals.totalTokens;
  const cachedWidth = total ? Math.max(0, Math.min(100, (cached / total) * 100)) : 0;
  const freshWidth = total ? Math.max(0, Math.min(100, (fresh / total) * 100)) : 0;

  return (
    <section className="panel cache-panel span-7">
      <div className="section-heading split-heading">
        <div>
          <p>Cache physics</p>
          <h2>Massive token totals, separated from fresh generation.</h2>
        </div>
        <StatusPill tone="hot">cache visible</StatusPill>
      </div>
      <div className="ratio-rail" aria-label="Cached and fresh token ratio">
        <div className="ratio-cache" style={{ width: `${cachedWidth}%` }} />
        <div className="ratio-fresh" style={{ width: `${freshWidth}%` }} />
      </div>
      <div className="ratio-grid">
        <div>
          <span>Cached context</span>
          <strong>{percent(cached, total)}</strong>
          <small>{fullNumber(cached)} tokens</small>
        </div>
        <div>
          <span>Fresh input/output</span>
          <strong>{percent(fresh, total)}</strong>
          <small>{fullNumber(fresh)} tokens</small>
        </div>
      </div>
      <p className="muted">The point is not a fake flex number. The useful signal is how much sustained coding-agent work is happening, how cache-heavy it is, and how much context is being carried through long repo sessions.</p>
    </section>
  );
}

function DailyChart({ snapshot }: { snapshot: PublicUsageSnapshot }) {
  const days = snapshot.daily.slice(-24);
  const max = Math.max(...days.map((day) => day.totalTokens), 1);

  if (!days.length) {
    return (
      <section className="panel chart-panel span-12">
        <div className="section-heading">
          <p>Daily trace</p>
          <h2>No daily records yet.</h2>
        </div>
        <p className="muted">Run the collector on the local Mac to replace sample data with real usage history.</p>
      </section>
    );
  }

  return (
    <section className="panel chart-panel span-12">
      <div className="section-heading split-heading">
        <div>
          <p>Daily trace</p>
          <h2>Recent workload by day</h2>
        </div>
        <div className="legend"><span /> cached <b /> fresh</div>
      </div>
      <div className="bars">
        {days.map((day) => {
          const totalHeight = Math.max(5, (day.totalTokens / max) * 100);
          const cachedHeight = Math.max(2, (day.cachedTokens / day.totalTokens) * 100);
          const freshHeight = Math.max(2, (day.freshTokens / day.totalTokens) * 100);
          return (
            <div className="bar-wrap" key={`${day.date}-${day.provider}`} title={`${day.date}: ${fullNumber(day.totalTokens)} tokens`}>
              <div className="bar" style={{ height: `${totalHeight}%` }}>
                <span className="bar-cache" style={{ height: `${cachedHeight}%` }} />
                <span className="bar-fresh" style={{ height: `${freshHeight}%` }} />
              </div>
              <small>{day.date.slice(5)}</small>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ProviderPanel({ snapshot }: { snapshot: PublicUsageSnapshot }) {
  const providers = useMemo(() => Object.values(snapshot.providers), [snapshot.providers]);

  return (
    <section className="panel span-5">
      <div className="section-heading">
        <p>Agent engines</p>
        <h2>Provider split</h2>
      </div>
      {providers.length ? (
        <div className="provider-list">
          {providers.map((provider) => (
            <div className="provider-row" key={provider.provider}>
              <div>
                <strong>{provider.displayName}</strong>
                <small>{provider.models.length ? provider.models.join(' · ') : 'model names unavailable'}</small>
              </div>
              <div>
                <strong>{compactNumber(provider.totalTokens)}</strong>
                <small>{currency(provider.estimatedCostUsd)}</small>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">Provider data will appear after the collector parses the local ccusage output.</p>
      )}
    </section>
  );
}

function ProjectAtlas() {
  const categories = [...new Set(projects.map((project) => project.category))];
  return (
    <section className="panel project-panel span-12">
      <div className="section-heading split-heading">
        <div>
          <p>Portfolio map</p>
          <h2>Projects behind the agent workload</h2>
        </div>
        <StatusPill tone="warn">paths withheld</StatusPill>
      </div>
      <p className="muted project-note">This is public project categorization, not raw per-folder telemetry. Private repo paths and session text stay off the site. Per-project token attribution can be added later through an explicit safe allowlist.</p>
      <div className="project-groups">
        {categories.map((category) => (
          <div className="project-group" key={category}>
            <h3>{category}</h3>
            <div className="project-cards">
              {projects.filter((project) => project.category === category).map((project) => (
                <article className="project-card" key={project.name}>
                  <div className="project-card-top">
                    <strong>{project.name}</strong>
                    <span>{project.status}</span>
                  </div>
                  <p>{project.description}</p>
                  <small>{project.signal}</small>
                </article>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function VerificationPanel({ snapshot }: { snapshot: PublicUsageSnapshot }) {
  return (
    <section className="panel verification span-6">
      <div className="section-heading">
        <p>Proof layer</p>
        <h2>Sanitized snapshot</h2>
      </div>
      <dl>
        <div><dt>Generated</dt><dd>{dateTime(snapshot.generatedAt)}</dd></div>
        <div><dt>Source</dt><dd>{snapshot.source}</dd></div>
        <div><dt>Schema</dt><dd>{snapshot.verification.schemaVersion}</dd></div>
        <div><dt>Snapshot hash</dt><dd>{snapshot.verification.snapshotSha256 ?? 'pending local collector'}</dd></div>
        <div><dt>Raw logs published</dt><dd>{String(snapshot.verification.rawLogsPublished)}</dd></div>
      </dl>
    </section>
  );
}

function WorkStack() {
  const steps = ['local Mac logs', 'ccusage JSON', 'sanitizer', 'public snapshot', 'GitHub Pages'];
  return (
    <section className="panel stack-panel span-6">
      <div className="section-heading">
        <p>Pipeline</p>
        <h2>Local telemetry, public proof</h2>
      </div>
      <div className="stack-steps">
        {steps.map((step, index) => <div key={step}><span>{String(index + 1).padStart(2, '0')}</span><strong>{step}</strong></div>)}
      </div>
      <p className="muted">The public site never reaches into the machine. The Mac publishes sanitized JSON snapshots forward.</p>
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
      .catch(() => {
        if (!cancelled) setLoadState('fallback');
      });
    return () => { cancelled = true; };
  }, []);

  const largestDay = snapshot.daily.reduce((max, day) => (day.totalTokens > max.totalTokens ? day : max), snapshot.daily[0]);
  const activeProviders = Object.keys(snapshot.providers).length || 2;

  return (
    <main>
      <section className="hero hero-grid">
        <div className="hero-copy">
          <div className="eyebrow">Qira work ledger · local agent telemetry</div>
          <h1>Proof of work for an AI-native builder.</h1>
          <p>Not a generic usage chart. This is a public command surface for Bryan's Claude Code and Codex workload: token mass, cache physics, cost pressure, update cadence, and the projects those sessions are pushing forward.</p>
          <div className="hero-actions">
            <a href="https://github.com/TheArtOfSound/TOKENS" target="_blank" rel="noreferrer">View repo</a>
            <a href="./data/latest.json" target="_blank" rel="noreferrer">Inspect JSON</a>
          </div>
          {snapshot.isSampleData || loadState !== 'loaded' ? <div className="notice">Sample mode is active. Run <code>npm run collect</code> on the local Mac to publish the real sanitized snapshot.</div> : null}
        </div>
        <aside className="terminal-card">
          <div className="terminal-top"><span /> <span /> <span /></div>
          <code>$ ccusage claude daily --json</code>
          <code>$ ccusage codex daily --json</code>
          <code>$ sanitize --no-prompts --no-paths</code>
          <div className="terminal-number">{compactNumber(snapshot.totals.totalTokens)}</div>
          <small>total public token accounting</small>
        </aside>
      </section>

      <section className="metrics-grid">
        <MetricCard label="All-time tokens" value={compactNumber(snapshot.totals.totalTokens)} detail={fullNumber(snapshot.totals.totalTokens)} tone="hot" />
        <MetricCard label="Cached tokens" value={compactNumber(snapshot.totals.cachedTokens)} detail={percent(snapshot.totals.cachedTokens, snapshot.totals.totalTokens)} />
        <MetricCard label="Fresh tokens" value={compactNumber(snapshot.totals.freshTokens)} detail="input + output, excluding cache" />
        <MetricCard label="Estimated cost" value={currency(snapshot.totals.estimatedCostUsd)} detail="ccusage estimate" />
        <MetricCard label="Largest day" value={largestDay ? compactNumber(largestDay.totalTokens) : '—'} detail={largestDay?.date ?? 'pending'} />
        <MetricCard label="Active surfaces" value={String(projects.length)} detail={`${activeProviders} agent providers`} tone="safe" />
      </section>

      <section className="dashboard-grid">
        <CacheRatio snapshot={snapshot} />
        <ProviderPanel snapshot={snapshot} />
        <ProjectAtlas />
        <DailyChart snapshot={snapshot} />
        <WorkStack />
        <VerificationPanel snapshot={snapshot} />
      </section>

      {snapshot.warnings.length ? (
        <section className="panel warnings">
          <div className="section-heading"><p>Collector warnings</p><h2>Safe public warnings</h2></div>
          <ul>{snapshot.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </section>
      ) : null}
    </main>
  );
}
