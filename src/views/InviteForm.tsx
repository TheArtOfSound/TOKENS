/**
 * Opportunity invitation form.
 *
 * Sellers need a clear payoff; buyers need terms. Every invitation requires
 * compensation, time, scope, organization, deadline, and data requested —
 * so token volume cannot substitute for a real offer.
 */

import { useState } from 'react';
import { publishApiBase } from '../lib/publishApi';

const TYPES = [
  { id: 'paid_evaluation', label: 'Paid model evaluation' },
  { id: 'research_study', label: 'Research study' },
  { id: 'technical_beta', label: 'Technical beta program' },
  { id: 'contract', label: 'Contract / consulting' },
  { id: 'interview', label: 'Interview request' },
  { id: 'employment', label: 'Employment conversation' },
] as const;

export function InviteForm({ handle, displayName }: { handle: string; displayName: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string } | null>(null);
  const [form, setForm] = useState({
    opportunityType: 'paid_evaluation',
    organization: '',
    contactEmail: '',
    compensation: '',
    expectedTime: '',
    scope: '',
    deadline: '',
    dataRequested: '',
    note: '',
  });

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${publishApiBase()}/v1/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ toHandle: handle, ...form }),
      });
      const json = (await res.json()) as { id?: string; error?: { message?: string } };
      if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      setDone({ id: json.id ?? 'ok' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send invitation');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        Invite {displayName.split(' ')[0] || 'to opportunity'}
      </button>
    );
  }

  if (done) {
    return (
      <div className="invite-box jcard jcard-pad" role="status">
        <h2>Invitation submitted</h2>
        <p className="muted">
          Reference <code>{done.id}</code>. Terms were required up front — this is not ranked by token volume.
        </p>
        <button type="button" className="btn btn-ghost" onClick={() => { setDone(null); setOpen(false); }}>
          Close
        </button>
      </div>
    );
  }

  return (
    <form className="invite-box jcard jcard-pad" onSubmit={(e) => void submit(e)}>
      <h2>Invite to opportunity</h2>
      <p className="jcard-sub">
        Required fields force honest terms. You cannot send an invitation that only points at activity volume.
      </p>
      {error ? <p className="join-error" role="alert">{error}</p> : null}

      <div className="rg-fields">
        <div className="rg-field rg-wide">
          <label htmlFor="inv-type">Opportunity type</label>
          <select id="inv-type" value={form.opportunityType} onChange={set('opportunityType')} required>
            {TYPES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="rg-field">
          <label htmlFor="inv-org">Organization <span>required</span></label>
          <input id="inv-org" value={form.organization} onChange={set('organization')} required maxLength={120} />
        </div>
        <div className="rg-field">
          <label htmlFor="inv-email">Your contact email <span>required</span></label>
          <input id="inv-email" type="email" value={form.contactEmail} onChange={set('contactEmail')} required />
        </div>
        <div className="rg-field">
          <label htmlFor="inv-pay">Compensation <span>required — pay/stipend, not tokens</span></label>
          <input id="inv-pay" value={form.compensation} onChange={set('compensation')} required placeholder="$150/hr or $2k fixed" maxLength={200} />
        </div>
        <div className="rg-field">
          <label htmlFor="inv-time">Expected time <span>required</span></label>
          <input id="inv-time" value={form.expectedTime} onChange={set('expectedTime')} required placeholder="4–6 hours over 1 week" maxLength={120} />
        </div>
        <div className="rg-field">
          <label htmlFor="inv-deadline">Deadline <span>required</span></label>
          <input id="inv-deadline" value={form.deadline} onChange={set('deadline')} required placeholder="2026-08-15 or ASAP" maxLength={40} />
        </div>
        <div className="rg-field rg-wide">
          <label htmlFor="inv-scope">Scope <span>required · min 20 characters</span></label>
          <textarea id="inv-scope" rows={3} value={form.scope} onChange={set('scope')} required minLength={20} maxLength={2000} />
        </div>
        <div className="rg-field rg-wide">
          <label htmlFor="inv-data">Data requested <span>required — what you need from them</span></label>
          <textarea id="inv-data" rows={2} value={form.dataRequested} onChange={set('dataRequested')} required maxLength={1000} placeholder="Signed snapshot URL, 30-min call, no raw logs" />
        </div>
        <div className="rg-field rg-wide">
          <label htmlFor="inv-note">Optional note</label>
          <textarea id="inv-note" rows={2} value={form.note} onChange={set('note')} maxLength={500} />
        </div>
      </div>

      <div className="wizard-actions">
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send invitation'}</button>
      </div>
    </form>
  );
}
