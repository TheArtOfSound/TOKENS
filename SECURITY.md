# Security Policy

TOKENS is a local-first measurement tool with a public, sanitized static site. The strongest guarantee we make is the **privacy boundary**: raw prompts, responses, source code, paths, usernames, hostnames, secrets, and account identifiers must never reach the public artifact.

## Reporting a vulnerability
Please report privately — do **not** open a public issue for a security problem.
- Email the maintainer (Qira LLC / TheArtOfSound) via the contact on `https://imagineqira.com`.
- Include: affected component (collector / published data / site), reproduction steps, and impact.
- If you believe private data was published, include the field path — but **do not paste the secret value**; a redacted excerpt is enough.

We aim to acknowledge within a few days.

## Scope
- **In scope:** the local collector (`collector/**`), the publication transform and validator, the published JSON contract, and the static site.
- **Out of scope (not built yet):** any cloud backend, ingest API, or auth system referenced in older docs. If/when built, this policy will be extended.

## What the published data guarantees
- Constructed via an allowlist (unknown fields cannot appear).
- Passes a nested secret/PII/path scan (see `docs/security/PRIVACY_BOUNDARY.md`).
- Carries a SHA-256 that proves the public file was not altered after generation. It does **not** prove the private source logs were immutable.

## Hardening notes for operators
- Keep `QIRA_SCAN_ROOTS` scoped; the collector reads file contents for project scoring.
- Never commit `.env` or credentials; `.gitignore` excludes them and CI/local validation fails on prohibited patterns.
- The publisher never force-pushes and refuses to push over a diverged remote.
