/**
 * Badge tests.
 *
 * These encode the honesty rules as executable constraints rather than comments,
 * because a badge is displayed OUT OF CONTEXT — on a stranger's README, with none
 * of the site's caveats nearby — so an overclaim here is worse than one on the
 * site itself. Every assertion below corresponds to a rule that was violated at
 * least once during design.
 */

import { describe, it, expect } from 'vitest';
import { renderBadge, badgeSnippets, textWidth, CARD_INNER, type BadgeFacts } from '../badge';

const FACTS: BadgeFacts = {
  activeDays: 96,
  asOf: '2026-07-24',
  lastActiveDate: '2026-07-24',
  firstActiveDate: '2026-02-26',
  toolsUsed: ['Claude Code', 'Codex'],
  profileUrl: 'https://ledger.imagineqira.com/u/bryan',
  signature: 'verifiable',
  activeDates: ['2026-02-26', '2026-05-01', '2026-07-24'],
};

const VARIANTS = ['inline', 'mark', 'card'] as const;
const all = () => VARIANTS.map((v) => renderBadge(FACTS, v));

describe('badge honesty', () => {
  it('never renders a token count, cost, score, rank, or percentage', () => {
    for (const svg of all()) {
      // The real totals are ~35 billion tokens; no magnitude of it may appear.
      expect(svg).not.toMatch(/token/i);
      expect(svg).not.toMatch(/\$|USD/);
      expect(svg).not.toMatch(/\b\d+\s*%/);
      expect(svg).not.toMatch(/score|rank|rating|grade|level|tier|top\s*\d/i);
      expect(svg).not.toMatch(/streak/i);
    }
  });

  it('says "verifiable", never the past-tense "verified"', () => {
    // The file is only written after self-verification passes, so it can never
    // render its own failure. Past tense would be a lie of tense.
    for (const svg of all()) {
      expect(svg).not.toMatch(/\bverified\b/i);
    }
    expect(renderBadge(FACTS, 'mark')).toMatch(/signed activity snapshot/);
    expect(renderBadge(FACTS, 'card')).toMatch(/signature verifiable/);
  });

  it('never puts the handle or a display name on the face', () => {
    // A handle beside verification language composes "verified identity".
    // It belongs in the link target, which cannot make that claim.
    for (const svg of all()) {
      expect(svg).not.toMatch(/bryan/i);
    }
  });

  it('states the active-day predicate and the self-measurement caveat on the card', () => {
    const card = renderBadge(FACTS, 'card');
    expect(card).toMatch(/at least one recorded session/);
    expect(card).toMatch(/not a measure of hours or effort/);
    expect(card).toMatch(/No third party checked it/);
    expect(card).toMatch(/does not show identity, skill, quality, or authorship/);
  });

  it('uses no green anywhere; colour appears only on failure faces', () => {
    for (const svg of all()) {
      expect(svg).not.toMatch(/#0a7c3e|#4b0\b|green/i);
    }
    const ok = renderBadge(FACTS, 'inline');
    const bad = renderBadge({ ...FACTS, signature: 'unverified' }, 'inline');
    expect(bad).toMatch(/signature did not verify/);
    expect(renderBadge({ ...FACTS, signature: 'revoked' }, 'inline')).toMatch(/signing key revoked/);
    // The ok face carries no positive-valence accent — absence of alarm is not a
    // checkmark, so there is no "pass" colour to pair with the failure colour.
    expect(ok).not.toMatch(/#8C2F26/i);
  });

  it('refuses to render without an absolute profile URL', () => {
    // A badge that is not a link asserts without citing.
    expect(() => renderBadge({ ...FACTS, profileUrl: '' }, 'inline')).toThrow(/profileUrl/);
    expect(() => renderBadge({ ...FACTS, profileUrl: '/u/bryan' }, 'inline')).toThrow(/profileUrl/);
  });
});

describe('badge rendering safety', () => {
  it('puts textLength on every text element', () => {
    // Without it, a machine lacking Verdana renders a wider fallback and the
    // text spills out of its cell.
    for (const svg of all()) {
      const texts = svg.match(/<text\b[^>]*>/g) ?? [];
      expect(texts.length).toBeGreaterThan(0);
      for (const t of texts) expect(t).toMatch(/textLength="\d+"/);
    }
  });

  it('references nothing external', () => {
    for (const svg of all()) {
      expect(svg).not.toMatch(/<script|onload=|xlink:href="http|href="http.*\.(png|svg|woff)/i);
      expect(svg).not.toMatch(/@font-face|url\(http/i);
    }
  });

  it('keeps every card string inside the card', () => {
    // textLength forces the rendered advance to match the measured width, so an
    // over-long string does not wrap — it runs off the edge. Two did.
    const card = renderBadge(FACTS, 'card');
    const sizes = [...card.matchAll(/font-size="([\d.]+)"[^>]*textLength="(\d+)"/g)];
    expect(sizes.length).toBeGreaterThan(0);
    for (const [, , len] of sizes) expect(Number(len)).toBeLessThanOrEqual(CARD_INNER);
  });

  it('holds the type-scale rule: no glyph over 2x the smallest on a face', () => {
    // Scale is a grading channel exactly like colour. A big number over a small
    // disclaimer is the visual grammar of advertising fine print.
    for (const svg of all()) {
      const sizes = [...svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1]));
      expect(Math.max(...sizes)).toBeLessThanOrEqual(Math.min(...sizes) * 2);
    }
  });

  it('escapes markup in every interpolated field', () => {
    const svg = renderBadge({ ...FACTS, toolsUsed: ['<script>x</script>'] }, 'card');
    expect(svg).not.toMatch(/<script>/);
    expect(svg).toMatch(/&lt;script&gt;/);
  });

  it('renders singular and zero states without breaking', () => {
    const one = renderBadge({ ...FACTS, activeDays: 1 }, 'inline');
    expect(one).toMatch(/1 active AI-work day\b/);
    expect(one).not.toMatch(/1 active AI-work days/);
    const zero = renderBadge(
      { ...FACTS, activeDays: 0, activeDates: [], firstActiveDate: null, lastActiveDate: null, toolsUsed: [] },
      'card',
    );
    expect(zero).toMatch(/nothing recorded yet/);
    expect(zero).toMatch(/0 active AI-work days/);
  });

  it('does not stretch a single measured day across the whole strip', () => {
    // A one-day member once got one column scaled to the full width: a solid bar
    // reading "active throughout" when it meant the opposite.
    const oneDay = renderBadge(
      {
        ...FACTS,
        activeDays: 1,
        firstActiveDate: '2026-07-25',
        lastActiveDate: '2026-07-25',
        activeDates: ['2026-07-25'],
      },
      'card',
    );
    const widths = [...oneDay.matchAll(/<rect[^>]*width="([\d.]+)"[^>]*class="ink2"/g)].map((m) =>
      Number(m[1]),
    );
    for (const w of widths) expect(w).toBeLessThanOrEqual(4);
  });
});

describe('badge geometry', () => {
  it('keeps the 20px faces at 20px so README rows stay aligned', () => {
    for (const v of ['inline', 'mark'] as const) {
      expect(renderBadge(FACTS, v)).toMatch(/height="20"/);
    }
  });

  it('keeps the card within GitHub’s mobile column so it never downscales', () => {
    expect(renderBadge(FACTS, 'card')).toMatch(/width="420"/);
  });

  it('measures text monotonically', () => {
    expect(textWidth('mm', 11)).toBeGreaterThan(textWidth('ii', 11));
    expect(textWidth('abc', 22)).toBeGreaterThan(textWidth('abc', 11));
  });
});

describe('embed snippets', () => {
  it('carry real alt text and point at the given badge and profile', () => {
    const { markdown, html } = badgeSnippets(
      'https://ledger.imagineqira.com/u/jane',
      'https://jane.example/data/badge.svg',
    );
    expect(markdown).toContain('https://jane.example/data/badge.svg');
    expect(markdown).toContain('https://ledger.imagineqira.com/u/jane');
    expect(html).toMatch(/alt="[^"]{20,}"/); // never empty alt
    expect(markdown).not.toMatch(/\bverified\b/i);
  });
});
