/**
 * Publication service types.
 *
 * A user account controls publication. It does not prove real-world identity.
 * Keep account state and identity evidence separate in every response.
 */

export type ProfilePublicationState =
  | 'local_only'
  | 'draft'
  | 'ready_to_publish'
  | 'published'
  | 'unlisted'
  | 'unpublished'
  | 'suspended'
  | 'deleted';

export type PublicationMode = 'ledger_hosted' | 'self_hosted' | 'private';

export interface AccountRecord {
  id: string;
  email: string;
  emailConfirmed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SessionRecord {
  token: string;
  accountId: string;
  createdAt: string;
  expiresAt: string;
}

export interface DeviceKeyRecord {
  keyId: string;
  accountId: string;
  publicKey: string;
  registeredAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
}

export interface ProfileRecord {
  handle: string;
  accountId: string;
  displayName: string;
  headline: string;
  location: string | null;
  availability: string | null;
  workCategories: string[];
  links: { label: string; url: string }[];
  state: ProfilePublicationState;
  mode: PublicationMode;
  /** Hosted path or absolute self-hosted URL. */
  snapshotUrl: string;
  /** Device key that signed the current public snapshot. */
  keyId: string | null;
  publishedAt: string | null;
  unpublishedAt: string | null;
  updatedAt: string;
  /** Explicit publication consent timestamp. Never inferred from install/scan. */
  publicationConsentAt: string | null;
  /** Self-submitted only — never shown as verified identity. */
  identityStatus: 'self_submitted' | 'unverified';
}

export interface SnapshotHistoryRecord {
  id: string;
  handle: string;
  accountId: string;
  keyId: string;
  payloadSha256: string;
  snapshotJson: string;
  sizeBytes: number;
  createdAt: string;
  status: 'active' | 'superseded' | 'revoked_key' | 'unpublished';
}

export interface MagicLinkRecord {
  codeHash: string;
  email: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
}

export interface AnalyticsEvent {
  id: string;
  name: string;
  createdAt: string;
  /** Category only — never prompts, paths, or raw logs. */
  category: string | null;
}

export interface RegistryMemberView {
  handle: string;
  displayName: string;
  headline: string;
  location?: string | null;
  availability?: string | null;
  workCategories?: string[];
  snapshotUrl: string;
  links?: { label: string; url: string }[];
  operator?: boolean;
  /** Hosted by Ledger publication service vs self-hosted. */
  hosting: 'ledger' | 'self' | 'static';
  state: ProfilePublicationState;
  publishedAt?: string | null;
  keyId?: string | null;
  identityStatus: 'self_submitted' | 'unverified';
  signatureNote: string;
}
