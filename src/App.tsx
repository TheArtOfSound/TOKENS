import { useEffect, useMemo, useState } from 'react';
import { compactNumber, currency, dateTime, fullNumber, percent } from './lib/format';
import { PublicUsageSnapshot, sampleSnapshot } from './lib/usage';

const dataUrl = `${import.meta.env.BASE_URL}data/latest.json`;

function MetricCard(props: {
  label: string;
  value: string;
  detail?: string;
  tone?: 'default' | 'hot' | 'safe';
}) {
  return (
    <article className={`metric metric--${props.tone ?? 'default'}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      {props.detail ? <small>{props.detail}</small> : null}
    </article>
  );
}

function CacheRatio({ snapshot }: { snapshot: PublicUsageSnapshot }) {
  const cached = snapshot.totals.cachedTokens;
  const fresh = snapshot.totals.freshTokens;
  const total = snapshot.totals.totalTokens;
  const cachedWidth = total ? Math.max(0, Math.min(100, (cached / total) * 100)) : 0;
  const freshWidth = total ? Math.max(0, Math.min(100, (fresh / total) * 100)) : 0;

  return (
    <section className="panel cache-panel">
      <div className="section-heading">
        <p>Cache signal</p>
        <h2>Accounting total is not the same as fresh generated text.</h2>
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
      <p className="muted">
        Coding-agent sessions repeatedly work with large context. This dashboard separates cached tokens so the public number is harder to misread.
      </p>
    </section>
  );
}

function DailyChart({ snapshot }: { snapshot: PublicUsageSnapshot }) {
  const days = snapshot.daily.slice(-21);
  const max = Math.max(...days.map((day) => day.totalTokens), 1);

  if (!days.length) {
    return (
      <section className="panel">
        <div className="section-heading">
          <p>Daily history</p>
          <h2>No daily records yet.</h2>
        </div>
        <p className="muted">Run the collector on the local Mac to replace sample data with a real history.</p>
      </section>
    );
  }

  return (
    <section className="panel chart-panel">
      <div className="section-heading">
        <p>Daily history</p>
        <h2>Recent token workload</h2>
      </div>
      <div className="bars">
        {days.map((day) => {
          const cachedHeight = Math.max(2, (day.cachedTokens / max) * 100);
          const freshHeight = Math.max(2, (day.freshTokens / max) * 100);
          return (
            <div className="bar-wrap" key={`${day.date}-${day.provider}`} title={`${day.date}: ${fullNumber(day.totalTokens)} tokens`}>
              <div className="bar" style={{ height: `${Math.max(5, (day.totalTokens / max) * 100)}%` }}>
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
    <section className="panel">
      <div className="section-heading">
        <p>Provider split</p>
        <h2>Claude Code and Codex usage</h2>
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

function VerificationPanel({ snapshot }: { snapshot: PublicUsageSnapshot }) {
  return (
    <section className="panel verification">
      <div className="section-heading">
        <p>Verification</p>
        <h2>Sanitized public snapshot</h2>
      </div>
      <dl>
        <div>
          <dt>Generated</dt>
          <dd>{dateTime(snapshot.generatedAt)}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{snapshot.source}</dd>
        </div>
        <div>
          <dt>Schema</dt>
          <dd>{snapshot.verification.schemaVersion}</dd>
        </div>
        <div>
          <dt>Snapshot hash</dt>
          <dd>{snapshot.verification.snapshotSha256 ?? 'pending local collector'}</dd>
        </div>
        <div>
          <dt>Raw logs published</dt>
          <dd>{String(snapshot.verification.rawLogsPublished)}</dd>
        </div>
      </dl>
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
    return () => {
      cancelled = true;
    };
  }, []);

  const largestDay = snapshot.daily.reduce((max, day) => (day.totalTokens > max.totalTokens ? day : max), snapshot.daily[0]);

  return (
    <main>
      <section className="hero">
        <div className="eyebrow">Qira · Agent Usage Observatory</div>
        <h1>A live public ledger of AI coding-agent workload.</h1>
        <p>
          Sanitized local telemetry for Claude Code and Codex: total tokens, cached context, fresh input/output, estimated cost, daily history, and proof metadata.
        </p>
        <div className="hero-actions">
          <a href="https://github.com/TheArtOfSound/TOKENS" target="_blank" rel="noreferrer">View repo</a>
          <a href="./data/latest.json" target="_blank" rel="noreferrer">Inspect JSON</a>
        </div>
        {snapshot.isSampleData || loadState !== 'loaded' ? (
          <div className="notice">
            Sample mode is active. Run <code>npm run collect</code> on the local Mac to publish the real sanitized snapshot.
          </div>
        ) : null}
      </section>

      <section className="metrics-grid">
        <MetricCard label="All-time tokens" value={compactNumber(snapshot.totals.totalTokens)} detail={fullNumber(snapshot.totals.totalTokens)} tone="hot" />
        <MetricCard label="Cached tokens" value={compactNumber(snapshot.totals.cachedTokens)} detail={percent(snapshot.totals.cachedTokens, snapshot.totals.totalTokens)} />
        <MetricCard label="Fresh tokens" value={compactNumber(snapshot.totals.freshTokens)} detail="input + output, excluding cache" />
        <MetricCard label="Estimated cost" value={currency(snapshot.totals.estimatedCostUsd)} detail="ccusage estimate" />
        <MetricCard label="Largest day" value={largestDay ? compactNumber(largestDay.totalTokens) : '—'} detail={largestDay?.date ?? 'pending'} />
        <MetricCard label="Last updated" value={dateTime(snapshot.generatedAt)} detail={snapshot.timezone} tone="safe" />
      </section>

      <div className="content-grid">
        <CacheRatio snapshot={snapshot} />
        <ProviderPanel snapshot={snapshot} />
        <DailyChart snapshot={snapshot} />
        <VerificationPanel snapshot={snapshot} />
      </div>

      {snapshot.warnings.length ? (
        <section className="panel warnings">
          <div className="section-heading">
            <p>Collector warnings</p>
            <h2>Safe public warnings</h2>
          </div>
          <ul>
            {snapshot.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
