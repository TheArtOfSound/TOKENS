/**
 * AI-evaluable evidence export (Markdown).
 *
 * Reddit suggestion: produce a single Markdown dossier any AI (or human
 * reviewer) can evaluate covering projects, practice, activity, and claim
 * boundaries — without dumping prompts or secrets.
 *
 * Written next to the signed snapshot as public/data/agent-evidence.md.
 */

import type { PublishedSnapshot } from './publish';
import type { TelemetryBlock } from './telemetry';

function mdEscape(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/[<>]/g, (c) => {
    if (c === '<') return '&lt;';
    if (c === '>') return '&gt;';
    return c;
  });
}

function bulletList(items: string[] | undefined, empty = '_None declared._'): string {
  if (!items?.length) return empty;
  return items.map((item) => `- ${mdEscape(item)}`).join('\n');
}

export function renderAgentEvidenceMarkdown(
  snapshot: PublishedSnapshot,
  opts: { profileUrl?: string; telemetry?: TelemetryBlock | null } = {},
): string {
  const profile = snapshot.profile;
  const identity = profile?.identity;
  const activity = profile?.activity;
  const work = profile?.work;
  const practice = (profile as { practice?: {
    tokenEfficiencyArchitecture?: string[];
    contextInjectionSystems?: string[];
    problemFocus?: string[];
    leveragePatterns?: string[];
    operatingCostNote?: string | null;
    valueDeliveredNote?: string | null;
    note?: string;
  } } | undefined)?.practice;
  const efficiency = profile?.efficiency;
  const opportunity = profile?.opportunity;
  const telemetry = opts.telemetry ?? (snapshot as { telemetry?: TelemetryBlock }).telemetry;
  const claim = snapshot.claimAuthority;

  const lines: string[] = [];
  lines.push('# Agent work evidence dossier');
  lines.push('');
  lines.push('> Machine-readable, claim-bounded export for human or AI evaluation.');
  lines.push('> Raw prompts, code, responses, credentials, and file paths are **not** included.');
  lines.push('');
  lines.push(`- **Generated at:** ${snapshot.generatedAt}`);
  lines.push(`- **Collector:** ${snapshot.collectorVersion}`);
  lines.push(`- **Timezone:** ${snapshot.timezone}`);
  lines.push(`- **Sample data:** ${snapshot.isSampleData ? 'yes' : 'no'}`);
  if (opts.profileUrl) lines.push(`- **Live profile:** ${opts.profileUrl}`);
  lines.push(`- **Snapshot hash:** \`${snapshot.verification.snapshotSha256 ?? 'unsigned'}\``);
  lines.push('');

  lines.push('## Identity (self-submitted)');
  lines.push('');
  if (identity) {
    lines.push(`- **Name:** ${mdEscape(identity.displayName)}`);
    lines.push(`- **Headline:** ${mdEscape(identity.headline)}`);
    if (identity.location) lines.push(`- **Location:** ${mdEscape(identity.location)}`);
    if (identity.availability) lines.push(`- **Availability:** ${mdEscape(identity.availability)}`);
    if (identity.bio) {
      lines.push('');
      lines.push(mdEscape(identity.bio));
    }
    if (identity.workCategories?.length) {
      lines.push('');
      lines.push('**Work categories:**');
      lines.push(bulletList(identity.workCategories));
    }
    if (identity.links?.length) {
      lines.push('');
      lines.push('**Links:**');
      for (const link of identity.links) {
        lines.push(`- [${mdEscape(link.label)}](${link.url})`);
      }
    }
  } else {
    lines.push('_No identity block published._');
  }
  lines.push('');

  lines.push('## How to evaluate this dossier');
  lines.push('');
  lines.push('1. Treat **activity** as practice evidence, not skill or IQ.');
  lines.push('2. Treat **work artifacts** as stronger when `collector_observed`, weaker when self-reported.');
  lines.push('3. Treat **practice / architecture / problem focus** as self-declared unless separately proven.');
  lines.push('4. Treat **outcomes and value notes** as self-reported until third-party confirmed.');
  lines.push('5. A valid device signature proves **integrity of published bytes + key possession**, not honesty of collection.');
  lines.push('6. There is **no universal AI score** in this system.');
  lines.push('');

  lines.push('## Measured activity');
  lines.push('');
  if (activity) {
    lines.push(`- Active AI-work days: **${activity.activeDays}**`);
    lines.push(`- Span: ${activity.firstActiveDate ?? '?'} → ${activity.lastActiveDate ?? '?'} (${activity.spanDays} days)`);
    lines.push(`- Last 30 / 90 days active: ${activity.activeDaysLast30} / ${activity.activeDaysLast90}`);
    lines.push(`- Current / longest streak (days): ${activity.currentStreakDays} / ${activity.longestStreakDays}`);
    lines.push(`- Tools: ${(activity.toolsUsed ?? []).join(', ') || 'n/a'}`);
    lines.push(`- Models (sample): ${(activity.modelsUsed ?? []).slice(0, 12).join(', ') || 'n/a'}`);
    lines.push(`- Projects active (collector-observed locally): ${activity.projectsActive}`);
  } else {
    lines.push('_No activity block._');
  }
  lines.push('');
  lines.push(`Exact total tokens (provider-reported sums): **${snapshot.measurement?.exactTotalTokens ?? snapshot.totals.totalTokens}**`);
  lines.push('');
  lines.push('_Token volume is evidence of activity, not expertise, productivity, efficiency, or professional value._');
  lines.push('');

  lines.push('## Efficiency architecture (measured signals)');
  lines.push('');
  if (efficiency) {
    if (efficiency.cachedSharePct != null) lines.push(`- Cache reuse share: **${efficiency.cachedSharePct}%**`);
    if (efficiency.freshSharePct != null) lines.push(`- Fresh token share: **${efficiency.freshSharePct}%**`);
    if (efficiency.outputSharePct != null) lines.push(`- Output share of in+out: **${efficiency.outputSharePct}%**`);
    if (efficiency.avgTokensPerActiveDay != null) {
      lines.push(`- Avg tokens / active day: **${efficiency.avgTokensPerActiveDay}**`);
    }
    if (efficiency.note) lines.push('');
    if (efficiency.note) lines.push(mdEscape(efficiency.note));
  } else {
    lines.push('_No efficiency block._');
  }
  lines.push('');

  lines.push('## Token efficiency architecture (self-declared)');
  lines.push('');
  lines.push(bulletList(practice?.tokenEfficiencyArchitecture));
  lines.push('');

  lines.push('## Context injection systems (self-declared)');
  lines.push('');
  lines.push(bulletList(practice?.contextInjectionSystems));
  lines.push('');

  lines.push('## Problem focus (self-declared)');
  lines.push('');
  lines.push(bulletList(practice?.problemFocus));
  lines.push('');

  lines.push('## Leverage patterns (self-declared)');
  lines.push('');
  lines.push(bulletList(practice?.leveragePatterns));
  lines.push('');

  lines.push('## Business value framing');
  lines.push('');
  lines.push('### Operating cost');
  lines.push('');
  if (opportunity?.computeCostRange) lines.push(`- Compute profile: ${mdEscape(opportunity.computeCostRange)}`);
  if (practice?.operatingCostNote) lines.push(`- Note: ${mdEscape(practice.operatingCostNote)}`);
  if (opportunity?.compensation) lines.push(`- Stated compensation preference: ${mdEscape(opportunity.compensation)}`);
  if (!opportunity?.computeCostRange && !practice?.operatingCostNote) {
    lines.push('_No operating-cost notes published._');
  }
  lines.push('');
  lines.push('### Value delivered');
  lines.push('');
  if (practice?.valueDeliveredNote) lines.push(mdEscape(practice.valueDeliveredNote));
  if (work?.outcomes?.length) {
    lines.push('');
    for (const o of work.outcomes) {
      lines.push(`- **${mdEscape(o.title)}** (${o.verification})${o.metric ? ` — ${mdEscape(o.metric)}` : ''}`);
      if (o.description) lines.push(`  - ${mdEscape(o.description)}`);
    }
  } else if (!practice?.valueDeliveredNote) {
    lines.push('_No outcomes or value notes yet — outcomes require explicit member entry and remain self-reported until third-party confirmed._');
  }
  lines.push('');

  lines.push('## Connected projects & work artifacts');
  lines.push('');
  if (work?.artifacts?.length) {
    for (const a of work.artifacts) {
      const link = a.url ? ` — ${a.url}` : '';
      lines.push(`### ${mdEscape(a.title)}`);
      lines.push('');
      lines.push(`- Type: ${a.type}`);
      lines.push(`- Verification: **${a.verification}**`);
      if (a.linkedProject) lines.push(`- Linked local project: ${mdEscape(a.linkedProject)}`);
      if (a.period) lines.push(`- Period: ${mdEscape(a.period)}`);
      if (a.description) lines.push(`- ${mdEscape(a.description)}`);
      if (link) lines.push(`- URL:${link}`);
      if (a.basis) lines.push(`- Basis: ${mdEscape(a.basis)}`);
      lines.push('');
    }
  } else {
    lines.push('_No work artifacts published._');
    lines.push('');
  }

  if (snapshot.qiraProjects?.length) {
    lines.push('## Collector-observed local projects (allowlisted names only)');
    lines.push('');
    for (const p of snapshot.qiraProjects) {
      lines.push(`- **${mdEscape(p.name)}** — found=${p.found}, status=${mdEscape(p.status)}${p.publicUrl ? `, url=${p.publicUrl}` : ''}`);
      if (p.description) lines.push(`  - ${mdEscape(p.description)}`);
    }
    lines.push('');
  }

  lines.push('## Agent operation telemetry (sanitized hierarchy)');
  lines.push('');
  if (telemetry && telemetry.totalEvents > 0) {
    lines.push(`- Total usage events: **${telemetry.totalEvents}**`);
    lines.push(`- Distinct sessions (local pseudonyms, count only): **${telemetry.sessions.distinctSessions}**`);
    if (telemetry.sessions.medianEventsPerSession != null) {
      lines.push(`- Median events / session: ${telemetry.sessions.medianEventsPerSession}`);
    }
    if (telemetry.sessions.p95EventsPerSession != null) {
      lines.push(`- p95 events / session: ${telemetry.sessions.p95EventsPerSession}`);
    }
    if (telemetry.sessions.medianInterEventSeconds != null) {
      lines.push(`- Median inter-event gap (s, ≤1h): ${telemetry.sessions.medianInterEventSeconds}`);
    }
    lines.push('');
    lines.push('### Hierarchy: provider → model');
    lines.push('');
    for (const node of telemetry.hierarchy) {
      lines.push(`- **${node.provider}**: ${node.events} events, ${node.sessions} sessions, ${node.totalTokens} tokens`);
      for (const m of node.models.slice(0, 12)) {
        lines.push(`  - ${mdEscape(m.model)}: ${m.events} events, ${m.sessions} sessions`);
      }
    }
    lines.push('');
    lines.push(mdEscape(telemetry.note));
    lines.push('');
    lines.push('**Limitations:**');
    lines.push(bulletList(telemetry.limitations));
    lines.push('');
    lines.push('**Does not establish:**');
    lines.push(bulletList(telemetry.doesNotEstablish));
  } else {
    lines.push('_Telemetry summary not available (ledger empty or not sourced)._');
  }
  lines.push('');

  lines.push('## Claim authority (what badges may and may not claim)');
  lines.push('');
  if (claim) {
    lines.push(mdEscape(claim.note));
    lines.push('');
    lines.push(`- Claim ladder shape — ${mdEscape(claim.model)}`);
    lines.push(`- Combined rule — ${mdEscape(claim.combinedAuthorityRule)}`);
    if (claim.universalNonClaims?.length) {
      lines.push('');
      lines.push('**Universal non-claims:**');
      lines.push(bulletList(claim.universalNonClaims));
    }
    lines.push('');
    for (const s of claim.signals.filter((x) => x.present).slice(0, 16)) {
      lines.push(`### ${mdEscape(s.badgeLabel)} (\`${s.signalType}\`)`);
      lines.push('');
      lines.push(`- Tier: ${s.tier} · Provenance: ${s.provenance} · Confidence: ${s.confidence}`);
      lines.push(`- Explains: ${mdEscape(s.explains)}`);
      if (s.allowedClaims?.length) lines.push(`- Allowed: ${s.allowedClaims.join(', ')}`);
      if (s.excludedClaims?.length) lines.push(`- Excluded: ${s.excludedClaims.join(', ')}`);
      lines.push('');
    }
  } else {
    lines.push('_No claimAuthority block on this snapshot._');
    lines.push('');
  }

  lines.push('## Integrity');
  lines.push('');
  lines.push(`- Schema: ${snapshot.verification.schemaVersion}`);
  lines.push(`- Proves: ${mdEscape(snapshot.verification.proves ?? '')}`);
  lines.push(`- Raw logs published: ${snapshot.verification.rawLogsPublished}`);
  if (snapshot.integrity) {
    lines.push(`- Integrity flags: ${snapshot.integrity.flags}`);
    for (const c of snapshot.integrity.checks) {
      lines.push(`  - [${c.status}] ${mdEscape(c.name)} — ${mdEscape(c.detail)}`);
    }
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('_End of dossier. Prefer the live signed JSON at `/data/latest.json` for cryptographic verification._');
  lines.push('');

  return lines.join('\n');
}
