/**
 * Privacy page.
 *
 * Every claim here was verified against the codebase before being written:
 *  - no analytics/tracking libraries exist in the frontend (grepped)
 *  - the only third-party request is api.github.com, and only when a profile
 *    carries an identity proof (src/lib/identity.ts)
 *  - the collector's allowlist/secret-scan behavior is in docs/PRIVACY.md
 *
 * If any of that changes, this page must change in the same commit. An
 * inaccurate privacy page is the single most damaging thing this project could
 * ship, because honest measurement is the entire premise.
 */

import { href } from '../lib/router';

export function Privacy() {
  return (
    <section className="legal-page" id="privacy">
      <h2>Privacy</h2>
      <p className="lede">
        TOKENS is local-first. There is no account, no server that receives your data, and no analytics on
        this site. The short version: <strong>we do not collect anything from you</strong> — because there is
        nowhere for it to go.
      </p>

      <div className="legal-highlight">
        <h3>What this site collects about visitors</h3>
        <p>
          <strong>Nothing.</strong> No analytics, no tracking pixels, no cookies set by this application, no
          fingerprinting, no advertising. The site is a static bundle; it has no backend and no database.
        </p>
        <p className="muted">
          It is hosted on GitHub Pages, which — like any web host — processes connection data such as IP
          addresses in its server logs. That is GitHub's processing, governed by{' '}
          <a href="https://docs.github.com/site-policy/privacy-policies/github-privacy-statement" target="_blank" rel="noopener noreferrer">
            GitHub's Privacy Statement
          </a>
          . We do not have access to those logs.
        </p>
      </div>

      <h3>Requests your browser makes on this site</h3>
      <ul className="legal-list">
        <li>
          <strong>This origin</strong> — the app bundle and published JSON (<code>data/latest.json</code>,
          the member registry, the claim-authority reference).
        </li>
        <li>
          <strong>Each member's own snapshot URL</strong> — members self-host their data, so viewing the
          directory fetches from wherever they host it. Those hosts see your request.
        </li>
        <li>
          <strong>api.github.com</strong> — only when a profile carries an identity proof. Your browser fetches
          the member's public gist to verify the signature itself. Skipped entirely if no proof is present.
        </li>
      </ul>

      <h3>What the collector does on your machine</h3>
      <p>
        The collector runs locally and reads the usage logs Claude Code and Codex already write. It is
        allowlist-based: it names the handful of fields it wants and constructs a new object, so a field it
        doesn't know about cannot leak by default.
      </p>
      <ul className="legal-list">
        <li><strong>Never published:</strong> prompt text, response text, source code, absolute file paths, git branch names, usernames, hostnames, secrets, API keys, or raw provider account identifiers.</li>
        <li><strong>Published:</strong> token counts, dates, model names, and whatever you explicitly put in your profile files.</li>
        <li><strong>Pseudonymous only:</strong> session and file identifiers are stored as keyed HMACs under a per-device salt that never leaves your machine — not reversible, not linkable across devices.</li>
        <li><strong>Local storage:</strong> a SQLite ledger and your signing key stay in a local cache directory. The private key never leaves the device.</li>
      </ul>
      <p>
        You can inspect the exact payload before anything is published (<code>npm run consent:preview</code>),
        disable any source, and export or delete everything (<code>npm run consent:export</code>,{' '}
        <code>npm run consent:delete</code>).
      </p>

      <h3>What you choose to publish is public</h3>
      <p>
        A published profile is a public document on the internet. Your name or pseudonym, headline, links,
        availability, and measured activity are visible to anyone, and may be cached or indexed by third
        parties outside our control. Publish nothing you would not want public.
      </p>

      <h3>Deleting your data</h3>
      <p>
        We hold nothing of yours to delete. Remove your entry from the registry and you are out of the
        directory; stop hosting your snapshot and it is gone. Copies already cached or indexed elsewhere are
        outside anyone's control — including ours.
      </p>

      <h3>Children</h3>
      <p>This is a professional tool and is not directed to children under 13.</p>

      <div className="legal-note">
        <strong>Not legal advice.</strong> This page describes what the software actually does, verified
        against the source. It has not been reviewed by a lawyer, and it is not a substitute for a
        jurisdiction-specific policy. If you rely on this professionally, have counsel review it.
      </div>

      <p className="muted">
        Technical detail: <a href="https://github.com/TheArtOfSound/TOKENS/blob/main/docs/PRIVACY.md" target="_blank" rel="noopener noreferrer">docs/PRIVACY.md</a>{' '}
        · <a href={href({ name: 'claims' })}>What each signal can establish →</a>
      </p>
    </section>
  );
}
