# One-click publish (Ledger publication service)

## Problem

Joining previously required: clone → install → consent → ingest → edit JSON → collect → host snapshot → edit registry → open PR → wait for merge.

That is commercially unusable. Publication must become:

**Download → open app → choose sources → scan → edit profile → preview → Publish → appear in People.**

Publication remains an **explicit** user action. Install/scan never auto-publishes.

## Architecture

| Layer | Responsibility |
| --- | --- |
| Collector (local) | Consent, ingest, allowlist publish transform, Ed25519 sign |
| Join wizard (`/join`) | Guided UI, profile draft, preview, explicit publish choice |
| Publication service (`publish/`) | Auth, device public keys, signed snapshot verify, directory |
| Static registry | Fallback + migration source (`public/data/profiles/index.json`) |

### What the service stores

- Public profile fields
- Sanitized **signed** snapshots
- Device **public** keys
- Handles, history, publication status, consent timestamps
- Key revocation records

### What it must never receive

- Prompts, responses, source code, raw logs
- Local paths, API keys, private signing keys
- Unpublished drafts (unless the user explicitly uploads a signed public snapshot)

### Publication options

1. **Publish through Ledger** — default; signed snapshot uploaded; directory entry automatic
2. **Self-host** — register an HTTPS snapshot URL via API/form (no hand-edited registry JSON required)
3. **Keep private** — first-class `local_only` state

### Account vs identity

Login proves control of an email account. It does **not** prove legal identity.

Separate states:

- Account authenticated / email confirmed / device key registered / signature valid
- Identity self-submitted or unverified (never a generic “verified person” from login alone)
- Work collector-observed vs link-provided vs self-reported

## Local development

```bash
cd ~/Projects/TOKENS
npm install

# Terminal A — publication API (port 8787)
npm run publish:serve

# Terminal B — web app (port 5199)
npm run dev

# Optional: migrate Bryan's existing snapshot into the service
npm run publish:migrate

open "http://localhost:5199/join"
# legacy hash links still work: http://localhost:5199/#/join
```

Vite proxies `/api/publish/*` → `http://127.0.0.1:8787`.

### CLI publish (after local collect)

```bash
npm run collect
npm run publish:ledger -- --handle your-handle --email you@example.com --yes
```

In dev, magic-link codes are returned in the API response (`PUBLISH_DEV_EXPOSE_CODES=0` to disable).

## Deploy

1. Deploy the static site as today (GitHub Pages / existing host).
2. Run `publish/server.ts` (or containerize it) with:
   - `PUBLISH_PORT=8787`
   - `PUBLISH_PUBLIC_BASE=https://ledger.imagineqira.com`
   - `PUBLISH_DB=/var/lib/tokens/publish.db`
   - `PUBLISH_DEV_EXPOSE_CODES=0`
   - `PUBLISH_CORS_ORIGIN=https://ledger.imagineqira.com`
3. Put a reverse proxy in front so `https://ledger.imagineqira.com/api/publish/*` reaches the service **or** set `VITE_PUBLISH_API_URL` at build time to the API origin.
4. Run `npm run publish:migrate` once against production DB with the current `public/data/latest.json` to seed Bryan.

### Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `PUBLISH_PORT` | `8787` | API port |
| `PUBLISH_HOST` | `127.0.0.1` | Bind address |
| `PUBLISH_PUBLIC_BASE` | `http://localhost:5199` | Profile URL prefix |
| `PUBLISH_DB` | `.tokens-cache/publish.db` | SQLite path |
| `PUBLISH_DEV_EXPOSE_CODES` | on unless `0` | Return magic codes in API |
| `VITE_PUBLISH_API_URL` | same-origin `/api/publish` | Frontend API base |

## API surface

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/v1/health` | no | Health |
| POST | `/v1/auth/magic-link` | no | Start email login |
| POST | `/v1/auth/verify` | no | Exchange code → session |
| GET | `/v1/me` | yes | Account + profile state |
| POST | `/v1/keys` | yes | Register device public key |
| POST | `/v1/publish` | yes | Hosted publish (signed snapshot) |
| POST | `/v1/publish/self-hosted` | yes | Register self-hosted URL |
| POST | `/v1/publish/private` | yes | Private mode |
| POST | `/v1/unpublish` | yes | Remove from directory |
| DELETE | `/v1/account` | yes | Delete account + hosted data |
| GET | `/v1/directory` | no | Public member list |
| GET | `/v1/snapshots/:handle` | no | Hosted signed snapshot |
| POST | `/v1/analytics` | no | Opt-in anonymous events |

## Security decisions

- Server re-verifies Ed25519 signatures with the same canonical JSON as the collector.
- Unknown top-level fields rejected; secret/path scanner runs on payload.
- Rate limits on magic-link, verify, and publish.
- Self-hosted URLs must be public HTTPS (no localhost / private IPs / credentials).
- Revoked keys rejected; history marked `revoked_key`.
- Explicit `publicationConsent: true` required — never inferred from install/scan.

## Privacy decisions

- Analytics consent is separate from publication; default off in the wizard.
- Disabled profile fields are omitted, not zeroed.
- Private mode is first-class (`local_only`).
- Unpublish removes directory visibility; account delete removes hosted rows.

## Migration & rollback

### Migrate

```bash
npm run publish:serve   # if not already running against target DB
npm run publish:migrate
```

Preserves:

- `/u/bryan` route
- Static `/data/latest.json` verification path
- Static registry as fallback when API is down
- Existing collector consent / signing / key history

### Rollback

1. Stop the publication service.
2. Delete or rename `PUBLISH_DB` (default `.tokens-cache/publish.db`).
3. Static site + `public/data/profiles/index.json` continue to serve Bryan and any PR-based members.
4. Frontend degrades gracefully: directory loads static registry only.

No git history rewrite required. No force-push.

## Tests

```bash
npm test                 # includes publish/__tests__/publish-service.test.ts
npm run typecheck
npm run build
```

## Uninstall (collector)

```bash
rm -rf ~/TOKENS
# macOS: delete Keychain item "com.qira.tokens.device-key" / tokens device key
rm -rf .tokens-cache     # local derived data + publish DB if local
```

## Remaining (not in this vertical slice)

- Production SMTP / passkeys / GitHub OAuth
- Signed desktop installers (macOS/Windows/Linux packages)
- Full interactive local scan inside the browser (blocked by OS sandbox — needs desktop bridge)
- Email-based abuse review queue / captcha at scale
- Snapshot retention policy UI
- Cloudflare/Worker production packaging
