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
| 2 | Every signal needs claim boundaries | ✅ | `claimAuthority` on published snapshots; EvidenceBadge on profile/directory; `/claims` ladder. |
| 3 | Signature language overstates trust | ✅ | Device-signed badges; integrity ≠ honesty on profile, directory, evidence notes. |
| 4 | Publication too complicated | ✅ | `/join` wizard + `publish/` service (Sprint 1 vertical slice). Desktop installers still ⬜. |
| 5 | Accepted-change rate ≠ proficiency | ✅/N/A | Product does not ship acceptance-rate skill scores. Keep it that way. |
| 6 | Post-merge durability is better | ✅ | `durability` evidence module + profile panel; no quality score; churn ≠ failure stated. |
| 7 | Buyers need cost, capability, outcomes | ✅ | Opportunity fields + invitation form requiring compensation/time/scope/data. |
| 8 | Sellers need clear payoff | ✅ | Profile invite actions + stored invitation pilot (terms required). |
| 9 | Privacy allowlist needs adversarial suite | ✅ | Expanded leakage corpus (XML, shell, git diff, session ids, prompt/response, hostname). |
| 10 | Key rotation/revocation historical states | ✅ | `historical` vs `revoked_key` vs active; history not erased. |
| 11 | Benchmarks only within scope | ⬜ | No universal score; assessments not built |
| 12 | Existing tools as adapters | ⬜ | Claude-Code-Usage-Monitor / AgentRail as evidence sources |

## Sprint order (keep)

1. **Seamless publication** — ✅ vertical slice
2. **Evidence authority** — ✅ claimAuthority + badges
3. **Privacy hardening** — ✅ adversarial corpus + key trust states
4. **Outcomes / durability** — ✅ evidence module + UI (git measurement optional at collect time)
5. **Marketplace validation** — ✅ invitation API + form (pilot; not a full marketplace)

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
