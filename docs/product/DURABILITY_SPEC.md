# Post-merge durability — specification (roadmap)

**Status: specified, not built.** No durability metric is published today. This
document defines it precisely so that when it ships it cannot overclaim.

## Why this replaces "acceptance rate"

Acceptance rate — how often a person accepts an AI's first draft — is a **workflow
behavior, not a skill**. A high acceptance rate can mean fluency; it can equally
mean laziness or over-trust. Measuring it would reward the wrong thing.

The honest question is not *did they accept the diff* but **did the AI-assisted
work survive and keep working**. This spec measures survival and performance of
changes after they land.

> Principle: measure whether AI-assisted work survives and performs, not whether
> the user accepted the first draft. TOKENS publishes no acceptance rate. If one
> is ever shown, it must be labeled *workflow behavior, not skill*.

## Metrics

Computed per AI-attributed change (see Attribution), over windows of **7 and 30
days** after merge:

| Metric | Definition |
| --- | --- |
| Survival | % of AI-touched lines still present, unmodified, after 7 / 30 days |
| Rewrite rate | % of those lines subsequently rewritten |
| Reverts | change was reverted (git revert / force-drop) within the window |
| Hotfixes | a follow-up commit tagged/detected as a hotfix touching the same lines |
| Bug-linked follow-ups | later commits that reference an issue and touch the change |
| Emergency patches | out-of-band commits (off-hours, expedited) touching the change |
| Attributable churn | added+deleted lines in follow-ups traceable to the original change |
| Corrective vs. ordinary | distinguish rework that fixes the change from routine refactoring/feature evolution |

The corrective-vs-ordinary distinction is the hard part and is treated as
**best-effort with stated confidence**, never as ground truth. Heuristics
(commit-message classification, proximity in time, issue links, author overlap)
are disclosed; a refactor that merely moves code is not counted as corrective
rework.

## Attribution

A change is "AI-attributed" only via evidence the collector can actually observe:
a session that produced a diff, or an imported VCS record linking a commit to an
AI-assisted session. Attribution confidence is published per change. No attribution
is inferred from mere time-correlation.

## Data model (planned)

A `durability` table in the local ledger keyed by commit/patch id: first-seen,
merge time, per-window survival/churn/revert/hotfix counts, attribution
confidence, and the classification heuristic used. Recomputed incrementally as
git history advances (fits the existing checkpointed-scan model).

## Claim authority

Durability registers in the claim-authority ladder (`/claims`,
`post-merge-durability`) as:

- **Allowed claim:** *a landed change survived N days without revert, rewrite, or
  hotfix.*
- **Establishes:** persistence over the measured window; absence of corrective
  rework in that window.
- **Does NOT establish:** identity, authorship, permission, expertise, quality,
  causation, business impact, *that the author is skilled*, or *that stability was
  caused by the change*.

Durability is correlational. Survival is evidence a change held up; it is not proof
the person is good, and it never feeds a universal score.

## Honesty constraints

1. Never present durability as a skill or employability score.
2. Always publish attribution confidence and the corrective-classification method.
3. A short window with no reverts is weak evidence; label windows explicitly.
4. Absence of follow-ups can mean stability *or* abandonment — disclose which
   cannot be distinguished.
