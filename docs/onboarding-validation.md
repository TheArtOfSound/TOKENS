# Onboarding validation

The production onboarding path is intentionally bounded by the infrastructure that exists today.

## Expected flow

1. Install the local collector on macOS, Linux, or Windows.
2. Run `npm run join`.
3. Create a self-submitted profile.
4. Explicitly enable Claude Code or Codex.
5. Measure and sign locally.
6. Review the exact public payload.
7. Explicitly decide whether to continue to GitHub-backed directory enrollment.

## Invariants

- Installation does not scan.
- Scanning does not publish.
- Bare Enter does not grant directory consent.
- New source permissions default to off.
- The managed publication prototype is not presented as a live production service.
- The live site never instructs users to contact a localhost API.
