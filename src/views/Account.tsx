import { useEffect, useMemo, useState } from 'react';
import {
  deleteLedgerAccount,
  loadLedgerAccount,
  oortConnectUrl,
  signOutLedger,
  updateLedgerHandle,
  type LedgerAccount,
} from '../lib/oortAccount';
import { href } from '../lib/router';

type State =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'ready'; account: LedgerAccount }
  | { kind: 'error'; message: string };

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'L';
}

export function Account() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [handle, setHandle] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [published, setPublished] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oortError = params.get('oort_error');
    if (oortError) setNotice('Oort could not finish connecting. Please try again.');
    loadLedgerAccount().then(
      (account) => {
        if (!account) {
          setState({ kind: 'signed-out' });
          return;
        }
        setHandle(account.handle);
        setState({ kind: 'ready', account });
      },
      (error: unknown) => setState({ kind: 'error', message: error instanceof Error ? error.message : 'Could not load account.' }),
    );
  }, []);

  useEffect(() => {
    if (state.kind !== 'ready') return;
    fetch('/data/profiles/index.json', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data: { members?: Array<{ handle?: string }> }) => {
        setPublished(Boolean(data.members?.some((member) => member.handle === state.account.handle)));
      })
      .catch(() => setPublished(false));
  }, [state]);

  const callbackUrl = useMemo(() => oortConnectUrl('/account'), []);

  if (state.kind === 'loading') {
    return <section className="account-page" aria-busy="true"><p className="muted">Checking your Ledger account…</p></section>;
  }

  if (state.kind === 'error') {
    return (
      <section className="account-page">
        <p className="section-kicker">ACCOUNT</p>
        <h1>Your Ledger account</h1>
        <p className="join-error" role="alert">{state.message}</p>
        <a className="btn btn-primary" href={callbackUrl}>Reconnect through Oort</a>
      </section>
    );
  }

  if (state.kind === 'signed-out') {
    return (
      <section className="account-page">
        <header className="account-intro">
          <p className="section-kicker">OWNERSHIP</p>
          <h1>Own your Ledger account with Oort.</h1>
          <p className="lede">
            One Oort identity controls your Ledger handle and account settings. Your provider logs, prompts,
            code, signing key, and private usage ledger stay on your machine.
          </p>
          {notice ? <p className="join-error" role="alert">{notice}</p> : null}
          <a className="btn btn-primary account-connect" href={callbackUrl}>Continue with Oort</a>
        </header>
        <div className="account-boundary" role="note">
          <strong>What this proves</strong>
          <p>
            Signing in proves control of that Oort account and binds it to one Ledger account. It does not
            prove legal identity, authorship, skill, source honesty, or that any published snapshot is accurate.
          </p>
        </div>
      </section>
    );
  }

  const account = state.account;
  async function saveHandle(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const updated = await updateLedgerHandle(handle);
      setState({ kind: 'ready', account: updated });
      setHandle(updated.handle);
      setNotice('Ledger handle updated.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not update the handle.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="account-page">
      <header className="account-title-row">
        <div>
          <p className="section-kicker">YOUR LEDGER</p>
          <h1>Account and ownership</h1>
        </div>
        <div className="account-identity">
          <span className="account-avatar" style={{ background: account.avatarColor || '#111827' }}>
            {account.avatarUrl ? <img src={account.avatarUrl} alt="" /> : initials(account.displayName)}
          </span>
          <span><strong>{account.displayName}</strong><small>@{account.oortUsername} on Oort</small></span>
        </div>
      </header>

      {notice ? <p className={notice.includes('updated') ? 'account-success' : 'join-error'} role="status">{notice}</p> : null}

      <div className="account-status-line">
        <span className="account-status-dot" />
        <div>
          <strong>Owned by your Oort account</strong>
          <p>{published ? 'Your current handle is listed in the public Ledger directory.' : 'Your account is private until you publish and request directory listing.'}</p>
        </div>
      </div>

      <div className="account-layout">
        <form className="account-settings" onSubmit={(event) => void saveHandle(event)}>
          <h2>Ledger handle</h2>
          <p className="muted">This is your owned Ledger account name. Publishing a signed profile remains a separate, explicit action.</p>
          <label htmlFor="ledger-handle">Handle</label>
          <div className="account-handle-field">
            <span>ledger.imagineqira.com/u/</span>
            <input
              id="ledger-handle"
              value={handle}
              onChange={(event) => setHandle(event.target.value.toLowerCase())}
              pattern="[a-z0-9][a-z0-9-]{1,38}"
              minLength={2}
              maxLength={39}
              required
            />
          </div>
          <div className="wizard-actions">
            <button className="btn btn-primary" type="submit" disabled={saving || handle === account.handle}>
              {saving ? 'Saving…' : 'Save handle'}
            </button>
            {published ? <a className="btn btn-ghost" href={href({ name: 'member', handle: account.handle })}>Open public profile</a> : null}
          </div>
        </form>

        <aside className="account-next">
          <h2>{published ? 'Profile connected' : 'Publish when you choose'}</h2>
          <p>
            The Oort account owns the handle. Your signed evidence still comes from the local Ledger collector
            and never becomes public just because you signed in.
          </p>
          {!published ? <a href={href({ name: 'join' })}>Set up the local collector →</a> : <a href={href({ name: 'verify' })}>Verify your snapshot →</a>}
        </aside>
      </div>

      <div className="account-boundary" role="note">
        <strong>Ownership boundary</strong>
        <p>{account.ownershipClaim}</p>
      </div>

      <div className="account-session-actions">
        <button type="button" className="text-button" onClick={() => void signOutLedger().then(() => setState({ kind: 'signed-out' }))}>Sign out of Ledger</button>
        <button
          type="button"
          className="text-button text-button-danger"
          onClick={() => {
            if (!window.confirm('Delete the Oort-to-Ledger account link? This does not remove public snapshots or git history.')) return;
            void deleteLedgerAccount().then(() => setState({ kind: 'signed-out' }), (error: unknown) => setNotice(error instanceof Error ? error.message : 'Could not delete account.'));
          }}
        >
          Delete Ledger account link
        </button>
      </div>
    </section>
  );
}
