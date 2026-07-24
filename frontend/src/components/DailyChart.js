import React from "react";
import {
  Bar,
  BarChart,
  Cell as RCell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import { Cell } from "./Panels";
import { full } from "../lib/format";

function CustomTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div className="border border-focus bg-black/90 px-3 py-2 font-mono text-[11px] backdrop-blur">
      <div className="tracking-widest-2 text-faint">{d.date}</div>
      <div className="mt-1 text-white">{full(d.totalTokens)} tokens</div>
    </div>
  );
}

export default function DailyChart({ data, i }) {
  const days = (data || []).slice(-28);
  const lastIdx = days.length - 1;
  return (
    <Cell
      i={i}
      className="col-span-1 p-8 md:col-span-3 md:row-span-2 lg:col-span-2"
      data-testid="daily-usage-chart"
    >
      <div className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-widest-2 text-sub">
        <span className="block h-[6px] w-[6px] bg-white/60" />
        Daily ledger
      </div>
      <h2 className="mt-3 font-head text-2xl font-bold uppercase tracking-tight text-white">
        Recent agent workload
      </h2>
      <div className="mt-6 h-[260px] w-full">
        {days.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={days} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
              <XAxis
                dataKey="date"
                tickFormatter={(v) => v.slice(5)}
                tick={{ fill: "#4A4D54", fontSize: 9, fontFamily: "JetBrains Mono" }}
                axisLine={false}
                tickLine={false}
                interval={Math.max(0, Math.floor(days.length / 8))}
              />
              <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<CustomTooltip />} />
              <Bar dataKey="totalTokens" radius={[2, 2, 0, 0]}>
                {days.map((_, idx) => (
                  <RCell key={idx} fill={idx === lastIdx ? "#FFFFFF" : "#3A3A3A"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="font-body text-sm text-sub">No daily records yet.</p>
        )}
      </div>
    </Cell>
  );
}
