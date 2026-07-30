/**
 * Canonical caveat wording.
 *
 * THE PROBLEM THIS SOLVES IS NOT THAT THE CAVEATS APPEAR OFTEN.
 * They have to. A reader meets a token number on the profile, the directory, and
 * the employer page, and the framing has to be next to the number every time —
 * a caveat that lives only on a methodology page is a caveat nobody reads.
 *
 * The problem was that the same point was written five different ways:
 *
 *   "Token volume is not a skill, productivity, or compensation score."
 *   "Activity volume is one signal — not a skill, productivity, or pay score."
 *   "Activity is evidence of practice — not a measure of skill, seniority, or employability."
 *   "Token volume measures practice, not ability."
 *   "Volume is one activity signal, not a skill or pay score."
 *
 * Five wordings of one idea reads as a product that is anxious about itself. One
 * wording, repeated deliberately wherever it is load-bearing, reads as a product
 * that knows exactly what it claims. Same honesty, less noise.
 *
 * These strings are asserted by copyAccuracy.test.ts so they cannot drift apart
 * again — which is how they got to five in the first place.
 */

export const CAVEATS = {
  /**
   * Goes next to every token total, without exception.
   * Reddit: people still read totals as skill/spend/competition — this sentence
   * must sit beside the number every time.
   */
  volume:
    'Token volume is evidence of activity, not expertise, productivity, efficiency, or professional value.',

  /** The follow-on, where there is room for it. */
  volumeWhy:
    'Read it alongside work artifacts, durability, assessments, and confirmed outcomes. Producing the same result with fewer tokens is better, not worse. Totals can be inflated by waste; they are never a rank or pay basis.',

  /** What a signature genuinely establishes. */
  signatureProves:
    'This signature confirms the integrity and signing key of this snapshot.',

  /**
   * Full integrity ≠ honesty boundary — required next to verification UI.
   * A fabricated log set can still be correctly signed.
   */
  signatureNotHonesty:
    'It does not independently prove identity, authorship, skill, source honesty, permission, or outcomes.',

  /** Account control vs legal identity. */
  signatureNotIdentity:
    'Login or a linked account proves control of that account — not legal identity.',

  /** Preferred product framing (headline-adjacent). */
  productFrame: 'A portable evidence record for AI-assisted work.',

  /**
   * Publication consent. Measuring and publishing are different acts, and this
   * is the sentence that says so. Used by the CLI disclosure, /privacy, /terms,
   * and /join so the promise is worded identically everywhere it is made.
   */
  publicationConsent:
    'Measuring is local and private. Publishing a profile is a separate, explicit choice you make once with `npm run list-me`, and can withdraw with `npm run unlist`.',
} as const;
