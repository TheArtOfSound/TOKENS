# Reddit feedback → product backlog

Source: community comments on the TOKENS launch (July 2026). This file maps
each recurring objection to status and the recommended sprint. It is not a
claim that every launch post was published — only that the feedback themes
are durable enough to drive product work.

## Product thesis (converged)

> Not a token tracker, not an expertise score, and not a leaderboard.
> A **claim-bounded evidence system** connecting locally observed AI work to
> durable artifacts, practical assessments, confirmed outcomes, and paid
> opportunities.

## Status legend

- ✅ Done in repo
- ◑ Partial
- ⬜ Not started

## Findings → status

| # | Finding | Status | Where / next |
| --- | --- | --- | --- |
| 1 | Token volume overpowers the product | ◑ | Hero de-centered; totals under Activity Details + disclaimer. Keep auditing directory/employer prominence. |
| 2 | Every signal needs claim boundaries | ◑ | `src/lib/evidenceAuthority.ts` + badges. Full snapshot schema wiring = Sprint 2 remainder. |
| 3 | Signature language overstates trust | ◑ | Device-signed language; explicit “integrity ≠ honesty” caveats. |
| 4 | Publication too complicated | ✅ | `/join` wizard + `publish/` service (Sprint 1 vertical slice). Desktop installers still ⬜. |
| 5 | Accepted-change rate ≠ proficiency | ✅/N/A | Product does not ship acceptance-rate skill scores. Keep it that way. |
| 6 | Post-merge durability is better | ⬜ | Sprint 4 |
| 7 | Buyers need cost, capability, outcomes | ◑ | Profile/opportunity fields exist; buyer search + invitation flow incomplete. |
| 8 | Sellers need clear payoff | ⬜ | Sprint 5 — opportunity CTAs with compensation/scope required |
| 9 | Privacy allowlist needs adversarial suite | ◑ | Allowlist publish + secret scan + leakage corpus. Expand fixtures per commenter list. |
| 10 | Key rotation/revocation historical states | ◑ | Revocation list + key history files exist; UI states for historical vs revoked incomplete. |
| 11 | Benchmarks only within scope | ⬜ | No universal score; assessments not built |
| 12 | Existing tools as adapters | ⬜ | Claude-Code-Usage-Monitor / AgentRail as evidence sources |

## Sprint order (keep)

1. **Seamless publication** — ✅ vertical slice (this branch)
2. **Evidence authority** — ◑ model + copy; schema emission remaining
3. **Privacy hardening** — expand adversarial fixtures, exact preview already in join wizard
4. **Outcomes / durability** — post-merge survival evidence (not a quality score)
5. **Marketplace validation** — paid invitation pilot with required compensation fields

## Highest-value feedback (do not dilute)

1. Claim authority must never exceed underlying evidence.
2. Signatures prove integrity, not truthful collection.
3. Post-merge durability > diff acceptance (when built).
4. Onboarding/publication friction kills adoption.
5. Token volume currently dominates perception.

## Reddit strategy (marketing, not code)

- One question per community; stop identical broad pitch.
- Link hierarchy: example profile → methodology/repo → join as technical alpha.
- Prefer: signed activity record, collector-observed, third-party-confirmed.
- Avoid: verified AI worker/expert, objective expertise score.
- Narrow CTAs: threat model, evidence boundaries, sanitizer, buyer decision, onboarding failure report.

## Watch

A recurring Reddit watch for new TOKENS posts/comments would close indexing gaps
(public profile hides posts). Product backlog should be updated from that feed,
not from memory of a single launch week.
