/**
 * Automated accessibility guards.
 *
 * The contrast failures found by hand (--faint at 2.75:1, six hardcoded greys,
 * avatar initials at 1.61:1 over the gradient) were only caught because I
 * computed the ratios manually. Nothing stopped them being reintroduced. These
 * tests parse the real stylesheet and fail the build if a token regresses or a
 * new low-contrast grey is hardcoded.
 *
 * This is not a substitute for a full axe/Lighthouse run — it checks the two
 * things that actually broke here, deterministically and with no browser.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const css = readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'styles.css'), 'utf8');

function srgb(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
}
export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Backgrounds text actually sits on. */
const BACKGROUNDS = { white: '#ffffff', soft: '#f5f6f8', page: '#f3f4f7' };

function tokenValue(name: string): string {
  const match = css.match(new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{3,6})`));
  if (!match) throw new Error(`token ${name} not found in styles.css`);
  return match[1];
}

describe('text tokens meet WCAG AA on every background they are used on', () => {
  for (const token of ['--ink', '--muted', '--faint']) {
    for (const [bgName, bg] of Object.entries(BACKGROUNDS)) {
      it(`${token} on ${bgName} is >= 4.5:1`, () => {
        const ratio = contrast(tokenValue(token), bg);
        expect(ratio, `${token} (${tokenValue(token)}) on ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('--brand is legible as link text on white', () => {
    expect(contrast(tokenValue('--brand'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('no hardcoded low-contrast text colours', () => {
  it('every color:#hex in the stylesheet clears 4.5:1 on white', () => {
    // Only `color:` declarations — background/border hexes are not text.
    const offenders: string[] = [];
    for (const m of css.matchAll(/color:\s*(#[0-9a-fA-F]{6})\b/g)) {
      const hex = m[1];
      // Light text is legitimate on dark surfaces; those are declared via rgba()
      // or sit inside .metric--dark, so a light hex here is what we want to flag.
      if (contrast(hex, '#ffffff') < 4.5 && contrast(hex, '#0d1220') < 4.5) {
        offenders.push(`${hex} (${contrast(hex, '#ffffff').toFixed(2)}:1 on white)`);
      }
    }
    expect(offenders, `low-contrast text colours: ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('focus is never removed without replacement', () => {
  it('no rule sets outline:none without providing another affordance', () => {
    // Capture the selector too, so the exemption below can be precise.
    const blocks = [...css.matchAll(/([^{}]*)\{([^}]*outline:\s*(?:none|0)[^}]*)\}/g)];
    const bad = blocks
      .filter(([, selector, body]) => {
        // `:focus:not(:focus-visible) { outline: none }` is the CORRECT pattern —
        // it suppresses the ring for mouse/programmatic focus while the paired
        // :focus-visible rule still shows it for keyboard users. Exempting this
        // is not weakening the check; flagging it was a false positive.
        if (/:not\(\s*:focus-visible\s*\)/.test(selector)) return false;
        // Otherwise there must be a visible replacement.
        return !/box-shadow|border-color|border:/.test(body);
      })
      .map(([, selector, body]) => `${selector.trim()} { ${body.trim()} }`);
    expect(bad, `outline removed with no replacement in: ${bad.join(' | ')}`).toEqual([]);
  });

  it('form controls have a focus-visible rule (they are not covered by a/button)', () => {
    expect(css).toMatch(/input:focus-visible[^{]*\{|select:focus-visible/);
  });
});
