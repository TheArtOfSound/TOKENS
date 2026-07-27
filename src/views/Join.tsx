/**
 * Guided onboarding + publication wizard.
 *
 * Target flow:
 *   Welcome → sources → scan → profile → public fields → preview → publish → success
 *
 * Collection stays local. Publication requires an explicit Publish click.
 * Installing or scanning never makes a profile public.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { href } from '../lib/router';
import {
  clientPrivacyScan,
  getAnalyticsConsent,
  getSessionToken,
  keepPrivate,
  publishLedger,
  registerSelfHosted,
  requestMagicLink,
  setAnalyticsConsent,
  trackAnalytics,
  unpublish,
  verifyMagicLink,
  type PublishResult,
} from '../lib/publishApi';
import { RegistryEntry } from './RegistryEntry';

type StepId =
  | 'welcome'
  | 'sources'
  | 'scan'
  | 'profile'
  | 'fields'
  | 'preview'
  | 'publish'
  | 'success';

type SourceKey = 'claude' | 'codex';
type PublishChoice = 'ledger' | 'self' | 'private';
type ProfileState =
  | 'local_only'
  | 'draft'
  | 'ready_to_publish'
  | 'published'
  | 'unpublished';

interface SourceInfo {
  key: SourceKey;
  name: string;
  directories: string[];
  extracts: string[];
  discards: string[];
  evidenceClass: string;
  networkAccess: string;
  fileTypes: string;
}

const SOURCES: SourceInfo[] = [
  {
    key: 'claude',
    name: 'Claude Code',
    directories: ['~/.claude/projects/**/*.jsonl'],
    fileTypes: 'JSONL session logs',
    extracts: ['timestamp', 'model name', 'token counts', 'HMAC of session id (not the id)'],
    discards: ['prompt text', 'response text', 'cwd / absolute paths', 'raw session ids'],
    evidenceClass: 'provider_reported',
    networkAccess: 'none for scan (offline pricing table)',
  },
  {
    key: 'codex',
    name: 'Codex',
    directories: ['~/.codex/sessions/**/*.jsonl'],
    fileTypes: 'JSONL session logs',
    extracts: ['timestamp', 'model name', 'token counts', 'HMAC of session id (not the id)'],
    discards: ['prompt text', 'response text', 'cwd / absolute paths', 'raw session ids'],
    evidenceClass: 'provider_reported',
    networkAccess: 'none for scan (offline pricing table)',
  },
];

const STEPS: { id: StepId; label: string; short: string }[] = [
  { id: 'welcome', label: 'Welcome', short: 'What this is' },
  { id: 'sources', label: 'Sources', short: 'Opt-in tools' },
  { id: 'scan', label: 'Scan', short: 'Local only' },
  { id: 'profile', label: 'Profile', short: 'Who you are' },
  { id: 'fields', label: 'Fields', short: 'What goes public' },
  { id: 'preview', label: 'Preview', short: 'Exact payload' },
  { id: 'publish', label: 'Publish', short: 'Your choice' },
  { id: 'success', label: 'Done', short: 'Live link' },
];

const OPTIONAL_FIELDS: { key: string; label: string; detail: string }[] = [
  { key: 'location', label: 'City-level location', detail: 'Self-submitted' },
  { key: 'bio', label: 'Bio', detail: 'Self-submitted' },
  { key: 'availability', label: 'Availability', detail: 'Self-submitted' },
  { key: 'workCategories', label: 'Work categories', detail: 'Self-submitted' },
  { key: 'links', label: 'Public links', detail: 'Self-submitted' },
  { key: 'compensation', label: 'Compensation preference', detail: 'Self-submitted' },
  { key: 'workArrangement', label: 'Remote / hybrid / onsite', detail: 'Self-submitted' },
  { key: 'estimatedCost', label: 'Estimated cost totals', detail: 'Collector-derived estimate' },
  { key: 'models', label: 'Model names', detail: 'Provider-reported' },
  { key: 'daily', label: 'Daily activity series', detail: 'Provider-reported' },
  { key: 'projects', label: 'Project summaries', detail: 'Collector-observed (allowlisted)' },
];

