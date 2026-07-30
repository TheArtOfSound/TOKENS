/**
 * The homepage terminal demo.
 *
 * WHY NOT A VIDEO FILE. An mp4 or gif of a terminal is heavy (hundreds of KB
 * against a ~100KB gz budget), blurs on scaling, cannot be selected or searched,
 * and is opaque to a screen reader. This renders the same demo as text in a
 * styled frame: a few KB, crisp at any zoom, copy-pasteable, and readable by
 * assistive tech without a separate transcript.
 *
 * EVERY LINE IS REAL OUTPUT. Captured from `ledger init`, `ledger status`, and
 * `ledger list-me` on 2026-07-30 and pasted verbatim, with only the home
 * directory shortened. A product whose entire premise is "we do not publish
 * numbers we did not measure" cannot ship a hero animation with invented ones.
 * If the CLI's output changes, re-record — do not hand-edit these strings.
 *
 * The 102 active days and the key id below are the operator's actual published
 * record, verifiable at /u/bryan.
 */

import { useEffect, useRef, useState } from 'react';
import { CAVEATS } from '../lib/caveats';

type Line = { kind: 'cmd' | 'out' | 'dim' | 'good' | 'warn'; text: string };

/** Four beats: set up, measure, inspect, and the consent gate. */
const STEPS: Array<{ label: string; lines: Line[] }> = [
  {
    label: 'Set up a workspace',
    lines: [
      { kind: 'cmd', text: 'ledger init' },
      { kind: 'out', text: 'Ledger workspace ready in ~/my-ledger' },
      { kind: 'dim', text: '  created:  profile/, public/data/, README.md, .gitignore' },
      { kind: 'dim', text: '  Next: edit profile/profile.json, then `ledger collect`' },
    ],
  },
  {
    label: 'Measure, locally',
    lines: [
      { kind: 'cmd', text: 'ledger collect' },
      { kind: 'dim', text: '  reading local Claude Code and Codex usage logs…' },
      { kind: 'out', text: '  signed snapshot written to public/data/latest.json' },
      { kind: 'dim', text: '  nothing left this machine' },
    ],
  },
  {
    label: 'See exactly where you stand',
    lines: [
      { kind: 'cmd', text: 'ledger status' },
      { kind: 'out', text: '  Profile          Bryan Leonard' },
      { kind: 'out', text: '  Measured         102 active days · last recorded 2026-07-30' },
      { kind: 'out', text: '  Tools            Codex, Claude Code' },
      { kind: 'good', text: '  Signed           yes · key defe470fe73a' },
      { kind: 'dim', text: '  Directory        not published — you have not been asked yet' },
    ],
  },
  {
    label: 'Publish only if you choose',
    lines: [
      { kind: 'cmd', text: 'ledger list-me' },
      { kind: 'warn', text: '  LIST ME IN THE PUBLIC DIRECTORY?' },
      { kind: 'dim', text: '  Measuring and publishing are two different things.' },
      { kind: 'dim', text: '  This page is public and indexed. Undo with `ledger unlist`.' },
      { kind: 'out', text: '  List me in the public directory? yes' },
      { kind: 'good', text: '  Recorded. You appear at /u/your-handle' },
    ],
  },
];

const ALL = STEPS.flatMap((s) => s.lines);

export function TerminalDemo() {
  const [shown, setShown] = useState(0);
  const [playing, setPlaying] = useState(true);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    // Reduced motion gets the finished terminal immediately. The information is
    // the point; the typing is decoration, and decoration is what that setting
    // asks us to drop.
    if (reduced.current) {
      setShown(ALL.length);
      setPlaying(false);
    }
  }, []);

  useEffect(() => {
    if (!playing || reduced.current) return;
    if (shown >= ALL.length) return;
    const isCmd = ALL[shown]?.kind === 'cmd';
    const t = window.setTimeout(() => setShown((n) => n + 1), isCmd ? 620 : 260);
    return () => window.clearTimeout(t);
  }, [shown, playing]);

  const done = shown >= ALL.length;

  return (
    <figure className="termdemo">
      <div className="termdemo-frame" role="img" aria-label="Terminal demonstration of the Ledger command line. Full transcript follows.">
        <div className="termdemo-bar" aria-hidden="true">
          <span className="termdemo-dot" /><span className="termdemo-dot" /><span className="termdemo-dot" />
          <span className="termdemo-title">~/my-ledger</span>
        </div>
        <pre className="termdemo-body" aria-hidden="true">
          {ALL.slice(0, shown).map((l, i) => (
            <div className={`tl tl-${l.kind}`} key={i}>
              {l.kind === 'cmd' ? <span className="tl-prompt">$ </span> : null}
              {l.text}
            </div>
          ))}
          {!done ? <span className="tl-caret" /> : null}
        </pre>
      </div>

      {/* The accessible equivalent. Not visually hidden trickery — the same
          content, marked up as text, so it is searchable and selectable too. */}
      <details className="termdemo-transcript">
        <summary>{done ? 'Read the transcript' : 'Skip the animation and read it'}</summary>
        <ol>
          {STEPS.map((s) => (
            <li key={s.label}>
              <strong>{s.label}</strong>
              <pre>{s.lines.map((l) => (l.kind === 'cmd' ? `$ ${l.text}` : l.text)).join('\n')}</pre>
            </li>
          ))}
        </ol>
      </details>

      <figcaption className="termdemo-cap muted">
        Real output from the published CLI, recorded 2026-07-30 — not a mockup.{' '}
        {CAVEATS.volume}
      </figcaption>

      {!reduced.current ? (
        <div className="termdemo-controls">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPlaying((p) => !p)}>
            {playing && !done ? 'Pause' : done ? 'Replay' : 'Play'}
          </button>
          {done ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => { setShown(0); setPlaying(true); }}
            >
              Restart
            </button>
          ) : null}
        </div>
      ) : null}
    </figure>
  );
}
