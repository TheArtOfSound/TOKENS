/**
 * Member registry — the multi-user layer.
 *
 * TOKENS is local-first, so there is deliberately no account server. Each member
 * runs the collector on their own machine, which produces a SIGNED snapshot, and
 * publishes it at a URL they control. The registry is just an index of those
 * URLs.
 *
 * What that buys:
 *  - No one uploads prompts, code, or logs to us. We never hold their data.
 *  - A profile is verifiable by anyone: fetch the snapshot, check the Ed25519
 *    signature against the embedded public key. Claims are not taken on trust.
 *  - A member can leave by removing their entry; nothing of theirs is retained.
 *
 * The tradeoff, stated plainly: the registry lists where a snapshot lives, it
 * does not vouch for who published it. Identity verification is a separate,
 * unbuilt layer — every profile shows `Identity verified: pending` until then.
 */

export interface RegistryMember {
  /** URL-safe handle, used as the profile route: #/u/<handle> */
  handle: string;
  displayName: string;
  headline: string;
  location?: string | null;
  availability?: string | null;
  workCategories?: string[];
  /** Where this member's signed snapshot lives. Same-origin or absolute https. */
  snapshotUrl: string;
  /** Optional external links the member chose to publish. */
  links?: { label: string; url: string }[];
  /** Set when the member is the site operator; shown as such, never as an endorsement. */
  operator?: boolean;
}

export interface Registry {
  updatedAt: string;
  members: RegistryMember[];
}

/** Summary derived from a member's fetched snapshot — never self-reported. */
export interface MemberSummary {
  member: RegistryMember;
  activeDays: number;
  totalTokens: number;
  toolsUsed: string[];
  lastActiveDate: string | null;
  currentStreakDays: number;
  projectsActive: number;
  collectorObserved: number;
  /** 'valid' | 'invalid' | 'unsigned' | 'unreachable' | 'checking' */
  signatureState: SignatureState;
  signatureReason?: string;
  generatedAt?: string;
  error?: string;
}

export type SignatureState = 'checking' | 'valid' | 'invalid' | 'unsigned' | 'unreachable';

const HANDLE_RE = /^[a-z0-9][a-z0-9-]{1,38}$/;

export function isValidHandle(handle: unknown): handle is string {
  return typeof handle === 'string' && HANDLE_RE.test(handle);
}

/**
 * Only same-origin paths and https URLs are fetchable.
 * A registry entry is data, not code — it must never be able to point the app at
 * a non-https origin or a javascript: URL.
 */
export function isSafeSnapshotUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !url) return false;
  if (url.startsWith('/')) return !url.startsWith('//');
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

export function parseRegistry(raw: unknown): Registry {
  const value = (raw ?? {}) as Partial<Registry>;
  const members = Array.isArray(value.members) ? value.members : [];
  return {
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
    members: members.filter(
      (m): m is RegistryMember =>
        Boolean(m) &&
        isValidHandle((m as RegistryMember).handle) &&
        typeof (m as RegistryMember).displayName === 'string' &&
        isSafeSnapshotUrl((m as RegistryMember).snapshotUrl),
    ),
  };
}

export async function loadRegistry(signal?: AbortSignal): Promise<Registry> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/profiles/index.json`, { signal });
  if (!response.ok) throw new Error(`registry ${response.status}`);
  return parseRegistry(await response.json());
}
