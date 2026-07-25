/**
 * Onboarding — how someone actually gets their own profile.
 *
 * Two routes, per the review: a one-command install for most people, and the
 * from-source path for developers. Both are cross-platform (macOS, Linux,
 * Windows). The page stays honest: nothing is uploaded, there is no account, and
 * every command is inspectable before it runs. The "review before publishing"
 * step is deliberately not optional in the copy — it is what makes the privacy
 * promise checkable rather than trusted.
 */

import { useState } from 'react';
import { href } from '../lib/router';

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

type OS = 'mac' | 'linux' | 'windows';

const INSTALL: Record<OS, { label: string; cmd: string; script: string }> = {
  mac: { label: 'macOS', cmd: 'curl -fsSL https://ledger.imagineqira.com/install.sh | bash', script: '/install.sh' },
  linux: { label: 'Linux', cmd: 'curl -fsSL https://ledger.imagineqira.com/install.sh | bash', script: '/install.sh' },
  windows: { label: 'Windows', cmd: 'irm https://ledger.imagineqira.com/install.ps1 | iex', script: '/install.ps1' },
};

export function Join() {
  const [os, setOs] = useState<OS>(() => {
    const p = typeof navigator !== 'undefined' ? navigator.platform.toLowerCase() : '';
    if (p.includes('win')) return 'windows';
    if (p.includes('linux')) return 'linux';
    return 'mac';
  });
  const active = INSTALL[os];

  return (
    <section className="join" id="join">
      <header className="join-head">
        <h2>Measure your own AI work</h2>
        <p className="lede">
          TOKENS runs on your machine — macOS, Linux, or Windows. It reads the usage logs Claude Code and
          Codex already write, counts tokens, and produces a signed summary you can publish. There is no
          account, and your prompts, code, and file paths never leave your computer.
        </p>
      </header>

      {/* Primary route */}
      <div className="install-primary">
        <h3>1. Install</h3>
        <div className="os-tabs" role="tablist" aria-label="Operating system">
          {(Object.keys(INSTALL) as OS[]).map((key) => (
            <button
              key={key}
              role="tab"
              aria-selected={os === key}
              className={`os-tab ${os === key ? 'is-active' : ''}`}
              onClick={() => setOs(key)}
            >
              {INSTALL[key].label}
            </button>
          ))}
        </div>
        <Command>{active.cmd}</Command>
        <p className="muted">
          Requires <strong>Node 22+</strong> and <strong>git</strong>. The installer only clones the
          open-source collector and installs dependencies — it never reads your logs or publishes anything.
          Prefer to read it first? It's ~40 lines:{' '}
          <a href={active.script} target="_blank" rel="noopener noreferrer">inspect {active.script}</a>.
        </p>
        <details className="advanced">
          <summary>Advanced: install from source</summary>
          <Command>git clone https://github.com/TheArtOfSound/TOKENS.git</Command>
          <Command>cd TOKENS &amp;&amp; npm ci</Command>
        </details>
      </div>

      {/* Shared flow — identical on every OS */}
      <ol className="steps">
        <li>
          <h3>2. See what it would read, before it reads anything</h3>
          <p>Lists every source it can see, what each extracts, and what it discards. Any source can be turned off and stays off.</p>
          <Command>npm run consent</Command>
        </li>
        <li>
          <h3>3. Measure</h3>
          <p>Reads your local provider logs into a private SQLite ledger on your machine. Incremental — about 20 seconds the first run, near-instant after.</p>
          <Command>npm run ingest</Command>
        </li>
        <li>
          <h3>4. Review exactly what would be published</h3>
          <p>Prints the full payload, field by field. Nothing is published until you have seen this. If it contains anything unexpected, that is a bug and the collector should fail rather than publish it.</p>
          <Command>npm run consent:preview</Command>
        </li>
        <li>
          <h3>5. Build your profile</h3>
          <p>
            Copy the examples, then make them yours. Your personal config is gitignored, so nothing you write
            here is ever shipped to anyone else's clone.
          </p>
          <Command>cp profile/profile.example.json profile/profile.json</Command>
          <p className="muted">
            Edit <code>profile/profile.json</code> (name or pseudonym, headline, what you're open to). Optional
            extras: <code>work.example.json</code> for featured work, <code>opportunity.example.json</code> for
            availability and rates, and <code>projects.example.json</code> to let the collector look for your
            own projects on this machine. Then generate and sign your snapshot.
          </p>
          <Command>npm run collect</Command>
          <p className="muted">
            Signing uses an Ed25519 key generated on your machine. On macOS it's stored in the Keychain; on
            Linux and Windows in a permission-restricted local file. The private key never leaves the device,
            and anyone can verify your snapshot without trusting us.
          </p>
        </li>
        <li>
          <h3>6. Publish it</h3>
          <p>
            Host <code>public/data/latest.json</code> anywhere you control — GitHub Pages, your own domain, any
            static host — then open a pull request adding your entry to{' '}
            <code>public/data/profiles/index.json</code>.
          </p>
          <Command>npm run build</Command>
          <p className="muted">You keep hosting your own data. Removing your entry removes you from the directory — we hold nothing of yours to delete.</p>
          <p>Your data stays yours, and these work at any time, on any OS:</p>
          <Command>npm run consent:export</Command>
          <Command>npm run consent:delete</Command>
        </li>
      </ol>

      <p className="muted os-note">
        Keeping it current: run <code>npm run collect</code> whenever you want to refresh. To automate it,
        macOS uses launchd (<code>bash scripts/install-launchd.sh</code>), Linux a cron job, and Windows Task
        Scheduler — all optional. See{' '}
        <a href="https://github.com/TheArtOfSound/TOKENS/blob/main/docs/CROSS_PLATFORM.md" target="_blank" rel="noopener noreferrer">the cross-platform guide</a>.
      </p>

      <section className="join-honest">
        <h3>What this does and does not claim</h3>
        <ul>
          <li><strong>Measured, not estimated.</strong> Token counts come from the providers' own usage accounting in your local logs.</li>
          <li><strong>A signature proves integrity, not identity.</strong> It shows a snapshot came from a specific device key and was not altered. It doesn't prove who you are, and it can't prove your provider logs were genuine — anyone controlling a machine could feed the collector fabricated logs.</li>
          <li><strong>Volume is not skill.</strong> Nothing here ranks people by token count, and no profile infers expertise from usage. Activity is evidence of practice.</li>
          <li><strong>Each evidence tier says exactly what it checked.</strong> You can link an external account (e.g. GitHub) and visitors verify that in their own browser — it proves you control that account, not your legal identity. Provider-attested usage, benchmarks, and third-party-confirmed outcomes are stronger tiers that are <em>not</em> built yet, and every profile shows them as pending rather than implying they were checked.</li>
        </ul>
        <p><a href={href({ name: 'verify' })}>How verification works →</a></p>
      </section>
    </section>
  );
}
