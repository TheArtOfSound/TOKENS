# TOKENS — Privacy Boundary

The privacy boundary is the single most important trust property of TOKENS. This document states exactly what may cross from the private local machine to the public artifact, and how that is enforced.

## Principle: allowlist construction, not redaction

The published object is **constructed** from an explicit allowlist of approved fields (`collector/lib/publish.ts → publishSnapshot`). A field that is not deliberately copied into the output cannot appear in the output. This is strictly stronger than a blocklist, which only removes patterns it anticipated.

Defense in depth: after construction, `collector/lib/secretScan.ts` walks the entire published object (values **and** keys, nested arrays/objects, base64-decoded variants) and the collector **refuses to write** if any prohibited pattern is found (fail closed). The `validate:data` gate repeats this check before deploy.

## Published (allowed to leave the device)
- Generated timestamp, timezone
- Aggregate token metrics: input, output, cache-creation, cache-read, cached, fresh, total (all provider-reported or deterministically derived)
- Estimated cost (clearly labeled `tokenizer_estimated`, kept separate from token totals)
- Provider labels (`Claude Code`, `Codex`) and safe model identifiers
- Daily aggregate rows (date + provider + metrics)
- Allowlisted Qira project **metadata only**: name, category, status, public URL, description, found flag, git branch/short-commit/changed-file **count**, detected stack, package **script names**, per-extension file **counts**, last-modified date
- Snapshot hash, schema/collector versions, measurement provenance, privacy posture, sanitized warning codes

## Never published (must not leave the device)
Raw prompts · model responses · source code · session text · API keys / tokens · environment variables · `.env` contents · private repository names · local filesystem paths · usernames · hostnames · raw machine identifiers · provider account identifiers · unredacted session identifiers · private key material.

## Enforcement mechanisms
1. **Aggregate-only source.** The collector reads only `ccusage … daily --json`, which is aggregate and path-free (verified: 0 `/Users/` occurrences in real output). Session/project modes that include paths are never used.
2. **Allowlist transform.** Only enumerated fields are copied; metric values are coerced to safe non-negative numbers; cost is null-with-reason when absent.
3. **Per-value sanitization.** Free-form strings (model names, branch/commit, script names, warnings, descriptions) are individually scanned; any that trips a rule is dropped and counted in `dropped`.
4. **Fail-closed write.** `collectV2.ts` aborts the write if the constructed object contains any prohibited pattern.
5. **Release gate.** `validate:data` re-validates `latest.json` and `history.json` against the schema + secret scan before CI deploys.

## Detected prohibited classes (secretScan)
macOS/Linux/Windows/`/private` paths · Anthropic/OpenAI/AWS/GitHub/Google/Slack key shapes · JWTs · PEM/OpenSSH private keys · credential assignments (`*_SECRET/PASSWORD/API_KEY=…`) · known key env-var names · `.env` references · email addresses · base64-encoded variants of the above · disallowed control characters.

## Known limitations (honest disclosure)
- The scanner does **not** attempt to flag arbitrary hostnames or usernames outside of path context, because generic hostname/username detection produces unacceptable false positives. Mitigation: the allowlist means such values would have to be deliberately placed in an approved field; free-form approved fields are content-scanned.
- Git branch names of allowlisted Qira repos are published (as project metadata). If a branch name itself encodes something sensitive, it is scanned and dropped, but teams should avoid encoding secrets in branch names.
- The snapshot hash proves the **public file** was not altered after generation. It does **not** prove the private source logs were immutable. This is stated in `verification.proves` and in the UI. No over-claiming.

## What a viewer can independently verify
- Recompute the SHA-256 over the published snapshot (with `snapshotSha256` nulled) and compare to `verification.snapshotSha256`.
- Confirm `verification.rawLogsPublished === false` and `privacy.rawContentPersisted === false`.
- Read the collector source to confirm the allowlist and scanner behavior. (Note: the repo has no LICENSE yet, so the code is not formally open source — see IMPLEMENTATION_STATUS "Known limitations".)
