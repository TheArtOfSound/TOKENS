import React from "react";
import { motion } from "framer-motion";
import { dayMonth } from "../lib/datetime";

function totalFiles(p) {
  return Object.values(p.fileCounts || {}).reduce((s, n) => s + n, 0);
}

export default function ProjectMatrix({ projects, scanner, i }) {
  const list = projects || [];
  const found = list.filter((p) => p.found).length;
  return (
    <section id="projects" className="mt-[1px] bg-surface p-8 lg:p-10">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
      >
        <div className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-widest-2 text-sub">
          <span className="block h-[6px] w-[6px] bg-white/60" />
          Tier 1 — Qira systems only
        </div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-6">
          <h2 className="font-head text-3xl font-bold uppercase tracking-tight text-white">
            Project matrix
          </h2>
          <div className="flex gap-6 font-mono text-xs">
            <span className="text-white">
              {found}/{list.length} <span className="text-faint">FOUND</span>
            </span>
            <span className="text-white">
              {scanner?.rootsChecked ?? 0} <span className="text-faint">ROOTS</span>
            </span>
            <span className="text-white">
              {scanner?.allowlistedProjects ?? list.length}{" "}
              <span className="text-faint">ALLOWLISTED</span>
            </span>
          </div>
        </div>
      </motion.div>

      <div className="mt-8 overflow-x-auto" data-testid="project-matrix-table">
        <table className="w-full min-w-[720px] border-collapse font-mono text-sm">
          <thead>
            <tr className="border-b border-hair text-left text-[10px] tracking-widest-2 text-faint">
              <th className="py-3 pr-4 font-medium">REPO</th>
              <th className="py-3 pr-4 font-medium">CATEGORY</th>
              <th className="py-3 pr-4 font-medium">GIT STATE</th>
              <th className="py-3 pr-4 font-medium">STACK</th>
              <th className="py-3 pr-4 text-right font-medium">FILES</th>
              <th className="py-3 pr-4 text-right font-medium">SCANNED</th>
              <th className="py-3 text-right font-medium">STATUS</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr
                key={p.name}
                className="border-b border-hair/60 transition-colors duration-150 hover:bg-elevated"
                data-testid={`project-row-${p.name}`}
              >
                <td className="py-4 pr-4 font-semibold text-white">{p.name}</td>
                <td className="py-4 pr-4 text-sub">{p.category}</td>
                <td className="py-4 pr-4 text-sub">
                  {p.git?.branch ? (
                    <span>
                      {p.git.branch}
                      <span className="text-faint"> · {p.git.commit}</span>
                      {p.git.changedFiles != null ? (
                        <span className="text-live"> · {p.git.changedFiles}Δ</span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </td>
                <td className="py-4 pr-4 text-sub">
                  {p.stack?.length ? p.stack.slice(0, 3).join(" · ") : <span className="text-faint">—</span>}
                </td>
                <td className="py-4 pr-4 text-right text-white">{totalFiles(p) || "—"}</td>
                <td className="py-4 pr-4 text-right text-sub">
                  {p.lastModified ? dayMonth(p.lastModified) : "—"}
                </td>
                <td className="py-4 text-right">
                  <span
                    className={`inline-block px-2 py-1 text-[10px] tracking-widest-2 ${
                      p.found ? "bg-white/10 text-white" : "bg-elevated text-faint"
                    }`}
                  >
                    {p.found ? "FOUND" : "WAITING"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
