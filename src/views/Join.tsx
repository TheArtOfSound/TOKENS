/**
 * Production onboarding for the current static Ledger deployment.
 *
 * The browser cannot read local provider logs and Ledger does not yet run a
 * hosted publication API. This page therefore points to the one working flow:
 * install locally, run one guided command, inspect the exact signed payload,
 * then explicitly enroll through the GitHub-backed directory process.
 */

import { useState } from 'react';
import { href } from '../lib/router';

type OS = 'mac' | 'linux' | 'windows';

const INSTALL: Record<OS, { label: string; command: string; script: string; next: string }> = {
  mac: {
    label: 'macOS',
    command: 'curl -fsSL https://ledger.imagineqira.com/install.sh | bash',
    script: '/install.sh',
    next: 'cd ~/TOKENS && npm run join',
  },
  linux: {
    label: 'Linux',
    command: 'curl -fsSL https://ledger.imagineqira.com/install.sh | bash',
    script: '/install.sh',
    next: 'cd ~/TOKENS && npm run join',
  },
  windows: {
    label: 'Windows',
    command: 'irm https://ledger.imagineqira.com/install.ps1 | iex',
    script: '/install.ps1',
    next: 'Set-Location "$HOME\\TOKENS"; npm run join',
  },
};

function Command({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="command">
      <code>{children}</code>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(children).then(
            () => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            },
            () => setCopied(false),
          );
        }}
        aria-label={`Copy command: ${children}`}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

export function Join() {
  const [os, setOs] = useState<OS>(() => {
    const platform = typeof navigator === 'undefined' ? '' : navigator.platform.toLowerCase();
    if (platform.includes('win')) return 'windows';
    if (platform.includes('linux')) return 'linux';
    return 'mac';
  });
  const active = INSTALL[os];

  return (
    <section className="join" id="join">
      <header className="join-head">
        <p className="join-time">Local-first onboarding · explicit publication only</p>
        <h1>Add your profile</h1>
        <p className="lede">
          Install the collector, run one guided command, review the exact signed public payload, and then
          decide whether to request a directory listing. Installing, scanning, or creating a profile never
          makes you public automatically.
        </p>
      </header>

      <div className="jcard jcard-pad wizard-step">
        <h2>1. Install the collector</h2>
        <p className="jcard-sub">
          Requirements: Git and Node.js 22.5 or newer. The installer only downloads the open-source project
          and installs dependencies. It does not read logs or publish data.
        </p>

        <div className="os-tabs" role="tablist" aria-label="Operating system">
          {(Object.keys(INSTALL) as OS[]).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={os === key}
              className={`os-tab ${os === key ? 'is-active' : ''}`}
              onClick={() => setOs(key)}
            >
              {INSTALL[key].label}
            </button>
          ))}
        </div>

        <Command>{active.command}</Command>
        <p className="muted">
          Review the installer before running it:{' '}
          <a href={active.script} target="_blank" rel="noreferrer">
            {active.script}
          </a>
        </p>
      </div>

      <div className="jcard jcard-pad wizard-step">
        <h2>2. Run the guided setup</h2>
        <Command>{active.next}</Command>
        <p className="jcard-sub">The local wizard handles the steps that previously required several commands:</p>
        <ol className="wizard-steps-list">
          <li>Create or update your public profile fields.</li>
          <li>Choose Claude Code, Codex, and project scanning individually.</li>
          <li>Measure enabled sources into the private local ledger.</li>
          <li>Generate and sign the public snapshot on your device.</li>
          <li>Print the complete JSON payload before any public action.</li>
          <li>Ask whether to continue to public directory enrollment.</li>
        </ol>
      </div>

      <div className="jcard jcard-pad wizard-step">
        <h2>3. Public directory enrollment</h2>
        <p>
          Ledger is currently a static site. There is no deployed account or upload server, so the former
          <code> publish:ledger </code> workflow could only contact a development server on the same computer.
          The production-safe enrollment route is now the existing signed-snapshot GitHub flow.
        </p>
        <p>
          When you approve the final step, <code>npm run list-me</code> publishes only your signed snapshot to
          a repository you control and opens a pull request adding its URL to the Ledger member registry.
          Prompts, responses, source code, raw logs, paths, credentials, and private signing keys are not sent.
        </p>
        <p className="muted">
          GitHub CLI authentication is currently required for automatic enrollment. The wizard provides a
          manual fallback when <code>gh</code> is unavailable. A future managed Ledger backend can replace this
          step without changing local collection or signing.
        </p>
      </div>

      <div className="jcard jcard-pad wizard-step">
        <h2>Existing installation</h2>
        <p>Update first, then run the new guided flow:</p>
        {os === 'windows' ? (
          <Command>Set-Location "$HOME\\TOKENS"; git pull --ff-only; npm ci; npm run join</Command>
        ) : (
          <Command>cd ~/TOKENS && git pull --ff-only && npm ci && npm run join</Command>
        )}
      </div>

      <section className="join-honest">
        <h3>What this does and does not establish</h3>
        <ul>
          <li>
            <strong>Local measurement.</strong> Enabled provider records are processed on your machine.
          </li>
          <li>
            <strong>Explicit publication.</strong> Scan does not equal publish. The directory decision is a
            separate question and bare Enter does not mean yes.
          </li>
          <li>
            <strong>Signature scope.</strong> A valid signature proves snapshot integrity and key control, not
            identity, expertise, authorship, permission, source honesty, or outcomes.
          </li>
          <li>
            <strong>No skill ranking.</strong> Token volume is an activity signal, not a score, pay formula, or
            measure of proficiency.
          </li>
        </ul>
        <p>
          <a href={href({ name: 'verify' })}>How verification works →</a>
        </p>
      </section>
    </section>
  );
}
