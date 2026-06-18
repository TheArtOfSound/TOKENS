import React from "react";
import { motion } from "framer-motion";
import AnimatedNumber from "./AnimatedNumber";
import { compact, full, pct, usd } from "../lib/format";

const reveal = (i) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] },
});

export function Cell({ children, className = "", i = 0, ...rest }) {
  return (
    <motion.div
      {...reveal(i)}
      className={`relative bg-surface transition-colors duration-200 ${className}`}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

function Overline({ children }) {
  return (
    <div className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-widest-2 text-sub">
      <span className="block h-[6px] w-[6px] bg-white/60" />
      {children}
    </div>
  );
}

export function HeroMetric({ snapshot }) {
  const t = snapshot.totals || {};
  const session = snapshot.live?.sessionTokens || 0;
  return (
    <Cell
      i={0}
      className="col-span-1 flex flex-col justify-between p-8 md:col-span-3 md:row-span-2 lg:col-span-2 lg:p-10"
    >
      <div className="flex items-start justify-between">
        <Overline>Total tokens processed</Overline>
        <span className="font-mono text-[10px] tracking-widest-2 text-faint">ALL-TIME · CLAUDE + CODEX</span>
      </div>

      <div className="mt-10">
        <h1 className="whitespace-nowrap font-mono text-[2rem] font-black leading-none tracking-tighter text-white sm:text-5xl lg:text-[3.7rem] xl:text-[4.4rem]">
          <AnimatedNumber value={t.totalTokens} format={full} testid="hero-token-counter" />
        </h1>
        <div className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-2 font-mono text-xs tracking-wide text-sub">
          <span>
            <span className="text-faint">FRESH</span>{" "}
            <span className="text-white"><AnimatedNumber value={t.freshTokens} format={compact} /></span>
          </span>
          <span>
            <span className="text-faint">CACHED</span>{" "}
            <span className="text-white"><AnimatedNumber value={t.cachedTokens} format={compact} /></span>
          </span>
          <span>
            <span className="text-faint">EST. SPEND</span>{" "}
            <span className="text-white"><AnimatedNumber value={t.estimatedCostUsd} format={usd} /></span>
          </span>
        </div>
      </div>

      <div className="mt-10 flex items-center gap-3 border-t border-hair pt-5">
        <span className="block h-[7px] w-[7px] animate-pulse2 rounded-full bg-live" />
        <span className="font-mono text-[11px] tracking-widest-2 text-live">+{full(session)}</span>
        <span className="font-mono text-[11px] tracking-widest-2 text-faint">
          TOKENS SINCE SNAPSHOT · {pct(t.cachedTokens, t.totalTokens)} CACHED
        </span>
      </div>
    </Cell>
  );
}

export function CacheRatio({ snapshot, i }) {
  const t = snapshot.totals || {};
  const total = t.totalTokens || 1;
  const cachedW = Math.max(0, Math.min(100, (t.cachedTokens / total) * 100));
  return (
    <Cell i={i} className="p-8" data-testid="cache-ratio-panel">
      <Overline>Cache ratio</Overline>
      <p className="mt-4 font-body text-sm leading-relaxed text-sub">
        Reused context vs fresh generation. Evidence, not hype.
      </p>
      <div className="mt-6 h-3 w-full overflow-hidden bg-elevated">
        <motion.div
          className="h-full bg-white"
          initial={{ width: 0 }}
          animate={{ width: `${cachedW}%` }}
          transition={{ duration: 1, ease: "easeOut" }}
        />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-4 font-mono">
        <div>
          <div className="text-[10px] tracking-widest-2 text-faint">CACHED</div>
          <div className="mt-1 text-2xl font-bold tracking-tight text-white">
            {pct(t.cachedTokens, total)}
          </div>
        </div>
        <div>
          <div className="text-[10px] tracking-widest-2 text-faint">FRESH</div>
          <div className="mt-1 text-2xl font-bold tracking-tight text-sub">
            {pct(t.freshTokens, total)}
          </div>
        </div>
      </div>
    </Cell>
  );
}

export function ProviderSplit({ snapshot, i }) {
  const providers = Object.values(snapshot.providers || {});
  const max = Math.max(...providers.map((p) => p.totalTokens || 0), 1);
  return (
    <Cell i={i} className="p-8" data-testid="provider-split-chart">
      <Overline>Agent sources</Overline>
      <div className="mt-6 space-y-5">
        {providers.length ? (
          providers.map((p, idx) => (
            <div key={p.provider}>
              <div className="flex items-baseline justify-between font-mono">
                <span className="text-sm font-bold text-white">{p.displayName}</span>
                <span className="text-xs text-sub">{compact(p.totalTokens)}</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden bg-elevated">
                <motion.div
                  className="h-full"
                  style={{ background: idx === 0 ? "#FFFFFF" : "#555555" }}
                  initial={{ width: 0 }}
                  animate={{ width: `${((p.totalTokens || 0) / max) * 100}%` }}
                  transition={{ duration: 1, ease: "easeOut" }}
                />
              </div>
            </div>
          ))
        ) : (
          <p className="font-body text-sm text-sub">No provider data yet.</p>
        )}
      </div>
    </Cell>
  );
}

export function MiniMetric({ label, value, detail, i, testid }) {
  return (
    <Cell i={i} className="flex flex-col justify-between p-8" data-testid={testid}>
      <Overline>{label}</Overline>
      <div className="mt-8">
        <div className="font-mono text-3xl font-bold tracking-tight text-white">{value}</div>
        {detail ? (
          <div className="mt-2 font-mono text-[11px] tracking-widest-2 text-faint">{detail}</div>
        ) : null}
      </div>
    </Cell>
  );
}
