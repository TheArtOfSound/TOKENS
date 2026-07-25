/**
 * Copy-accuracy guards.
 *
 * This product's entire premise is honest labeling, so a stale claim is a real
 * defect — and underclaiming is as damaging as overclaiming. Identity
 * verification shipped, yet three separate pages went on saying it was "not
 * built": the Directory footnote, the Join page, and the Verify page. Each was
 * found by hand, one at a time.
 *
 * These tests scan the actual view sources so the next one fails the build.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const VIEWS = path.join(__dirname, '..', '..', 'views');
const sources = readdirSync(VIEWS)
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => ({ file: f, text: readFileSync(path.join(VIEWS, f), 'utf8') }));

describe('no stale "not built" claims about shipped features', () => {
  // Phrases that were true before identity verification shipped.
  const STALE = [
    /identity verification is not built/i,
    /Identity,\s*work,\s*and outcome verification are not built/i,
    /no identity verification (?:is|has been)/i,
  ];

  for (const { file, text } of sources) {
    it(`${file} does not claim identity verification is unbuilt`, () => {
      const hits = STALE.filter((re) => re.test(text)).map((re) => String(re));
      expect(hits, `${file} contains a stale claim: ${hits.join(', ')}`).toEqual([]);
    });
  }
});

describe('no placeholder text ships', () => {
  for (const { file, text } of sources) {
    it(`${file} has no TODO/FIXME/lorem`, () => {
      // Match only in rendered strings, not in the word "todo" inside code.
      expect(/lorem ipsum|TODO:|FIXME|XXX\b/i.test(text), file).toBe(false);
    });
  }
});

describe('every routed page has exactly one h1', () => {
  // Screen-reader users navigate by heading; a page with no h1 has no title.
  const ROUTED = ['Directory.tsx', 'Employer.tsx', 'Join.tsx', 'Verify.tsx',
                  'Claims.tsx', 'Compare.tsx', 'Privacy.tsx', 'Terms.tsx', 'ProfileView.tsx'];
  for (const file of ROUTED) {
    it(`${file} has one h1`, () => {
      const text = sources.find((s) => s.file === file)?.text ?? '';
      expect(text, `${file} not found`).not.toBe('');
      expect((text.match(/<h1[\s>]/g) ?? []).length, `${file} h1 count`).toBe(1);
    });
  }
});
