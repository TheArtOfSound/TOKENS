/**
 * Privacy page.
 *
 * Every claim here was verified against the codebase before being written:
 *  - no analytics/tracking libraries exist in the frontend (grepped)
 *  - the account Worker stores only the allowlisted Oort/handle fields below
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
      <h1>Privacy</h1>
      <p className="lede">
        Ledger is local-first. There is no analytics on this site, and measurement happens entirely on your
        machine. If you choose to connect Oort, Ledger stores only the account and handle fields described
        below; it does not receive your provider logs, prompts, code, private key, or private usage ledger.
        <strong> Publishing is a separate act you choose.</strong> If you join the directory, your snapshot is
        hosted in your own repository and your entry is added to this project's public repository by a pull
        request you open yourself — so the entry becomes public, permanently, in git history.
      </p>

      <div className="legal-highlight">
        <h2>What this site collects about visitors</h2>
        <p>
          <strong>For ordinary visitors: nothing through the Ledger application.</strong> No analytics, tracking
          pixels, fingerprinting, or advertising. Ledger sets no application cookie unless you explicitly
          connect an Oort account.
        </p>
        <p>
          <strong>If you connect Oort:</strong> a same-origin account service stores your Oort user ID, Oort
          username, email, display name, avatar metadata, account tier, chosen Ledger handle, and timestamps in
          a Cloudflare D1 database. It sets one HttpOnly, Secure, SameSite=Lax session cookie named
          <code> ledger_oort</code>. The cookie contains a signed account reference, not your Oort password.
        </p>
        <p className="muted">
          Static pages are hosted on GitHub Pages behind Cloudflare; the account API runs on Cloudflare Workers.
          Like any web infrastructure, those providers process connection data such as IP addresses in their
          server logs under their own policies. GitHub's policy is available in{' '}
          <a href="https://docs.github.com/site-policy/privacy-policies/github-privacy-statement" target="_blank" rel="noopener noreferrer">
            GitHub's Privacy Statement
          </a>
          . We do not have access to those logs.
        </p>
      </div>

      <h2>Requests your browser makes on this site</h2>
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
        <li>
          <strong>Oort and the same-origin account API</strong> — only when you open or connect a Ledger account.
          Oort performs sign-in, then sends Ledger a five-minute, Ledger-only signed handoff. Ledger replaces it
          with its own session cookie.
        </li>
      </ul>

      <h2>What the collector does on your machine</h2>
      <p>
        The collector runs locally and reads enabled usage records from supported agents, including Claude
        Code, Codex, Grok, Kimi, Gemini CLI, Copilot CLI, and OpenCode. It is
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

      <h2>What you choose to publish is public</h2>
      <p>
        A published profile is a public document on the internet. Your name or pseudonym, headline, links,
        availability, and measured activity are visible to anyone, and may be cached or indexed by third
        parties outside our control. Publish nothing you would not want public.
      </p>

      <h2>Deleting your data</h2>
      <p>
        You can delete the Oort-to-Ledger account link from the account page; that removes the Ledger account
        record and its handle ownership. Public snapshots and the public registry are separate. Remove your
        registry entry and stop hosting your snapshot to withdraw them. Existing git history and copies already
        cached or indexed elsewhere may remain outside our control.
      </p>

      <h2>Children</h2>
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
