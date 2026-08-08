/**
 * Multi-provider registry for the Ledger collector.
 *
 * Historically only Claude Code and Codex were first-class. Members also work
 * in Grok, Kimi, Gemini, Copilot, and many other agent CLIs. This module is the
 * single place that names those sources so collect, consent, normalize, and
 * publish all agree.
 *
 * Two collection paths:
 *   1. ccusage CLI  — application-reported daily aggregates (many agents).
 *   2. Local adapters — event-level JSONL (claude, codex, grok, kimi today).
 *
 * Provider ids are stable lowercase slugs. Unknown free-form strings are
 * accepted only after sanitization so a hostile export cannot inject paths.
 */

/** Valid provider slug: short, path-free, filesystem-safe. */
const PROVIDER_SLUG_RE = /^[a-z][a-z0-9_-]{0,39}$/;

/**
 * Open provider type. Known constants live in KNOWN_PROVIDERS; any valid slug
 * is allowed so imports and future adapters do not require a type bump.
 */
export type Provider = string;

/** Agents that `ccusage <name> daily --json` can report. */
export const CCUSAGE_AGENTS = [
  'claude',
  'codex',
  'opencode',
  'amp',
  'droid',
  'codebuff',
  'hermes',
  'pi',
  'goose',
  'kilo',
  'copilot',
  'gemini',
  'kimi',
  'qwen',
  'openclaw',
] as const;

export type CcusageAgent = (typeof CCUSAGE_AGENTS)[number];

/** Local adapters (event-level), including sources ccusage does not cover. */
export const LOCAL_ADAPTER_PROVIDERS = ['claude', 'codex', 'grok', 'kimi'] as const;

export type LocalAdapterProvider = (typeof LOCAL_ADAPTER_PROVIDERS)[number];

/** Union of every provider we know by name (display, consent, confidence). */
export const KNOWN_PROVIDERS = [
  ...CCUSAGE_AGENTS,
  'grok', // Grok Build / xAI local sessions (~/.grok)
  'openai',
  'chatgpt',
  'cursor',
  'unknown',
] as const;

export type KnownProvider = (typeof KNOWN_PROVIDERS)[number];

const DISPLAY_NAMES: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  amp: 'Amp',
  droid: 'Droid',
  codebuff: 'Codebuff',
  hermes: 'Hermes',
  pi: 'pi-agent',
  goose: 'Goose',
  kilo: 'Kilo',
  copilot: 'GitHub Copilot CLI',
  gemini: 'Gemini CLI',
  kimi: 'Kimi',
  qwen: 'Qwen',
  openclaw: 'OpenClaw',
  grok: 'Grok',
  openai: 'OpenAI',
  chatgpt: 'ChatGPT',
  cursor: 'Cursor',
  unknown: 'Unknown',
};

/** Consent/source toggles that gate reads (not project scan). */
export const MEASURED_SOURCE_KEYS = [
  'claude',
  'codex',
  'kimi',
  'gemini',
  'grok',
  'opencode',
  'amp',
  'droid',
  'codebuff',
  'hermes',
  'pi',
  'goose',
  'kilo',
  'copilot',
  'qwen',
  'openclaw',
] as const;

export type MeasuredSourceKey = (typeof MEASURED_SOURCE_KEYS)[number];

export function isValidProviderSlug(value: string): boolean {
  return PROVIDER_SLUG_RE.test(value) && !value.includes('/') && !value.includes('\\');
}

/**
 * Coerce an arbitrary label into a provider slug, or null if unusable.
 * Does not invent providers — empty/garbage input becomes null.
 */
export function sanitizeProvider(value: unknown, fallback?: Provider): Provider | null {
  if (typeof value === 'string') {
    const raw = value.trim();
    // Reject path-shaped or traversal-shaped labels before stripping.
    if (!raw || raw.includes('/') || raw.includes('\\') || raw.includes('..')) {
      /* fall through to fallback */
    } else {
      const slug = raw
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9_-]/g, '')
        .slice(0, 40);
      if (isValidProviderSlug(slug)) return slug;
    }
  }
  if (fallback && isValidProviderSlug(fallback)) return fallback;
  return null;
}

export function providerDisplayName(provider: Provider): string {
  return DISPLAY_NAMES[provider] ?? provider.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function isCcusageAgent(provider: string): provider is CcusageAgent {
  return (CCUSAGE_AGENTS as readonly string[]).includes(provider);
}

export function isMeasuredSourceKey(provider: string): provider is MeasuredSourceKey {
  return (MEASURED_SOURCE_KEYS as readonly string[]).includes(provider);
}

/** Default confidence notes for ledger-sourced rows. */
export function defaultProviderConfidence(provider: Provider): {
  confidence: 'high' | 'medium';
  note: string;
} {
  if (provider === 'claude') {
    return {
      confidence: 'high',
      note: 'Event-level, deduplicated by provider message id. Reconciles closely to ccusage.',
    };
  }
  if (provider === 'codex') {
    return {
      confidence: 'medium',
      note: 'Event-level. Codex can re-emit turn usage; totals may overstate by up to ~7%.',
    };
  }
  if (provider === 'grok') {
    return {
      confidence: 'high',
      note: 'Session-final usage from local Grok Build updates.jsonl (one event per session).',
    };
  }
  if (provider === 'kimi') {
    return {
      confidence: 'high',
      note: 'Turn-scoped usage from local Kimi wire.jsonl (StatusUpdate / usage.record).',
    };
  }
  if (isCcusageAgent(provider)) {
    return {
      confidence: 'medium',
      note: `Daily aggregates from ccusage ${provider} (application-reported, not event-level).`,
    };
  }
  return {
    confidence: 'medium',
    note: 'Provider-reported or imported usage for this source.',
  };
}
