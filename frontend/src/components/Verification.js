import React from "react";
import { Cell } from "./Panels";
import { dateTimeShort } from "../lib/datetime";

export default function Verification({ snapshot, i }) {
  const v = snapshot.verification || {};
  const hash = v.snapshotSha256 || "pending local collector";
  const rows = [
    ["GENERATED", dateTimeShort(snapshot.generatedAt)],
    ["SOURCE", snapshot.source || "—"],
    ["SCHEMA", v.schemaVersion || "—"],
    ["COLLECTOR", snapshot.collectorVersion || "—"],
    ["RAW_LOGS", v.rawLogsPublished ? "published" : "WITHHELD"],
  ];
  return (
    <Cell
      i={i}
      className="scanlines col-span-1 overflow-hidden p-8 md:col-span-2 md:row-span-2 lg:col-span-2"
      data-testid="verification-hash-panel"
    >
      <div className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-widest-2 text-verified">
        <span className="block h-[6px] w-[6px] bg-verified" />
        Proof layer
      </div>
      <h2 className="mt-3 font-head text-2xl font-bold uppercase tracking-tight text-white">
        Sanitized snapshot
      </h2>

      <div className="relative z-[3] mt-6 border border-hair bg-black/40 p-5 font-mono text-xs">
        <div className="text-[10px] tracking-widest-2 text-faint">SNAPSHOT_SHA256</div>
        <div className="mt-2 break-all text-verified">{hash}</div>
      </div>

      <dl className="relative z-[3] mt-5 space-y-2 font-mono text-xs">
        {rows.map(([k, val]) => (
          <div
            key={k}
            className="flex items-center justify-between border-b border-hair/60 pb-2"
          >
            <dt className="tracking-widest-2 text-faint">{k}</dt>
            <dd
              className={`text-right ${
                val === "WITHHELD" ? "text-live" : "text-white"
              }`}
            >
              {val}
            </dd>
          </div>
        ))}
      </dl>

      <div className="relative z-[3] mt-5 font-mono text-[11px] leading-relaxed text-faint">
        <div>$ collector --sanitize --no-paths --no-prompts</div>
        <div className="text-sub">› raw logs withheld · qira-only allowlist · hash verified</div>
      </div>
    </Cell>
  );
}
