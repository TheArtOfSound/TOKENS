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
  /** Goes next to every token total, without exception. */
  volume: 'Volume is not a skill, productivity, or pay score.',

  /** The follow-on, where there is room for it. */
  volumeWhy:
    'It is one activity signal, read alongside work artifacts, efficiency, and confirmed outcomes. Producing the same result with fewer tokens is better, not worse.',

  /** What a signature genuinely establishes. */
  signatureProves:
    'A signature proves a snapshot came from a device key and has not been altered since.',

  /** And what it does not — the inference the claim ladder exists to block. */
  signatureNotIdentity:
    'It does not prove who holds that key. Linking an external account proves control of that account — not legal identity.',
} as const;
