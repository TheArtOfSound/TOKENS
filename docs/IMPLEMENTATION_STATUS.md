# TOKENS — Implementation Status (living document)

_Last updated: 2026-07-23 · Branch: `feat/verified-ai-work-foundation`_

This is the master status view. Detailed docs live under `docs/execution`, `docs/architecture`, `docs/security`, `docs/product`.

## Dossier coverage — measured, not estimated

A full audit read all 75 dossier pages and checked each requirement against code on disk
(skeptical verification: "built" required real implementing code or a passing test, never a doc claim).

| Status | Count |
| --- | --- |
| Built | 67 |
| Partial | 165 |
| Missing | 220 |
| Not applicable yet (dossier gates it later) | 44 |
| **Total audited** | **496** |

**Coverage: 14.8%** of the 452 requirements checkable today.

> This figure is a point-in-time measurement taken at commit `e89d6d1`. Work landed since then
> (incremental scan, offline collection, scanner containment) is not reflected in it. Re-run the audit
> before quoting the number.

⚠️ **Correction to an earlier claim in this repo.** Ed25519 signing, incremental scanning, and the
upload-preview/consent layer are **Phase 1 scope in the dossier**. They were previously listed here as
"roadmap / Phase 2". That was a *self-granted* deferral, not a dossier deferral. Incremental scanning and
the consent layer and Ed25519 signing have all since been built. Pillars still at or near zero: SQLite
event ledger (0/17), canonical event model, adapter framework (0/11), accessibility (0), benchmarks (0).

## Health snapshot
| Check | Result |
| --- | --- |
| Typecheck (`tsc --noEmit`) | ✅ pass |
| Unit tests (`vitest run`) | ✅ 92/92 |
| Data validation (`validate:data`) | ✅ schema + hash + secret scan |
| Build (`tsc -b && vite build`) | ✅ pass |
| Dependency audit | ✅ 0 vulnerabilities |
| Chrome (1440 / 375) | ✅ renders, no console errors, no leaks |
| Live site publishing | ⛔ blocked (R1 divergence) |

## Component status
| Area | Status | Notes |
| --- | --- | --- |
| Collector core (normalize/dedup/derive) | ✅ done, tested | pure, fixture-tested |
| Canonical evidence model 2.0.0 | ✅ done | measurement classes + provenance |
| Allowlist publication transform | ✅ done, tested | construct-not-redact; fail-closed |
| Secret/PII/path scanner | ✅ done, tested | nested + base64 + control chars |
| Compact history | ✅ done | 28 MB → 27 KB |
| Validator / release gate | ✅ done | Ajv 2020 + hash + scan |
| Test suite | ✅ done | 92 tests, adversarial fixtures |
| Frontend honesty UI | ✅ done | evidence tags + methodology panel |
| Professional profile (identity + activity + verification) | ✅ done, tested | identity-first, evidence-backed; `profile.ts` + UI; 8 tests |
| Activity heatmap (26-week) | ✅ done | GitHub-style, driven by measured daily data |
| Connected work artifacts + outcomes | ✅ done, tested | 3-tier evidence badges; anti-forgery enforced in publish; 5 tests |
| CI gates | ✅ done | npm ci + typecheck + test + validate + audit + build |
| Publisher hardening | ✅ done | idempotent, no-clobber, no force-push |
| **Incremental checkpointed scan** | ✅ done, tested | **cold 71.6s → warm 0.70s (100×)**; full collector run **78s → 5.3s**. Root-name + git/mtime signatures; negative results cached; `TOKENS_SCAN_FORCE=1` to re-discover. |
| **Offline-by-default collection** | ✅ done | `ccusage --offline` removes the only network egress in the pipeline; a measured run had stalled ~4 min at 4% CPU on the pricing fetch. 60s hard timeout added. |
| **Scanner filesystem containment** | ✅ done, tested | symlink-escape, TOCTOU, and FIFO/socket/device reads closed; real-symlink + real-FIFO tests |
| **Consent + permission disclosure** | ✅ done, tested | per-source opt-in (disabled source is never read), per-field publication toggles, `profile/consent.json`; 9 tests |
| **Upload preview / export / delete** | ✅ done | `npm run consent`, `consent:preview` (exact published bytes), `consent:export`, `consent:delete` |
| **Ed25519 device signing** | ✅ done, tested | keypair in macOS Keychain, signed manifest (nonce/scope/issuedAt/digest), `npm run verify`; 21 tests incl. tamper detection |
| **Canonical JSON (RFC 8785 subset)** | ✅ done, tested | replaces `JSON.stringify` key-order dependence so a non-JS verifier can reproduce the signing bytes; spec published in `docs/architecture/CANONICALIZATION.md` |
| Mobile responsiveness | ✅ fixed | eliminated pre-existing horizontal overflow (chart/SVG) |
| Docs / threat model / privacy | ✅ done | full `docs/**` set |
| Live publishing restore | ⬜ needs Bryan | resolve R1, re-enable launchd |

