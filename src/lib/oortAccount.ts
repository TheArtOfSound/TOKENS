export interface LedgerAccount {
  oortUserId: string;
  handle: string;
  oortUsername: string;
  email: string;
  displayName: string;
  avatarColor: string | null;
  avatarUrl: string | null;
  tier: string;
  createdAt: string;
  updatedAt: string;
  ownershipClaim: string;
}

type AccountResponse = {
  account: LedgerAccount | null;
  error?: string;
  message?: string;
};

export function oortConnectUrl(next = '/account'): string {
  return `https://oortstack.com/api/sso/ledger?next=${encodeURIComponent(next)}`;
}

async function accountRequest(method: string, body?: unknown): Promise<AccountResponse> {
  const response = await fetch('/api/account', {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const result = (await response.json().catch(() => ({}))) as AccountResponse;
  if (!response.ok) {
    throw new Error(result.message || result.error || `Ledger account request failed (${response.status})`);
  }
  return result;
}

export async function loadLedgerAccount(): Promise<LedgerAccount | null> {
  const response = await fetch('/api/account/me', {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
  if (response.status === 401 || response.status === 404) return null;
  const result = (await response.json().catch(() => ({}))) as AccountResponse;
  if (!response.ok) throw new Error(result.message || result.error || 'Could not load your Ledger account.');
  return result.account;
}

export async function updateLedgerHandle(handle: string): Promise<LedgerAccount> {
  const result = await accountRequest('PATCH', { handle });
  if (!result.account) throw new Error('Ledger returned no account after updating the handle.');
  return result.account;
}

export async function signOutLedger(): Promise<void> {
  await fetch('/api/oort/logout', { method: 'POST', credentials: 'same-origin' });
}

export async function deleteLedgerAccount(): Promise<void> {
  await accountRequest('DELETE');
}
