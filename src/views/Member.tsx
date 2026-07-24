/**
 * A single member's public profile at #/u/<handle>.
 *
 * The member's snapshot is fetched from the URL THEY host and verified in the
 * visitor's browser before anything is presented as measured. If the signature
 * fails, the profile still renders — but the failure is shown prominently rather
 * than hidden, because silently displaying unverified numbers as verified is the
 * exact failure this project exists to avoid.
 */

import { useEffect, useState } from 'react';
import { loadRegistry, type RegistryMember, type SignatureState } from '../lib/registry';
import { verifySnapshotInBrowser } from '../lib/verify';
import { PublicUsageSnapshot } from '../lib/usage';
import { ProfileView } from './ProfileView';
import { SignatureBadge } from './Directory';
import { href } from '../lib/router';

interface State {
  status: 'loading' | 'ready' | 'missing' | 'error';
  member?: RegistryMember;
  snapshot?: PublicUsageSnapshot;
  signature: SignatureState;
  reason?: string;
  keyId?: string;
  message?: string;
}

export function Member({ handle }: { handle: string }) {
  const [state, setState] = useState<State>({ status: 'loading', signature: 'checking' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', signature: 'checking' });

    (async () => {
      try {
        const registry = await loadRegistry();
        const member = registry.members.find((m) => m.handle === handle);
        if (!member) {
          if (!cancelled) setState({ status: 'missing', signature: 'unreachable' });
          return;
        }

        const url = member.snapshotUrl.startsWith('/')
          ? `${import.meta.env.BASE_URL.replace(/\/$/, '')}${member.snapshotUrl}`
          : member.snapshotUrl;
        const response = await fetch(url, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`snapshot HTTP ${response.status}`);
        const snapshot = (await response.json()) as PublicUsageSnapshot;

        const outcome = await verifySnapshotInBrowser(snapshot as unknown as Record<string, unknown>);
        if (cancelled) return;
        setState({
          status: 'ready',
          member,
          snapshot,
          signature: outcome.state,
          reason: outcome.reason,
          keyId: outcome.keyId,
        });
      } catch (error) {
        if (!cancelled) {
          setState({
            status: 'error',
            signature: 'unreachable',
            message: error instanceof Error ? error.message : 'could not load profile',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [handle]);

  if (state.status === 'loading') {
    return (
      <section className="panel wide-panel">
        <p className="muted">Loading profile and verifying signature…</p>
      </section>
    );
  }

  if (state.status === 'missing') {
    return (
      <section className="panel wide-panel">
        <h2>No such profile</h2>
        <p className="muted">
          Nobody with the handle <code>{handle}</code> is in the directory.
        </p>
        <p>
          <a href={href({ name: 'directory' })}>Browse people</a> · <a href={href({ name: 'join' })}>Add your profile</a>
        </p>
      </section>
    );
  }

  if (state.status === 'error' || !state.snapshot || !state.member) {
    return (
      <section className="panel wide-panel">
        <h2>Profile unavailable</h2>
        <p className="muted">
          This member's snapshot could not be fetched ({state.message}). They host their own data, so it may be
          temporarily offline.
        </p>
        <p>
          <a href={href({ name: 'directory' })}>Back to people</a>
        </p>
      </section>
    );
  }

  const profile = state.snapshot.profile;
  const failed = state.signature === 'invalid';

  return (
    <>
      <div className={`member-banner ${failed ? 'member-banner-bad' : ''}`}>
        <div>
          <a href={href({ name: 'directory' })}>← People</a>
        </div>
        <SignatureBadge state={state.signature} reason={state.reason} />
      </div>

      {failed && (
        <section className="panel wide-panel alert" role="alert">
          <h2>This snapshot did not verify</h2>
          <p>{state.reason}</p>
          <p className="muted">
            The figures below are shown for transparency but must not be treated as measured. A snapshot that
            fails verification may have been altered after it was signed.
          </p>
        </section>
      )}

      {state.signature === 'unsigned' && (
        <section className="panel wide-panel">
          <p className="muted">
            {state.reason} Numbers below are unverified — treat them as self-reported.
          </p>
        </section>
      )}

      {profile ? (
        <ProfileView profile={profile} daily={state.snapshot.daily} integrity={state.snapshot.integrity} />
      ) : (
        <section className="panel wide-panel">
          <h2>{state.member.displayName}</h2>
          <p className="muted">This member's snapshot has no profile block yet.</p>
        </section>
      )}

      <section className="panel wide-panel">
        <h2>Provenance</h2>
        <div className="kv">
          <div>
            <span>Snapshot source</span>
            <strong>
              <a href={state.member.snapshotUrl} target="_blank" rel="noreferrer">
                self-hosted by member
              </a>
            </strong>
          </div>
          <div>
            <span>Generated</span>
            <strong>{state.snapshot.generatedAt?.slice(0, 19).replace('T', ' ')} UTC</strong>
          </div>
          <div>
            <span>Signing key</span>
            <strong>{state.keyId ?? '—'}</strong>
          </div>
          <div>
            <span>Measured by</span>
            <strong>{(state.snapshot as { sourceOfTruth?: string }).sourceOfTruth ?? 'unknown'}</strong>
          </div>
        </div>
        <p className="muted">
          Verified in your browser — this site did not vouch for it. A valid signature proves the snapshot came
          from that device key unaltered. It does not prove the person's identity, and it cannot prove their
          provider logs were genuine. <a href={href({ name: 'verify' })}>How verification works</a>
        </p>
      </section>
    </>
  );
}