### Dossier **Phase 1** scope that is NOT built (previously mislabeled "roadmap")
| Area | Status | Notes |
| --- | --- | --- |
| ~~Incremental/checkpointed scan~~ | ✅ **now built** | See the measured numbers in the built table above. |
| ~~Consent / upload-preview / export / delete~~ | ✅ **now built** | See the built table above. |
| ~~Ed25519 device signing~~ | ✅ **now built** | See the built table above. Revocation lists remain unimplemented. |
| Canonical **event** model | ⛔ **Phase 1 — not built** | Finest granularity is a daily per-provider aggregate. No `eventId`, `ingestedAt`, per-record evidence class, or session pseudonym. Blocks ~40 downstream requirements. |
| Adapter framework | ⛔ **not built** | 0 of 11. Providers are hardcoded, not pluggable versioned adapters. |
| Accessibility (WCAG 2.2 AA) | ⛔ **not built** | 0 focus-visible rules, 0 `prefers-reduced-motion` rules; heatmap exposes no per-day data to assistive tech. A Definition-of-Done item, never checked. |

### Later phases (dossier gates these — correctly deferred)
| Area | Status | Notes |
| --- | --- | --- |
| SQLite event ledger | ⬜ Phase 2 | depends on the event model above |
| Cloud sync / authenticated ingest | ⬜ Phase 2+ | no backend exists by design |
| Opportunity marketplace / employer search | ⬜ Phase 4+ | dossier explicitly warns against building this first |

## Known limitations (honest)
1. **Live site is stale** (2026-06-18) until the origin/local divergence is reconciled by Bryan (R1). All new work is on a feature branch.
2. **Cold scan is still ~72s** the first time, or after a project is added/renamed (the depth-5 discovery walk). Warm runs are ~0.7s. Scope roots with `QIRA_SCAN_ROOTS`; force re-discovery with `TOKENS_SCAN_FORCE=1`.
3. **Base64 secret detection is one level deep**; deeply nested encodings could evade the defense-in-depth scanner (the allowlist makes placement hard regardless).
4. **Hostname/username detection outside path context is not attempted** (false-positive tradeoff) — see PRIVACY_BOUNDARY.
5. **No cloud backend yet**, so authenticated ingestion and replay protection are designed but not built.
6. **Cross-platform paths tested by fixtures only**, not on real Windows/Linux machines.
7. **Legacy `collector/collect.ts` (v0.2.1)** remains, unused; safe to delete once confirmed unreferenced.
8. **`qiraProjects` publishes git branch names** of allowlisted repos (scanned + truncated); avoid encoding sensitive info in branch names.
9. **Work artifacts are only as strong as their badge.** `collector_observed` proves the *project exists and is active on this machine* — it does **not** prove authorship, quality, or that the linked URL is genuinely that project. `link_provided` and `self_reported` assert nothing. Outcomes are never verifiable today.
10. **No key revocation.** A compromised device key cannot yet be repudiated — there is no published revocation list. Rotation works: delete the Keychain item and re-run.
11. **The signature is a device attestation, not proof of log authenticity.** Anyone controlling this Mac could feed the collector fabricated provider logs and it would sign them faithfully.

## Definition of Done for Phase 1 (dossier §38) — remaining
- Restore live publishing (R1).
- ~~Add device-signed aggregate + honest badge.~~ ✅ done — Ed25519, self-verified on write, `npm run verify` for third parties.
- ~~Add incremental scan to hit the perf budget.~~ ✅ done — warm run 0.70s (budget <2s median).
- ~~Build the consent layer.~~ ✅ done — per-source opt-in, disclosure, preview, export, delete.
