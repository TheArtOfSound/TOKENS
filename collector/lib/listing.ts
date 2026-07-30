/**
 * The directory-listing disclosure.
 *
 * This is the only screen most CLI members will ever read about publication, so
 * it carries the whole informed-consent burden. Six things must be present or it
 * is a click-through rather than consent:
 *
 *   1. that publication is a distinct act from measurement
 *   2. the exact fields that become public — enumerated, not gestured at
 *   3. where it appears, as a literal URL
 *   4. that it is public, search-indexed, and permanently cached by third parties
 *   5. how to withdraw, with the literal command, stated BEFORE the question
 *   6. who operates it, and what leaves the machine
 *
 * The rendered text is hashed and the hash is stored with the answer, so "what
 * exactly did they agree to" stays answerable after the wording changes.
 *
 * Deliberately NOT provided: any --yes flag. A flag exists precisely for the
 * unattended case, which is the one context where consent cannot be informed,
 * and it would emit a record indistinguishable from a typed yes. `answeredVia`
 * has no 'flag-yes' member for the same reason.
 */

import { createHash } from 'node:crypto';
import type { ConsentConfig, FieldKey } from './consent';
import { FIELD_LABELS, disabledFields } from './consent';

export const SITE_ORIGIN = (process.env.LEDGER_SITE_URL ?? 'https://ledger.imagineqira.com').replace(
  /\/+$/,
  '',
);

export interface DisclosureInput {
  handle: string;
  displayName: string;
  config: ConsentConfig;
}

export interface RenderedDisclosure {
  text: string;
  sha256: string;
  publicUrl: string;
  fields: FieldKey[];
}

/** Fields that will actually be published, given this member's own consent. */
export function publishableFields(config: ConsentConfig): FieldKey[] {
  const off = new Set(disabledFields(config));
  return (Object.keys(FIELD_LABELS) as FieldKey[]).filter((k) => !off.has(k));
}

export function renderDisclosure(input: DisclosureInput): RenderedDisclosure {
  const publicUrl = `${SITE_ORIGIN}/u/${input.handle}`;
  const fields = publishableFields(input.config);
  const fieldLines = fields.map((k) => `    - ${FIELD_LABELS[k]}`).join('\n');

  const text = `
  LIST ME IN THE PUBLIC DIRECTORY?

  Measuring your AI work and publishing yourself are two different things. So far
  this tool has only measured — nothing about you is public. This step is the one
  that publishes a person.

  WHAT BECOMES PUBLIC
${fieldLines}

    Published as: ${input.displayName} (@${input.handle})
    At this URL:  ${publicUrl}

  WHAT DOES NOT
    Your prompts, your code, your file paths, your API keys, your hostnames, and
    your raw provider account ids are never published. Session identifiers are
    stored as keyed hashes under a salt that stays on this machine.

  WHERE IT GOES
    Qira runs no server for this. Your signed snapshot is pushed to a public
    repository in YOUR OWN GitHub account, using YOUR OWN credentials, and the
    directory holds a pointer to it. Qira hosts the list, not your data.

    Joining opens a pull request from your GitHub account. That pull request is
    permanent public GitHub history, under whatever name your GitHub account uses.

  THIS IS PUBLIC, AND FINDABLE
    The page is indexed by search engines on purpose. Anyone — including current
    and future employers — can find it. Third-party caches and archives keep
    copies that nobody, including us, can delete.

  WHAT THE NUMBERS DO NOT MEAN
    Token volume is evidence of activity, not expertise, productivity,
    efficiency, or professional value. Nothing here ranks people.

  HOW TO UNDO IT
    Run:  npm run unlist
    That withdraws your listing and stops any further updates. It cannot reach
    Google's cache, an archive scrape, or the git history of your own snapshot
    repository. Publish nothing you would not want public.
`.trimEnd();

  return {
    text,
    sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
    publicUrl,
    fields,
  };
}

/**
 * Whether a human can actually be asked right now.
 *
 * Keys off stdin, not stdout: `npm run list-me | tee log.txt` still has a human
 * at the keyboard, and telling them to "run this from a terminal" when they are
 * in one is its own bug. TOKENS_NON_INTERACTIVE is set explicitly by the launchd
 * script so the guarantee does not rest on stdio inheritance.
 */
export function canPrompt(): boolean {
  if (process.env.TOKENS_NON_INTERACTIVE) return false;
  if (process.env.CI) return false;
  return Boolean(process.stdin.isTTY);
}
