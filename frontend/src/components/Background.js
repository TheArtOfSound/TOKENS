import React from "react";

// Low-opacity animated technical grid + network lines behind the UI.
export default function Background() {
  const cols = Array.from({ length: 14 });
  const rows = Array.from({ length: 9 });
  return (
    <>
      <div className="grain" />
      <svg
        className="fixed inset-0 -z-10 h-full w-full grid-move"
        preserveAspectRatio="none"
        viewBox="0 0 1400 900"
        aria-hidden="true"
      >
        <g stroke="#FFFFFF" strokeWidth="1" opacity="0.04">
          {cols.map((_, i) => (
            <line key={`c${i}`} x1={(i * 1400) / 13} y1="0" x2={(i * 1400) / 13} y2="900" />
          ))}
          {rows.map((_, i) => (
            <line key={`r${i}`} x1="0" y1={(i * 900) / 8} x2="1400" y2={(i * 900) / 8} />
          ))}
        </g>
        <g
          stroke="#FF3B30"
          strokeWidth="1"
          fill="none"
          opacity="0.18"
          strokeDasharray="6 10"
        >
          <path d="M0 180 L300 240 L520 160 L780 280 L1040 190 L1400 300" />
          <path d="M0 640 L260 560 L540 660 L820 520 L1120 620 L1400 540" />
        </g>
        <g fill="#FF3B30" opacity="0.4">
          {[
            [300, 240],
            [780, 280],
            [1040, 190],
            [540, 660],
            [820, 520],
            [1120, 620],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="2.5" />
          ))}
        </g>
      </svg>
      <div className="fixed inset-0 -z-10 bg-gradient-to-b from-transparent via-transparent to-black" />
    </>
  );
}
