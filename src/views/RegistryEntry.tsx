/**
 * Registry-entry generator.
 *
 * The last real adoption wall: joining required hand-writing JSON, knowing the
 * registry file's shape, and opening a pull request. That is fine for developers
 * and a hard stop for everyone else — and it is the single biggest limiter on
 * this directory growing.
 *
 * This turns it into: fill four fields, click, paste, submit. It validates the
 * same way the site does at runtime (handle shape, https-only snapshot URL), so
 * a malformed entry is caught here rather than in review.
 *
 * It deliberately does NOT submit anything on the member's behalf. Publishing is
 * their action, on their account — consistent with the rest of the product,
 * where nothing leaves a machine without the person doing it themselves.
 */

import { useMemo, useState } from 'react';
import { isValidHandle, isSafeSnapshotUrl } from '../lib/registry';

const REPO = 'TheArtOfSound/TOKENS';
const REGISTRY_PATH = 'public/data/profiles/index.json';

export function RegistryEntry() {
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [headline, setHeadline] = useState('');
  const [snapshotUrl, setSnapshotUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (handle && !isValidHandle(handle)) {
      e.handle = 'Lowercase letters, numbers, and hyphens only (2–39 characters).';
    }
    if (snapshotUrl && !isSafeSnapshotUrl(snapshotUrl)) {
      e.snapshotUrl = 'Must be an https:// URL pointing at your published latest.json.';
    }
    return e;
  }, [handle, snapshotUrl]);

  const ready = handle && displayName && headline && snapshotUrl && Object.keys(errors).length === 0;

  const entry = useMemo(
    () =>
      JSON.stringify(
        {
          handle: handle || 'your-handle',
          displayName: displayName || 'Your Name',
          headline: headline || 'What you do',
          snapshotUrl: snapshotUrl || 'https://example.com/data/latest.json',
        },
        null,
        2,
      ),
    [handle, displayName, headline, snapshotUrl],
  );

  const copy = () => {
    navigator.clipboard?.writeText(entry).then(
      () => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); },
      () => setCopied(false),
    );
  };

  return (
    <div className="jcard jcard-pad registry-gen">
      <h2>Generate your directory entry</h2>
      <p className="jcard-sub">
        Fill this in and it writes the JSON for you — no hand-editing. It is validated here with the same
        rules the site uses, so a malformed entry gets caught now rather than in review.
      </p>

      <div className="rg-fields">
        <div className="rg-field">
          <label htmlFor="rg-handle">Handle <span>your profile URL: /u/&lt;handle&gt;</span></label>
          <input id="rg-handle" value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase())}
                 placeholder="jane-dev" aria-invalid={!!errors.handle}
                 aria-describedby={errors.handle ? 'rg-handle-err' : undefined} />
          {errors.handle ? <p className="rg-err" id="rg-handle-err">{errors.handle}</p> : null}
        </div>

        <div className="rg-field">
          <label htmlFor="rg-name">Display name <span>a pseudonym is fine</span></label>
          <input id="rg-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Jane Dev" />
        </div>

        <div className="rg-field rg-wide">
          <label htmlFor="rg-headline">Headline</label>
          <input id="rg-headline" value={headline} onChange={(e) => setHeadline(e.target.value)}
                 placeholder="Backend engineer working with AI agents" />
        </div>

        <div className="rg-field rg-wide">
          <label htmlFor="rg-url">Snapshot URL <span>where you host your signed latest.json</span></label>
          <input id="rg-url" type="url" value={snapshotUrl} onChange={(e) => setSnapshotUrl(e.target.value)}
                 placeholder="https://you.github.io/tokens/data/latest.json" aria-invalid={!!errors.snapshotUrl}
                 aria-describedby={errors.snapshotUrl ? 'rg-url-err' : undefined} />
          {errors.snapshotUrl ? <p className="rg-err" id="rg-url-err">{errors.snapshotUrl}</p> : null}
        </div>
      </div>

      <label className="rg-outlabel" htmlFor="rg-out">Your entry</label>
      <div className="badge-snippet">
        <code id="rg-out">{entry}</code>
        <button type="button" className="btn btn-ghost" onClick={copy} disabled={!ready}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <ol className="rg-steps">
        <li>Copy the entry above.</li>
        <li>
          <a className="btn btn-secondary btn-sm"
             href={`https://github.com/${REPO}/edit/main/${REGISTRY_PATH}`}
             target="_blank" rel="noopener noreferrer">
            Open the registry on GitHub
          </a>{' '}
          — it opens in edit mode.
        </li>
        <li>Paste your entry into the <code>members</code> array, then submit it as a pull request.</li>
      </ol>

      <p className="muted rg-note">
        Nothing is submitted for you. The pull request comes from your own GitHub account, the same way
        everything else here stays your action on your machine.
      </p>
    </div>
  );
}
