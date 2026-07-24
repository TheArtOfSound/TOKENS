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
  error?: string;
}

function resolveUrl(snapshotUrl: string): string {
  return snapshotUrl.startsWith('/')
    ? `${import.meta.env.BASE_URL.replace(/\/$/, '')}${snapshotUrl}`
    : snapshotUrl;
}

/** A complete, safe-to-render placeholder — every array is real, never undefined. */
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
  };
}

export async function loadMemberProfile(member: RegistryMember): Promise<MemberProfile> {
  const base = emptyMemberProfile(member);
  try {
    const response = await fetch(resolveUrl(member.snapshotUrl), { cache: 'no-cache' });
    if (!response.ok) return { ...base, signature: 'unreachable', error: `HTTP ${response.status}` };
    const snapshot = (await response.json()) as Record<string, unknown>;
    const outcome = await verifySnapshotInBrowser(snapshot);
    const profile = (snapshot.profile ?? {}) as Record<string, Record<string, unknown>>;
    const activity = profile.activity ?? {};
    const identity = profile.identity ?? {};
    const opportunity = profile.opportunity ?? {};
    const efficiency = profile.efficiency ?? {};
    const work = profile.work ?? {};
    const totals = (snapshot.totals ?? {}) as Record<string, unknown>;
    const strArr = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);

    return {
      ...base,
      signature: outcome.state,
      signatureReason: outcome.reason,
      generatedAt: (snapshot.generatedAt as string) ?? undefined,
      activeDays: Number(activity.activeDays) || 0,
      activeDaysLast30: Number(activity.activeDaysLast30) || 0,
      totalTokens: Number(totals.totalTokens) || 0,
      toolsUsed: strArr(activity.toolsUsed),
      modelsUsed: strArr(activity.modelsUsed),
      projectsActive: Number(activity.projectsActive) || 0,
      collectorObserved: Number(work.collectorObserved) || 0,
      lastActiveDate: (activity.lastActiveDate as string) ?? null,
      cachedSharePct: typeof efficiency.cachedSharePct === 'number' ? (efficiency.cachedSharePct as number) : null,
      workCategories: strArr(identity.workCategories),
      openTo: strArr(identity.openTo),
      engagementTypes: strArr(opportunity.engagementTypes),
      compensation: (opportunity.compensation as string) ?? null,
      workArrangement: (opportunity.workArrangement as string) ?? null,
      timezone: (opportunity.timezone as string) ?? null,
      contact: (identity.contact as { label: string; href: string } | null) ?? null,
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
