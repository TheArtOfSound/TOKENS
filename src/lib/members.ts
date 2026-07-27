/**
 * Shared member loader.
 *
 * Fetches the registry, then each member's self-hosted snapshot, verifies the
 * signature in-browser, and extracts the buyer-relevant fields. Used by the
 * employer surface. Everything here is read from signed snapshots — nothing is
 * taken on the registry's word.
 */

import { useEffect, useState } from 'react';
import { loadRegistry, type RegistryMember, type SignatureState } from './registry';
import { verifySnapshotInBrowser } from './verify';

export interface MemberProfile {
  member: RegistryMember;
  signature: SignatureState;
  signatureReason?: string;
  generatedAt?: string;
  // measured / derived
  activeDays: number;
  activeDaysLast30: number;
  totalTokens: number;
  toolsUsed: string[];
  modelsUsed: string[];
  projectsActive: number;
  collectorObserved: number;
  lastActiveDate: string | null;
  cachedSharePct: number | null;
  // self-declared
  workCategories: string[];
  openTo: string[];
  engagementTypes: string[];
  compensation: string | null;
  workArrangement: string | null;
  timezone: string | null;
  contact: { label: string; href: string } | null;
  /** Self-declared external accounts; verified live on the profile page. */
  identityProofs: { type: string; handle: string }[];
  /** Present claim-authority signals from the signed snapshot (when published). */
  claimSignals: {
    signalType: string;
    badgeLabel: string;
    tier: string;
    present: boolean;
    explains: string;
    allowedClaims: string[];
    excludedClaims: string[];
    confidence: string;
    limitations: string[];
    provenance: string;
  }[];
  error?: string;
}

function resolveUrl(snapshotUrl: string): string {
  return snapshotUrl.startsWith('/')
    ? `${import.meta.env.BASE_URL.replace(/\/$/, '')}${snapshotUrl}`
    : snapshotUrl;
}

