/**
 * Onboarding — how someone actually gets their own profile.
 *
 * The whole point of the local-first model is that this page can be honest:
 * nothing is uploaded to us, there is no account to create, and the reader can
 * inspect every command before running it. It walks through install → measure →
 * review what would be published → publish.
 *
 * The "review before publishing" step is deliberately not optional in the copy:
 * it is the step that makes the privacy promise checkable rather than trusted.
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

export function Join() {
  return (
    <section className="join" id="join">
      <header className="join-head">
        <h2>Measure your own AI work</h2>
        <p className="lede">
          TOKENS runs on your machine. It reads the usage logs Claude Code and Codex already write, counts
          tokens, and produces a signed summary you can publish. There is no account, and your prompts,
          code, and file paths never leave your computer.
        </p>
      </header>

      <ol className="steps">
        <li>
          <h3>1. Get the collector</h3>
          <p>Requires Node 22+ and git. The collector is MIT-licensed — read it before you run it.</p>
          <Command>git clone https://github.com/TheArtOfSound/TOKENS.git</Command>
          <Command>cd TOKENS &amp;&amp; npm ci</Command>
        </li>

        <li>
          <h3>2. See what it would read, before it reads anything</h3>
          <p>
            This lists every source it can see on your machine, what each one extracts, and what it discards.
            Any source can be turned off and stays off.
          </p>
          <Command>npm run consent</Command>
        </li>

        <li>
          <h3>3. Measure</h3>
          <p>
            Reads your local provider logs into a private SQLite ledger on your machine. Incremental — the
            first run takes about 20 seconds, later runs are near-instant.
          </p>
          <Command>npm run ingest</Command>
        </li>

        <li>
          <h3>4. Review exactly what would be published</h3>
          <p>
            Prints the full payload, field by field. Nothing is published until you have seen this. If it
            contains anything you did not expect, that is a bug and the collector should fail rather than
            publish it.
          </p>
          <Command>npm run consent:preview</Command>
        </li>

        <li>
          <h3>5. Build your profile</h3>
          <p>
            Edit <code>profile/profile.json</code> with your name or a pseudonym, headline, and what you are
            open to. Add work you want to show in <code>profile/work.json</code>. Then generate and sign your
            snapshot.
          </p>
          <Command>npm run collect</Command>
          <p className="muted">
            Signing uses an Ed25519 key generated on your machine and stored in your Keychain. The private key
            never leaves the device. Anyone can verify your snapshot without trusting us.
          </p>
        </li>

        <li>
          <h3>6. Publish it</h3>
          <p>
            Host <code>public/data/latest.json</code> anywhere you control — GitHub Pages, your own domain, any
            static host. Then open a pull request adding your entry to{' '}
            <code>public/data/profiles/index.json</code> so it appears in the directory.
          </p>
          <Command>npm run build</Command>
          <p className="muted">
            You keep hosting your own data. Removing your entry removes you from the directory — we hold
            nothing of yours to delete.
          </p>
          <p>Your data stays yours, and these work at any time:</p>
          <Command>npm run consent:export</Command>
          <Command>npm run consent:delete</Command>
        </li>
      </ol>

      <section className="join-honest">
        <h3>What this does and does not claim</h3>
        <ul>
          <li>
            <strong>Measured, not estimated.</strong> Token counts come from the providers' own usage
            accounting in your local logs.
          </li>
          <li>
            <strong>A signature proves integrity, not identity.</strong> It shows a snapshot came from a
            specific device key and was not altered. It does not prove who you are, and it cannot prove your
            provider logs were genuine — anyone controlling a machine could feed the collector fabricated
            logs.
          </li>
          <li>
            <strong>Volume is not skill.</strong> Nothing here ranks people by token count, and no profile
            infers expertise from usage. Activity is evidence of practice.
          </li>
          <li>
            <strong>Identity, work, and outcome verification are not built yet.</strong> Every profile shows
            those as pending rather than implying they were checked.
          </li>
        </ul>
        <p>
          <a href={href({ name: 'verify' })}>How verification works →</a>
        </p>
      </section>
    </section>
  );
}
