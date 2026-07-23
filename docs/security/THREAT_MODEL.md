# TOKENS — Security Threat Model

Scope: the local collector, the public JSON artifact, the static site, and the deploy path. The future cloud backend/ingest/auth is out of scope until it exists (see roadmap).

## Assets
1. **Bryan's private data** — prompts, code, session text, paths, usernames, hostnames, API keys, `.env`, private repo names, provider account IDs. (Highest priority.)
2. **Integrity of the public evidence** — the published metrics and their provenance must be accurate and tamper-evident.
3. **Availability/recoverability** — the repo, its history, and the ability to roll back.
4. **Trust** — no over-claiming; labels must be honest.

## Trust boundaries
- Local logs → collector (read-only).
- Collector → public JSON (the allowlist publication transform).
- Public JSON → the world (static, read-only).
- Local repo → GitHub (push) → GitHub Pages (deploy).

## Threats & mitigations (STRIDE-flavored)

| # | Threat | Vector | Mitigation | Status |
| --- | --- | --- | --- | --- |
| T1 | **Information disclosure** of secrets/PII into public JSON | A source field or free-form value carries a path/secret | Allowlist construction + per-value secret scan + fail-closed write + validate gate | **Mitigated** |
| T2 | Disclosure via **unanticipated field** | New source adds a field we didn't foresee | Allowlist means unknown fields never copied; schema `additionalProperties:false` | **Mitigated** |
| T3 | Disclosure via **encoded secret** | base64 / control chars | Scanner decodes base64 once and re-scans; flags control chars | **Mitigated (1 level)** |
| T4 | **Tampering** with the public snapshot after generation | Edit `latest.json` post-publish | SHA-256 over the snapshot; `verifySnapshotHash`; validate gate | **Mitigated (detectable)** |
| T5 | **Over-claiming** integrity | Presenting the hash as proof logs were immutable | `verification.proves` states exactly what it proves; UI mirrors it | **Mitigated** |
| T6 | **Data inflation / double counting** | Same day counted from multiple sources | Deterministic dedup by `date:provider`, keep-max not sum; reconciliation warnings | **Mitigated** |
| T7 | **Fabricated data** | NaN/negative/injected metrics | Numeric coercion to safe non-negative; null-with-reason cost; totals re-derived | **Mitigated** |
| T8 | **Supply-chain** compromise | Malicious dep update | Deps pinned to exact versions; `npm ci`; `npm audit` in CI (advisory) | **Partially mitigated** (see R-dep) |
| T9 | **Denial of data** / stale site | Push rejected, collector loops | Idempotent no-op skip; no-clobber-on-empty; push resilience in update script | **Improved** (divergence still needs Bryan) |
| T10 | **Local resource abuse** | Broad filesystem scan | `QIRA_SCAN_ROOTS` scoping; roadmap: incremental scan | **Partially mitigated** |
| T11 | **Repo history exposure** | Secrets committed historically | History reviewed; `test_credentials.md` on origin is a notes file, no secrets (F9) | **Reviewed** |
| T12 | **XSS** in the site | Malicious string rendered | React escapes by default; all rendered strings pass the secret/allowlist filter; no `dangerouslySetInnerHTML` | **Mitigated** |
| T13 | **Prompt-injection via tool data** | Instructions embedded in scanned files/logs | Collector treats all scanned content as data, never executes it; no LLM in the collector path | **Mitigated** |

## Out of scope (until built)
Authentication, authorization, ingestion replay protection, rate limiting, payload-signature verification on a server, broken-object-level authorization, and debug endpoints — these apply to the future cloud backend and must be threat-modeled when that component is designed. Design notes are in the roadmap (Ed25519 device signing, authenticated ingest, replay nonce).

## Residual risks
- Base64 decoding is one level deep; deeply nested encodings could evade (accepted; allowlist makes placement hard).
- Hostname/username detection outside path context is intentionally not attempted (false-positive tradeoff).
- The origin/local divergence and the disabled launchd job require Bryan's action to fully restore healthy publishing (see RISKS + SESSION_STATE).