function parseClaimSignals(snapshot: Record<string, unknown>): MemberProfile['claimSignals'] {
  const block = obj(snapshot.claimAuthority);
  const signals = Array.isArray(block.signals) ? block.signals : [];
  return signals
    .map((raw) => {
      const s = obj(raw);
      const signalType = str(s.signalType, 60);
      const badgeLabel = str(s.badgeLabel, 60);
      if (!signalType || !badgeLabel) return null;
      return {
        signalType,
        badgeLabel,
        tier: str(s.tier, 40) ?? 'self_submitted',
        present: s.present === true,
        explains: str(s.explains, 400) ?? '',
        allowedClaims: strArray(s.allowedClaims, 12, 40),
        excludedClaims: strArray(s.excludedClaims, 20, 40),
        confidence: str(s.confidence, 12) ?? 'low',
        limitations: strArray(s.limitations, 8, 120),
        provenance: str(s.provenance, 80) ?? '',
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .slice(0, 24);
}

/** A complete, safe-to-render placeholder — every array is real, never undefined. */
/**
 * Coercion helpers for THIRD-PARTY snapshot JSON.
 *
 * Members self-host their own snapshots, so every field here is attacker- or
 * accident-controlled. The previous code used TypeScript casts
 * (`opportunity.compensation as string`), which do nothing at runtime: a JSON
 * object in that field reached JSX and React threw "Objects are not valid as a
 * React child" — crashing the ENTIRE directory for every visitor because of one
 * bad member. Casts are not validation; these functions are.
 *
 * Strings are also length-capped so a multi-megabyte value cannot wedge layout
 * or the render.
 */
const MAX_LEN = 300;

function str(value: unknown, max = MAX_LEN): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Strip bidi overrides: they let a name render deceptively (spoofing risk on
  // an identity product) without changing the underlying characters.
  const clean = trimmed.replace(/[\u202a-\u202e\u2066-\u2069\u200e\u200f]/g, '');
  return clean.slice(0, max) || null;
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Array of clean strings only — drops non-strings rather than rendering them. */
function strArray(value: unknown, maxItems = 24, maxLen = 60): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => str(v, maxLen)).filter((v): v is string => v !== null).slice(0, maxItems);
}

/** A record only if it really is a plain object. */
function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Contact is only usable when BOTH fields are real strings. */
function contactOf(value: unknown): { label: string; href: string } | null {
  const c = obj(value);
  const label = str(c.label, 60);
  const href = str(c.href, 400);
  return label && href ? { label, href } : null;
}

export function emptyMemberProfile(member: RegistryMember): MemberProfile {
  return {
    member,
    signature: 'checking',
    activeDays: 0,
    activeDaysLast30: 0,
    totalTokens: 0,
    toolsUsed: [],
    modelsUsed: [],
    projectsActive: 0,
    collectorObserved: 0,
    lastActiveDate: null,
    cachedSharePct: null,
    workCategories: [],
    openTo: [],
    engagementTypes: [],
    compensation: null,
    workArrangement: null,
    timezone: null,
    contact: null,
    identityProofs: [],
    claimSignals: [],
  };
}

export async function loadMemberProfile(member: RegistryMember): Promise<MemberProfile> {
  const base = emptyMemberProfile(member);
  try {
    const response = await fetch(resolveUrl(member.snapshotUrl), { cache: 'no-cache' });
    if (!response.ok) return { ...base, signature: 'unreachable', error: `HTTP ${response.status}` };
    const snapshot = (await response.json()) as Record<string, unknown>;
    const outcome = await verifySnapshotInBrowser(snapshot);
    const profile = obj(snapshot.profile);
    const activity = obj(profile.activity);
    const identity = obj(profile.identity);
    const opportunity = obj(profile.opportunity);
    const efficiency = obj(profile.efficiency);
    const work = obj(profile.work);
    const totals = obj(snapshot.totals);

    return {
      ...base,
      signature: outcome.state,
      signatureReason: outcome.reason,
      generatedAt: str(snapshot.generatedAt, 40) ?? undefined,
      activeDays: num(activity.activeDays),
      activeDaysLast30: num(activity.activeDaysLast30),
      totalTokens: num(totals.totalTokens),
      toolsUsed: strArray(activity.toolsUsed, 8, 40),
      modelsUsed: strArray(activity.modelsUsed, 24, 80),
      projectsActive: num(activity.projectsActive),
      collectorObserved: num(work.collectorObserved),
      lastActiveDate: str(activity.lastActiveDate, 40),
      cachedSharePct: typeof efficiency.cachedSharePct === 'number' && Number.isFinite(efficiency.cachedSharePct)
        ? Math.max(0, Math.min(100, efficiency.cachedSharePct))
        : null,
      workCategories: strArray(identity.workCategories, 10, 40),
      openTo: strArray(identity.openTo, 10, 40),
      engagementTypes: strArray(opportunity.engagementTypes, 12, 40),
      compensation: str(opportunity.compensation, 80),
      workArrangement: str(opportunity.workArrangement, 60),
      timezone: str(opportunity.timezone, 60),
      contact: contactOf(identity.contact),
      identityProofs: (Array.isArray(identity.identityProofs) ? identity.identityProofs : [])
        .map((raw) => {
          const p = obj(raw);
          const type = str(p.type, 20);
          const handle = str(p.handle, 40);
          return type && handle ? { type, handle } : null;
        })
        .filter((p): p is { type: string; handle: string } => p !== null)
        .slice(0, 6),
      claimSignals: parseClaimSignals(snapshot),
    };
  } catch (error) {
    return { ...base, signature: 'unreachable', error: error instanceof Error ? error.message : 'fetch failed' };
  }
}

export function useMemberProfiles(): { profiles: MemberProfile[]; loading: boolean; error: string | null } {
  const [profiles, setProfiles] = useState<MemberProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadRegistry()
      .then((registry) => {
        if (cancelled) return;
        setProfiles(registry.members.map((member) => emptyMemberProfile(member)));
        setLoading(false);
        registry.members.forEach((member, index) => {
          loadMemberProfile(member).then((profile) => {
            if (cancelled) return;
            setProfiles((prev) => {
              const next = [...prev];
              next[index] = profile;
              return next;
            });
          });
        });
      })
      .catch((e) => {
        if (!cancelled) {
          setError(String(e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { profiles, loading, error };
}
