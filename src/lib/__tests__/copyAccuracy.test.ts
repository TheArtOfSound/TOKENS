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
import { CAVEATS } from '../caveats';

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

/**
 * Caveat wording must not fork again.
 *
 * The "volume is not a score" point had drifted into five different wordings
 * across the views, and the two identity notes on /people and /employer had
 * drifted into two different claims about the same mechanism. Repetition is
 * intentional here — the framing has to sit next to every number — but five
 * phrasings of one idea reads as a product that is anxious about itself.
 */
describe('caveats stay canonical', () => {
  // Only the STANDALONE framings that were retired. The enumerated bullets on
  // /join and /verify ("Volume is not skill." under a "what this does and does
  // not claim" heading) are a different rhetorical context — a list with its own
  // per-item emphasis — and are deliberately left alone. An earlier version of
  // this pattern was loose enough to flag "Activity is evidence of practice" in
  // Join, which is a positive statement about what activity IS, not a retired
  // disclaimer.
  const RETIRED = [
    /Token volume is not a skill, productivity, or compensation score/i,
    /Activity volume is one signal — not a skill/i,
    /Activity is evidence of practice — not a measure of skill/i,
    /Volume is one activity\s*\n?\s*signal, not a skill or pay score/i,
  ];

  for (const { file, text } of sources) {
    it(`${file} uses no retired wording of the volume caveat`, () => {
      for (const pattern of RETIRED) expect(text).not.toMatch(pattern);
    });
  }

  it('still states the caveat wherever a token total is rendered', () => {
    // The guard that matters: dropping the caveat must fail, not just changing it.
    const withTotals = sources.filter(
      (s) => /compactNumber\(p\.totalTokens\)|totalTokens \?/.test(s.text),
    );
    expect(withTotals.length).toBeGreaterThan(0);
    for (const { file, text } of withTotals) {
      const framed = text.includes('CAVEATS.volume') || text.includes('ActivityDisclaimer');
      expect(framed, `${file} renders a token total without the volume caveat`).toBe(true);
    }
  });

  it('keeps the canonical strings saying what they must', () => {
    expect(CAVEATS.volume).toMatch(/evidence of activity/i);
    expect(CAVEATS.volume).toMatch(/not expertise, productivity, efficiency, or professional value/i);
    expect(CAVEATS.signatureProves).toMatch(/integrity and signing key/i);
    expect(CAVEATS.signatureNotHonesty).toMatch(/source honesty/i);
    expect(CAVEATS.signatureNotIdentity).toMatch(/not legal identity/i);
    // The integrity sentence must never claim identity was proven.
    expect(CAVEATS.signatureProves).not.toMatch(/\bidentity\b/i);
    expect(CAVEATS.productFrame).toMatch(/portable evidence record/i);
  });
});

describe('no overclaiming verification language in views', () => {
  const OVERCLAIM = [
    /Verified AI (?:worker|expert|professional)/i,
    /proven expert/i,
    /objective expertise score/i,
    /verified skill\b/i,
  ];
  for (const { file, text } of sources) {
    it(`${file} avoids generic verified-expertise language`, () => {
      for (const pattern of OVERCLAIM) expect(text, `${file} matched ${pattern}`).not.toMatch(pattern);
    });
  }
});

/**
 * Publication promises must match the code.
 *
 * Privacy.tsx carries its own standing rule: "If any of that changes, this page
 * must change in the same commit. An inaccurate privacy page is the single most
 * damaging thing this project could ship." Directory enrollment changed it, so
 * these guard the sentences that had to move — and, just as importantly, the ones
 * that did NOT have to move.
 */
describe('publication promises are accurate', () => {
  const privacy = sources.find((s) => s.file === 'Privacy.tsx')!.text;
  const join = sources.find((s) => s.file === 'Join.tsx')!.text;

  it('no longer claims there is nowhere for data to go', () => {
    // False once joining puts an entry in a public repo.
    expect(privacy).not.toMatch(/nowhere for it to go/i);
    expect(privacy).not.toMatch(/we do not collect anything from you/i);
  });

  it('no longer claims nothing is automatic', () => {
    // False after the one-time opt-in: refreshes are automatic by design.
    expect(join).not.toMatch(/Nothing is automatic/i);
  });

  it('still keeps the promises that remain true', () => {
    // Account ownership may persist allowlisted Oort metadata, but the core
    // local-first boundary must remain explicit.
    expect(privacy).toMatch(/does not receive your provider logs, prompts, code, private key/i);
    expect(privacy).toMatch(/ordinary visitors: nothing through the Ledger application/i);
    // Installing and scanning still publish nothing — consent is its own command.
    expect(join).toMatch(/Nothing becomes public because you installed or scanned/i);
  });

  it('tells the reader publication is separate, and how to undo it', () => {
    expect(privacy).toMatch(/Publishing is a separate act you choose/i);
    expect(join).toMatch(/npm run unlist/);
  });

  it('is honest that a published entry is permanent in git history', () => {
    expect(privacy).toMatch(/git history/i);
  });
});
