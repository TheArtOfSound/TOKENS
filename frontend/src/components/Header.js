import React, { useEffect, useState } from "react";
import { ago } from "../lib/format";

function useUtcClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now.toISOString().slice(11, 19) + " UTC";
}

export default function Header({ snapshot, live, loading }) {
  const clock = useUtcClock();
  const updated = snapshot ? ago(snapshot.generatedAt) : "—";

  return (
    <header className="sticky top-0 z-50 border-b border-hair bg-black/60 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-5 py-4 sm:px-8">
        <a href="#top" className="flex items-center gap-3" data-testid="brand-logo">
          <span className="block h-7 w-7 border border-white/70 bg-gradient-to-br from-white/90 via-faint to-black" />
          <span className="font-head text-xl font-black tracking-[0.22em] text-white">
            QIRA
          </span>
          <span className="hidden font-mono text-[10px] tracking-[0.2em] text-faint sm:inline">
            / OBSERVATORY
          </span>
        </a>

        <div className="flex items-center gap-5">
          <div
            className="flex items-center gap-2 font-mono text-[11px] tracking-[0.2em]"
            data-testid="live-status-indicator"
          >
            <span
              className={`block h-[7px] w-[7px] rounded-full ${
                live ? "bg-live animate-pulse2" : "bg-faint"
              }`}
            />
            <span className="text-white">{live ? "LIVE" : loading ? "SYNC" : "IDLE"}</span>
            <span className="hidden text-faint sm:inline">· {updated}</span>
          </div>
          <span className="hidden font-mono text-[11px] tracking-[0.2em] text-sub md:inline">
            {clock}
          </span>
        </div>
      </div>
    </header>
  );
}
