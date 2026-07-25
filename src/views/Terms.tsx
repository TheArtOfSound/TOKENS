/**
 * Terms page.
 *
 * Deliberately short and specific to how this actually works: no accounts, no
 * payments, members self-host, and the operator's role is limited to maintaining
 * a registry. The most important clauses are the anti-fabrication rule and the
 * explicit statement that a signature is not an identity or quality guarantee —
 * they are the terms equivalent of the claim-authority ladder.
 */

import { href } from '../lib/router';

export function Terms() {
  return (
    <section className="legal-page" id="terms">
      <h1>Terms of use</h1>
      <p className="lede">
        TOKENS is a free, open-source, local-first tool plus a public directory. There is no account, no
        subscription, and no payment. These terms cover using this site and appearing in the directory.
      </p>

      <h2>What we provide</h2>
      <ul className="legal-list">
        <li>An MIT-licensed collector you run on your own machine.</li>
        <li>A static site that reads publicly published snapshots and verifies their signatures in your browser.</li>
        <li>A registry — a list of pointers to member-hosted snapshots. We host the list, not the data.</li>
      </ul>

      <h2>What we do not provide</h2>
      <ul className="legal-list">
        <li><strong>No identity guarantee.</strong> A signature proves a snapshot came from a device key unaltered. An identity proof shows control of an external account. Neither establishes legal identity.</li>
        <li><strong>No quality, skill, or employability rating.</strong> There is no universal score, and activity volume is not a competence measure.</li>
        <li><strong>No warranty.</strong> The software and site are provided "as is", without warranty of any kind, per the MIT License.</li>
        <li><strong>No employment or hiring relationship.</strong> We are not an employer, agency, or background-check provider, and we do not vet members.</li>
      </ul>

      <h2>Your responsibilities</h2>
      <ul className="legal-list">
        <li><strong>Publish only accurate data.</strong> Do not fabricate logs, forge measurements, or misrepresent what your evidence shows. Fabricated data is the one thing that breaks this system for everyone.</li>
        <li><strong>Be who you say you are.</strong> Do not impersonate another person or organization. Pseudonyms are fine; impersonation is not.</li>
        <li><strong>You own what you publish</strong>, and you are responsible for having the right to publish it — including anything about clients or employers.</li>
        <li><strong>Keep your own data yours.</strong> Review the payload before publishing. Once public, it is public.</li>
      </ul>

      <h2>Removal from the directory</h2>
      <p>
        You can remove yourself at any time by deleting your registry entry or by no longer hosting your
        snapshot. We may remove an entry that impersonates someone, appears fabricated, is unreachable for a
        long period, or is unlawful. Removal from the registry does not delete anything from your machine or
        from your own host — we never had it.
      </p>

      <h2>For employers and recruiters</h2>
      <p>
        Evidence here is a starting point, not a hiring decision. Read the{' '}
        <a href={href({ name: 'claims' })}>claim-authority ladder</a> before drawing conclusions: each signal
        supports one narrow claim, and combining signals never increases their authority. Do your own
        interviewing, verification, and reference checks.
      </p>

      <h2>Changes</h2>
      <p>
        These terms may change as the product changes. Material changes will be reflected here and in the
        repository's commit history, which is public.
      </p>

      <div className="legal-note">
        <strong>Not legal advice.</strong> This is a plain-language description of how the project operates,
        written by its maintainer and not reviewed by a lawyer. Have counsel review before relying on it
        commercially.
      </div>

      <p className="muted">
        <a href={href({ name: 'privacy' })}>Privacy →</a> ·{' '}
        <a href="https://github.com/TheArtOfSound/TOKENS/blob/main/SECURITY.md" target="_blank" rel="noopener noreferrer">Security policy →</a>
      </p>
    </section>
  );
}