interface ProfileForm {
  displayName: string;
  handle: string;
  headline: string;
  location: string;
  bio: string;
  availability: string;
  workCategories: string;
  tools: string;
  openTo: string;
  linkLabel: string;
  linkUrl: string;
  compensation: string;
  workArrangement: string;
}

const EMPTY_PROFILE: ProfileForm = {
  displayName: '',
  handle: '',
  headline: '',
  location: '',
  bio: '',
  availability: '',
  workCategories: '',
  tools: 'Claude Code, Codex',
  openTo: '',
  linkLabel: '',
  linkUrl: '',
  compensation: '',
  workArrangement: '',
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

function StatePill({ state }: { state: ProfileState }) {
  return (
    <span className={`pub-state pub-state-${state}`} title="Publication state — never auto-public">
      {state.replace(/_/g, ' ')}
    </span>
  );
}

function buildPreviewPayload(
  profile: ProfileForm,
  enabled: Record<string, boolean>,
  sources: Record<SourceKey, boolean>,
  snapshot: Record<string, unknown> | null,
): Record<string, unknown> {
  if (snapshot) {
    // Prefer the real signed snapshot; strip disabled optional identity fields for display.
    const clone = structuredClone(snapshot) as Record<string, unknown>;
    const prof = (clone.profile ?? {}) as Record<string, unknown>;
    const identity = { ...((prof.identity ?? {}) as Record<string, unknown>) };
    if (!enabled.location) delete identity.location;
    if (!enabled.bio) delete identity.bio;
    if (!enabled.availability) delete identity.availability;
    if (!enabled.workCategories) identity.workCategories = [];
    if (!enabled.links) identity.links = [];
    prof.identity = identity;
    if (!enabled.compensation || !enabled.workArrangement) {
      const opportunity = { ...((prof.opportunity ?? {}) as Record<string, unknown>) };
      if (!enabled.compensation) opportunity.compensation = null;
      if (!enabled.workArrangement) opportunity.workArrangement = null;
      prof.opportunity = opportunity;
    }
    clone.profile = prof;
    return clone;
  }

  // Draft preview when no signed snapshot has been loaded yet.
  const links =
    enabled.links && profile.linkLabel && profile.linkUrl
      ? [{ label: profile.linkLabel, url: profile.linkUrl }]
      : [];
  return {
    _draft: true,
    note: 'Draft preview — load a signed snapshot from the collector before publishing through Ledger.',
    sourcesEnabled: Object.entries(sources)
      .filter(([, on]) => on)
      .map(([k]) => k),
    profile: {
      identity: {
        displayName: profile.displayName || 'Anonymous',
        headline: profile.headline || '',
        ...(enabled.location && profile.location ? { location: profile.location } : {}),
        ...(enabled.bio && profile.bio ? { bio: profile.bio } : {}),
        ...(enabled.availability && profile.availability ? { availability: profile.availability } : {}),
        ...(enabled.workCategories
          ? {
              workCategories: profile.workCategories
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            }
          : {}),
        tools: profile.tools
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        openTo: profile.openTo
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        ...(links.length ? { links } : {}),
      },
      opportunity: {
        ...(enabled.compensation && profile.compensation ? { compensation: profile.compensation } : {}),
        ...(enabled.workArrangement && profile.workArrangement
          ? { workArrangement: profile.workArrangement }
          : {}),
      },
      fieldEvidence: {
        displayName: 'self_submitted',
        headline: 'self_submitted',
        activity: 'collector_observed (after local scan)',
        identity: 'unverified',
      },
    },
    privacy: {
      rawContentPersisted: false,
      allowlistPublication: true,
      promptsLeaveMachine: false,
      responsesLeaveMachine: false,
      sourceCodeLeavesMachine: false,
      privateKeysLeaveMachine: false,
    },
  };
}

export function Join() {
  const [step, setStep] = useState<StepId>('welcome');
  const [profileState, setProfileState] = useState<ProfileState>('local_only');
  const [sources, setSources] = useState<Record<SourceKey, boolean>>({ claude: true, codex: true });
  const [profile, setProfile] = useState<ProfileForm>(EMPTY_PROFILE);
  const [enabledFields, setEnabledFields] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(OPTIONAL_FIELDS.map((f) => [f.key, true])),
  );
  const [snapshot, setSnapshot] = useState<Record<string, unknown> | null>(null);
  const [snapshotName, setSnapshotName] = useState<string | null>(null);
  const [scanMeta, setScanMeta] = useState<{
    loaded: boolean;
    eventsHint: string;
    warnings: string[];
  }>({ loaded: false, eventsHint: 'Not scanned yet', warnings: [] });
  const [choice, setChoice] = useState<PublishChoice>('ledger');
  const [selfHostUrl, setSelfHostUrl] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [authedEmail, setAuthedEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [analyticsOn, setAnalyticsOn] = useState(() => getAnalyticsConsent());
  const [jsonCopied, setJsonCopied] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    void trackAnalytics('onboarding_opened');
    if (getSessionToken()) {
      // Session may still be valid; surface as signed-in without calling API yet.
      setAuthedEmail('(signed in)');
    }
  }, []);

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  const preview = useMemo(
    () => buildPreviewPayload(profile, enabledFields, sources, snapshot),
    [profile, enabledFields, sources, snapshot],
  );
  const privacy = useMemo(() => clientPrivacyScan(preview), [preview]);
  const previewJson = useMemo(() => JSON.stringify(preview, null, 2), [preview]);

  const canPublishLedger = Boolean(snapshot && privacy.ok && profile.handle && profile.displayName && profile.headline);
  const signatureInfo = snapshot?.signature as
    | { keyId?: string; algorithm?: string; proves?: string; doesNotProve?: string[] }
    | undefined;

  const go = useCallback((id: StepId) => {
    setError(null);
    setStep(id);
    if (id === 'preview') void trackAnalytics('preview_reached');
  }, []);

  const onFile = async (file: File | null) => {
    setError(null);
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text) as Record<string, unknown>;
      if (!json || typeof json !== 'object') throw new Error('Invalid JSON');
      if (!json.signature) {
        setError('This file is not signed. Run `npm run collect` on your machine first.');
        return;
      }
      setSnapshot(json);
      setSnapshotName(file.name);
      setScanMeta({
        loaded: true,
        eventsHint: 'Signed snapshot loaded from your machine',
        warnings: Array.isArray(json.warnings) ? (json.warnings as string[]).slice(0, 6) : [],
      });
      setProfileState('ready_to_publish');
      void trackAnalytics('scan_completed');
      // Prefill profile from snapshot when empty.
      const identity = ((json.profile as Record<string, unknown> | undefined)?.identity ?? {}) as Record<
        string,
        unknown
      >;
      setProfile((p) => ({
        ...p,
        displayName: p.displayName || String(identity.displayName ?? ''),
        headline: p.headline || String(identity.headline ?? ''),
        location: p.location || String(identity.location ?? ''),
        bio: p.bio || String(identity.bio ?? ''),
        availability: p.availability || String(identity.availability ?? ''),
        workCategories:
          p.workCategories ||
          (Array.isArray(identity.workCategories) ? identity.workCategories.join(', ') : ''),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read snapshot file');
    }
  };

  const requestCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await requestMagicLink(email.trim());
      setDevCode(res.devCode ?? null);
      if (res.devCode) setCode(res.devCode);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send login code');
    } finally {
      setBusy(false);
    }
  };

  const confirmCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await verifyMagicLink(email.trim(), code.trim());
      setAuthedEmail(res.account.email);
      setDevCode(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  };

  const doPublish = async () => {
    setBusy(true);
    setError(null);
    void trackAnalytics('publish_clicked');
    try {
      if (choice === 'private') {
        const res = await keepPrivate(profile.handle || undefined);
        setResult(res);
        setProfileState('local_only');
        go('success');
        return;
      }

      if (!authedEmail && !getSessionToken()) {
        setError('Sign in with a magic link before publishing. Login controls publication — it does not verify your identity.');
        setBusy(false);
        return;
      }

      if (choice === 'self') {
        const res = await registerSelfHosted({
          handle: profile.handle.trim().toLowerCase(),
          snapshotUrl: selfHostUrl.trim(),
          displayName: profile.displayName.trim(),
          headline: profile.headline.trim(),
          location: enabledFields.location ? profile.location || null : null,
          workCategories: enabledFields.workCategories
            ? profile.workCategories
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
          links:
            enabledFields.links && profile.linkLabel && profile.linkUrl
              ? [{ label: profile.linkLabel, url: profile.linkUrl }]
              : [],
          publicationConsent: true,
        });
        setResult(res);
        setProfileState('published');
        void trackAnalytics('publish_succeeded');
        go('success');
        return;
      }

      // Ledger hosted
      if (!snapshot) {
        setError('Load a signed snapshot from your local collector before publishing through Ledger.');
        setBusy(false);
        return;
      }
      if (!privacy.ok) {
        setError(`Publication blocked: ${privacy.findings.join(', ')}`);
        setBusy(false);
        return;
      }
      const res = await publishLedger({
        handle: profile.handle.trim().toLowerCase(),
        snapshot,
        publicationConsent: true,
      });
      setResult(res);
      setProfileState('published');
      void trackAnalytics('publish_succeeded');
      go('success');
    } catch (e) {
      const err = e as Error & { code?: string };
      setError(err.message || 'Publish failed');
      void trackAnalytics('error_category', err.code ?? 'publish');
    } finally {
      setBusy(false);
    }
  };

  const doUnpublish = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await unpublish();
      setResult(res);
      setProfileState('unpublished');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unpublish failed');
    } finally {
      setBusy(false);
    }
  };

  const copyPayload = () => {
    navigator.clipboard?.writeText(previewJson).then(
      () => {
        setJsonCopied(true);
        window.setTimeout(() => setJsonCopied(false), 1600);
      },
      () => setJsonCopied(false),
    );
  };

  const downloadPayload = () => {
    const blob = new Blob([previewJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${profile.handle || 'tokens'}-preview.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="join join-wizard" id="join">
      <header className="join-head">
        <div className="join-head-row">
          <p className="join-time">Guided onboarding · explicit publish only</p>
          <StatePill state={profileState} />
        </div>
        <h1>Join the Ledger</h1>
        <p className="lede">
          Measure supported AI-tool activity on your machine, build a professional profile, preview the exact
          public payload, then press <strong>Publish</strong> if — and only if — you want to appear in the
          People directory. Nothing becomes public because you installed or scanned.
        </p>
      </header>

      <nav className="join-progress join-progress-8" aria-label="Onboarding steps">
        {STEPS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className={`join-progress-item ${step === s.id ? 'is-current' : ''} ${i < stepIndex ? 'is-done' : ''}`}
            onClick={() => go(s.id)}
            aria-current={step === s.id ? 'step' : undefined}
          >
            <span className="join-progress-num">{i + 1}</span>
            <span className="join-progress-label">
              <strong>{s.label}</strong>
              <small>{s.short}</small>
            </span>
          </button>
        ))}
      </nav>

      {error ? (
        <div className="join-error" role="alert">
          {error}
        </div>
      ) : null}

      {/* ---------- STEP: welcome ---------- */}
      {step === 'welcome' ? (
        <div className="jcard jcard-pad wizard-step">
          <h2>Welcome</h2>
          <ul className="wizard-points">
            <li>
              <strong>Local-first.</strong> TOKENS measures Claude Code and Codex activity on your computer.
            </li>
            <li>
              <strong>Nothing is automatic.</strong> Install, scan, and draft stay private until you press
              Publish.
            </li>
            <li>
              <strong>You control the payload.</strong> You will see the exact JSON before anything is sent.
            </li>
            <li>
              <strong>Activity is not a skill score.</strong> Token volume is not expertise, rank, or pay.
            </li>
          </ul>
          <div className="wizard-analytics">
            <label className="check-row">
              <input
                type="checkbox"
                checked={analyticsOn}
                onChange={(e) => {
                  setAnalyticsOn(e.target.checked);
                  setAnalyticsConsent(e.target.checked);
                }}
              />
              <span>
                Optional anonymous product analytics (install/onboarding events only — never prompts, code,
                paths, or account totals). Separate from profile publication. Default is off.
              </span>
            </label>
          </div>
          <div className="wizard-actions">
            <button type="button" className="btn btn-primary" onClick={() => go('sources')}>
              Continue
            </button>
          </div>
        </div>
      ) : null}

      {/* ---------- STEP: sources ---------- */}
      {step === 'sources' ? (
        <div className="jcard jcard-pad wizard-step">
          <h2>Choose data sources</h2>
          <p className="jcard-sub">Every source is opt-in. Disabled sources are never read.</p>
          <div className="source-grid">
            {SOURCES.map((src) => (
              <article key={src.key} className={`source-card ${sources[src.key] ? 'is-on' : ''}`}>
                <label className="check-row source-toggle">
                  <input
                    type="checkbox"
                    checked={sources[src.key]}
                    onChange={(e) => {
                      setSources((s) => ({ ...s, [src.key]: e.target.checked }));
                      void trackAnalytics('source_detected', src.key);
                    }}
                  />
                  <strong>{src.name}</strong>
                </label>
                <dl className="source-dl">
                  <div>
                    <dt>Would read</dt>
                    <dd>
                      {src.directories.map((d) => (
                        <code key={d}>{d}</code>
                      ))}
                    </dd>
                  </div>
                  <div>
                    <dt>File types</dt>
                    <dd>{src.fileTypes}</dd>
                  </div>
                  <div>
                    <dt>Extracts</dt>
                    <dd>{src.extracts.join(' · ')}</dd>
                  </div>
                  <div>
                    <dt>Discards</dt>
                    <dd>{src.discards.join(' · ')}</dd>
                  </div>
                  <div>
                    <dt>Network</dt>
                    <dd>{src.networkAccess}</dd>
                  </div>
                  <div>
                    <dt>Evidence class</dt>
                    <dd>
                      <span className="evidence-chip evidence-provider_reported">{src.evidenceClass}</span>
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
          <div className="wizard-actions">
            <button type="button" className="btn btn-ghost" onClick={() => go('welcome')}>
              Back
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!sources.claude && !sources.codex}
              onClick={() => go('scan')}
            >
              Continue
            </button>
          </div>
        </div>
      ) : null}

      {/* ---------- STEP: scan ---------- */}
      {step === 'scan' ? (
        <div className="jcard jcard-pad wizard-step">
          <h2>Run the local scan</h2>
          <p className="jcard-sub">
            The browser cannot read your provider logs. Run the collector on your machine, then load the signed
            snapshot here. Raw prompts are never displayed.
          </p>
          <ol className="wizard-steps-list">
            <li>
              Install (once):
              <Command>curl -fsSL https://ledger.imagineqira.com/install.sh | bash</Command>
            </li>
            <li>
              Consent + measure + sign:
              <Command>cd ~/TOKENS && npm run consent && npm run ingest && npm run collect</Command>
            </li>
            <li>
              Load <code>public/data/latest.json</code> below — or publish from the CLI with{' '}
              <code>npm run publish:ledger</code>.
            </li>
          </ol>

          <label className="file-drop">
            <span>{snapshotName ? `Loaded: ${snapshotName}` : 'Drop or choose your signed latest.json'}</span>
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
            />
          </label>

          <div className="scan-stats">
            <div>
              <strong>{scanMeta.loaded ? 'Ready' : 'Waiting'}</strong>
              <span>Snapshot</span>
            </div>
            <div>
              <strong>{scanMeta.eventsHint}</strong>
              <span>Status</span>
            </div>
            <div>
              <strong>{signatureInfo?.keyId ?? '—'}</strong>
              <span>Device key id</span>
            </div>
            <div>
              <strong>{scanMeta.warnings.length}</strong>
              <span>Warnings</span>
            </div>
          </div>
          {scanMeta.warnings.length ? (
            <ul className="muted">
              {scanMeta.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}

          <details className="advanced">
            <summary>Advanced: install from source</summary>
            <Command>git clone https://github.com/TheArtOfSound/TOKENS.git && cd TOKENS && npm ci</Command>
          </details>

          <div className="wizard-actions">
            <button type="button" className="btn btn-ghost" onClick={() => go('sources')}>
              Back
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => go('profile')}>
              Continue without snapshot
            </button>
            <button type="button" className="btn btn-primary" onClick={() => go('profile')}>
              Continue
            </button>
          </div>
        </div>
      ) : null}

      {/* ---------- STEP: profile ---------- */}
      {step === 'profile' ? (
        <div className="jcard jcard-pad wizard-step">
          <h2>Build your profile</h2>
          <p className="jcard-sub">
            All fields below are <strong>self-submitted</strong> unless noted. Login later proves account
            control, not legal identity.
          </p>
          <div className="rg-fields">
            {(
              [
                ['displayName', 'Display name', 'A pseudonym is fine'],
                ['handle', 'Handle', 'Profile URL: /u/handle'],
                ['headline', 'Headline', 'What you do'],
                ['location', 'Location', 'City-level only'],
                ['bio', 'Bio', 'Short public bio'],
                ['availability', 'Availability', 'What you are open to'],
                ['workCategories', 'Work categories', 'Comma-separated'],
                ['tools', 'Tools', 'Comma-separated'],
                ['openTo', 'Opportunity types', 'Comma-separated'],
                ['compensation', 'Compensation preference', 'Self-submitted'],
                ['workArrangement', 'Remote / hybrid / onsite', 'Self-submitted'],
                ['linkLabel', 'Link label', 'Optional'],
                ['linkUrl', 'Link URL', 'https only'],
              ] as const
            ).map(([key, label, hint]) => (
              <div className={`rg-field ${key === 'bio' || key === 'headline' ? 'rg-wide' : ''}`} key={key}>
                <label htmlFor={`pf-${key}`}>
                  {label} <span>{hint} · self-submitted</span>
                </label>
                {key === 'bio' ? (
                  <textarea
                    id={`pf-${key}`}
                    rows={3}
                    value={profile[key]}
                    onChange={(e) => {
                      setProfile((p) => ({ ...p, [key]: e.target.value }));
                      setProfileState((s) => (s === 'published' ? s : 'draft'));
                    }}
                  />
                ) : (
                  <input
                    id={`pf-${key}`}
                    value={profile[key]}
                    onChange={(e) => {
                      const v = key === 'handle' ? e.target.value.toLowerCase() : e.target.value;
                      setProfile((p) => ({ ...p, [key]: v }));
                      setProfileState((s) => (s === 'published' ? s : 'draft'));
                    }}
                    autoComplete="off"
                  />
                )}
              </div>
            ))}
          </div>
          <div className="wizard-actions">
            <button type="button" className="btn btn-ghost" onClick={() => go('scan')}>
              Back
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!profile.displayName.trim() || !profile.handle.trim() || !profile.headline.trim()}
              onClick={() => go('fields')}
            >
              Continue
            </button>
          </div>
        </div>
      ) : null}

      {/* ---------- STEP: fields ---------- */}
      {step === 'fields' ? (
        <div className="jcard jcard-pad wizard-step">
          <h2>Select public fields</h2>
          <p className="jcard-sub">
            Disabled fields are <strong>omitted</strong> from the payload — not blanked or set to zero.
          </p>
          <ul className="field-toggles">
            {OPTIONAL_FIELDS.map((f) => (
              <li key={f.key}>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={enabledFields[f.key] !== false}
                    onChange={(e) => setEnabledFields((m) => ({ ...m, [f.key]: e.target.checked }))}
                  />
                  <span>
                    <strong>{f.label}</strong>
                    <small>{f.detail}</small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="wizard-actions">
            <button type="button" className="btn btn-ghost" onClick={() => go('profile')}>
              Back
            </button>
            <button type="button" className="btn btn-primary" onClick={() => go('preview')}>
              Preview payload
            </button>
          </div>
        </div>
      ) : null}

      {/* ---------- STEP: preview ---------- */}
      {step === 'preview' ? (
        <div className="jcard jcard-pad wizard-step">
          <h2>Preview public data</h2>
          <p className="jcard-sub">
            This is the exact payload shape that would be published. A valid signature proves integrity of the
            bytes — not that local source data was honest, and not your legal identity.
          </p>

          <div className="preview-human">
            <h3>{profile.displayName || 'Anonymous'}</h3>
            <p>@{profile.handle || 'handle'}</p>
            <p>{profile.headline}</p>
            {enabledFields.location && profile.location ? <p className="muted">{profile.location}</p> : null}
            {enabledFields.bio && profile.bio ? <p>{profile.bio}</p> : null}
            <p className="evidence-tags">
              <span className="evidence-chip evidence-user_submitted">identity: self-submitted</span>
              <span className="evidence-chip evidence-provider_reported">work activity: collector-observed after scan</span>
              <span className="evidence-chip evidence-user_submitted">login ≠ identity verified</span>
            </p>
          </div>

          <div className="privacy-scan" data-ok={privacy.ok}>
            <strong>Privacy scan:</strong>{' '}
            {privacy.ok ? 'No forbidden patterns detected in preview.' : `Blocked: ${privacy.findings.join(', ')}`}
          </div>

          {signatureInfo ? (
            <div className="sig-box">
              <strong>Signature</strong>
              <p>
                {signatureInfo.algorithm} · key {signatureInfo.keyId}
              </p>
              <p className="muted">{signatureInfo.proves}</p>
              {signatureInfo.doesNotProve?.length ? (
                <ul className="muted">
                  {signatureInfo.doesNotProve.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <p className="muted">
              No signature loaded yet. Ledger publishing requires a signed snapshot from{' '}
              <code>npm run collect</code>.
            </p>
          )}

          <div className="preview-toolbar">
            <button type="button" className="btn btn-ghost" onClick={() => setShowRaw((v) => !v)}>
              {showRaw ? 'Hide JSON' : 'Show raw JSON'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={copyPayload}>
              {jsonCopied ? 'Copied' : 'Copy payload'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={downloadPayload}>
              Download payload
            </button>
          </div>
          {showRaw ? <pre className="payload-pre">{previewJson}</pre> : null}

          <div className="wizard-actions">
            <button type="button" className="btn btn-ghost" onClick={() => go('fields')}>
              Back
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!privacy.ok}
              onClick={() => {
                setProfileState((s) => (s === 'published' ? s : 'ready_to_publish'));
                go('publish');
              }}
            >
              Continue to publish
            </button>
          </div>
        </div>
      ) : null}

      {/* ---------- STEP: publish ---------- */}
      {step === 'publish' ? (
        <div className="jcard jcard-pad wizard-step">
          <h2>Publish</h2>
          <p className="jcard-sub">
            Choose how this profile should exist. Private mode is a complete product state — not an error.
          </p>

          <div className="publish-choices" role="radiogroup" aria-label="Publication option">
            {(
              [
                {
                  id: 'ledger' as const,
                  title: 'Publish through Ledger',
                  body: 'Recommended. Upload the signed snapshot; appear in the People directory. No GitHub PR, no static hosting setup.',
                },
                {
                  id: 'self' as const,
                  title: 'Self-host',
                  body: 'Host your own signed snapshot and register its HTTPS URL. Advanced privacy / decentralization route.',
                },
                {
                  id: 'private' as const,
                  title: 'Keep private',
                  body: 'Local analytics only. Nothing is listed publicly.',
                },
              ] as const
            ).map((opt) => (
              <label key={opt.id} className={`publish-choice ${choice === opt.id ? 'is-selected' : ''}`}>
                <input
                  type="radio"
                  name="pub-choice"
                  checked={choice === opt.id}
                  onChange={() => setChoice(opt.id)}
                />
                <span>
                  <strong>{opt.title}</strong>
                  <small>{opt.body}</small>
                </span>
              </label>
            ))}
          </div>

          {choice === 'self' ? (
            <div className="rg-field rg-wide" style={{ marginTop: 16 }}>
              <label htmlFor="self-url">Self-hosted snapshot URL</label>
              <input
                id="self-url"
                type="url"
                placeholder="https://you.example.com/data/latest.json"
                value={selfHostUrl}
                onChange={(e) => setSelfHostUrl(e.target.value)}
              />
            </div>
          ) : null}

          {choice !== 'private' ? (
            <div className="auth-box">
              <h3>Account (publication control only)</h3>
              <p className="muted">
                Magic-link login proves control of an email account. It does <strong>not</strong> verify legal
                identity or professional expertise. GitHub is not required.
              </p>
              {authedEmail ? (
                <p>
                  Signed in as <strong>{authedEmail}</strong>
                </p>
              ) : (
                <div className="auth-row">
                  <input
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                  <button type="button" className="btn btn-secondary" disabled={busy || !email} onClick={() => void requestCode()}>
                    Email code
                  </button>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="6-digit code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    autoComplete="one-time-code"
                  />
                  <button type="button" className="btn btn-secondary" disabled={busy || !code} onClick={() => void confirmCode()}>
                    Verify
                  </button>
                </div>
              )}
              {devCode ? <p className="muted">Dev code (local only): {devCode}</p> : null}
            </div>
          ) : null}

          {choice === 'ledger' && !snapshot ? (
            <p className="muted">
              Load a signed snapshot in the Scan step, or from the CLI:{' '}
              <code>npm run publish:ledger -- --handle {profile.handle || 'you'} --email you@example.com</code>
            </p>
          ) : null}

          <div className="wizard-actions">
            <button type="button" className="btn btn-ghost" onClick={() => go('preview')}>
              Back
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                busy ||
                (choice === 'ledger' && !canPublishLedger) ||
                (choice === 'self' && !selfHostUrl.trim())
              }
              onClick={() => void doPublish()}
            >
              {busy ? 'Working…' : choice === 'private' ? 'Stay private' : 'Publish'}
            </button>
          </div>

          <details className="advanced" style={{ marginTop: 20 }}>
            <summary>Legacy path: generate a GitHub registry PR entry</summary>
            <RegistryEntry />
          </details>
        </div>
      ) : null}

      {/* ---------- STEP: success ---------- */}
      {step === 'success' ? (
        <div className="jcard jcard-pad wizard-step">
          <h2>{profileState === 'local_only' ? 'Private mode active' : profileState === 'unpublished' ? 'Unpublished' : 'You are on the Ledger'}</h2>
          {result?.profileUrl ? (
            <>
              <p>
                Public profile:{' '}
                <a href={result.profileUrl} target="_blank" rel="noopener noreferrer">
                  {result.profileUrl}
                </a>
              </p>
              <p className="muted">Snapshot: {result.snapshotUrl}</p>
              <p className="muted">Last published: {result.publishedAt ?? '—'}</p>
            </>
          ) : (
            <p className="muted">{result?.message ?? 'Nothing was published.'}</p>
          )}
          {result?.notes ? (
            <ul className="wizard-points">
              {Object.values(result.notes).map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
          <div className="wizard-actions">
            {result?.profileUrl ? (
              <>
                <a className="btn btn-primary" href={result.profileUrl}>
                  Open profile
                </a>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    void navigator.clipboard?.writeText(result.profileUrl);
                  }}
                >
                  Copy link
                </button>
                <a className="btn btn-ghost" href={href({ name: 'directory' })}>
                  People directory
                </a>
              </>
            ) : (
              <a className="btn btn-primary" href={href({ name: 'home' })}>
                Back home
              </a>
            )}
            {profileState === 'published' ? (
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void doUnpublish()}>
                Unpublish
              </button>
            ) : null}
            <button type="button" className="btn btn-ghost" onClick={() => go('profile')}>
              Update profile
            </button>
          </div>
          <StatePill state={profileState} />
        </div>
      ) : null}

      <section className="join-honest">
        <h2>What this does and does not claim</h2>
        <ul>
          <li>
            <strong>Publication is always explicit.</strong> Scan ≠ publish. Login ≠ identity verified.
          </li>
          <li>
            <strong>A signature proves integrity, not honesty of source logs.</strong> Anyone controlling a
            machine could feed fabricated provider logs.
          </li>
          <li>
            <strong>Volume is not skill.</strong> No ranking by token count.
          </li>
          <li>
            <strong>Revocable.</strong> Unpublish removes you from public search; export/delete local data via
            collector commands.
          </li>
        </ul>
        <p>
          <a href={href({ name: 'verify' })}>How verification works →</a>
          {' · '}
          <a href={href({ name: 'privacy' })}>Privacy</a>
        </p>
      </section>
    </section>
  );
}
