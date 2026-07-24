import React, { useCallback, useEffect, useRef, useState } from "react";
import Background from "./components/Background";
import Header from "./components/Header";
import {
  HeroMetric,
  CacheRatio,
  ProviderSplit,
  MiniMetric,
} from "./components/Panels";
import DailyChart from "./components/DailyChart";
import Verification from "./components/Verification";
import ProjectMatrix from "./components/ProjectMatrix";
import { compact, usd } from "./lib/format";
import { dayMonth } from "./lib/datetime";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const POLL_MS = 2000;

export default function App() {
  const [snapshot, setSnapshot] = useState(null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState(false);
  const timer = useRef(null);

  const fetchLatest = useCallback(async () => {
    try {
      const res = await fetch(`${API}/usage/latest`, { cache: "no-store" });
      if (!res.ok) throw new Error("bad status");
      const data = await res.json();
      setSnapshot(data);
      setLive(true);
      setError(false);
    } catch (e) {
      setLive(false);
      setError(true);
    }
  }, []);

  useEffect(() => {
    fetchLatest();
    timer.current = setInterval(fetchLatest, POLL_MS);
    return () => clearInterval(timer.current);
  }, [fetchLatest]);

  if (!snapshot) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-base">
        <Background />
        <div className="flex items-center gap-3 font-mono text-xs tracking-widest-2 text-sub">
          <span className="block h-[7px] w-[7px] animate-pulse2 rounded-full bg-live" />
          {error ? "RECONNECTING TO OBSERVATORY…" : "INITIALIZING OBSERVATORY…"}
        </div>
      </div>
    );
  }

  const t = snapshot.totals || {};
  const daily = snapshot.dailyAgg || [];
  const largest = daily.reduce(
    (m, d) => (d.totalTokens > (m?.totalTokens || 0) ? d : m),
    daily[0]
  );

  return (
    <div id="top" className="relative min-h-screen bg-base">
      <Background />
      <Header snapshot={snapshot} live={live} loading={!snapshot} />

      <main className="mx-auto max-w-[1400px] px-5 pb-24 sm:px-8">
        {/* Hero copy */}
        <section className="py-14 lg:py-20">
          <div className="inline-flex items-center gap-2 border border-hair px-4 py-2 font-mono text-[11px] tracking-widest-2 text-sub">
            <span className="block h-[6px] w-[6px] animate-pulse2 rounded-full bg-live" />
            QIRA LLC · LOCAL AI-AGENT WORK LEDGER
          </div>
          <h1 className="mt-7 max-w-4xl font-head text-4xl font-black uppercase leading-[0.95] tracking-tight text-white sm:text-6xl lg:text-7xl">
            Live instrumented telemetry for Qira research.
          </h1>
          <p className="mt-6 max-w-2xl font-body text-base leading-relaxed text-sub sm:text-lg">
            A continuously updating, sanitized surface for Claude Code and Codex usage:
            cached context, fresh output, provider split, repo health and snapshot
            verification. Raw prompts and local paths are never published.
          </p>
        </section>

        {/* Bento grid */}
        <div className="grid grid-cols-1 gap-[1px] bg-hair md:grid-cols-3 lg:grid-cols-4">
          <HeroMetric snapshot={snapshot} />
          <CacheRatio snapshot={snapshot} i={1} />
          <ProviderSplit snapshot={snapshot} i={2} />
          <MiniMetric
            label="Estimated spend"
            value={usd(t.estimatedCostUsd)}
            detail="CCUSAGE ESTIMATE"
            i={3}
            testid="metric-spend"
          />
          <MiniMetric
            label="Largest day"
            value={largest ? compact(largest.totalTokens) : "—"}
            detail={largest ? dayMonth(largest.date).toUpperCase() : "PENDING"}
            i={4}
            testid="metric-largest-day"
          />
          <DailyChart data={daily} i={5} />
          <Verification snapshot={snapshot} i={6} />
        </div>

        {/* Project matrix */}
        <div className="mt-[1px] bg-hair pt-[1px]">
          <ProjectMatrix
            projects={snapshot.qiraProjects}
            scanner={snapshot.scanner}
            i={7}
          />
        </div>

        <footer className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-hair pt-8 font-mono text-[11px] tracking-widest-2 text-faint">
          <span>QIRA OBSERVATORY · SCHEMA {snapshot.verification?.schemaVersion}</span>
          <span>RAW LOGS WITHHELD · QIRA-ONLY ALLOWLIST · POLLING {POLL_MS / 1000}s</span>
        </footer>
      </main>
    </div>
  );
}
