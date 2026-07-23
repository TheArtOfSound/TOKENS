import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import schema from '../../schema/canonical-snapshot.schema.json';
import { publishSnapshot, type DraftSnapshot } from '../publish';
import { assembleDraft } from '../snapshot';
import claudeSample from '../../fixtures/ccusage-claude-daily.sample.json';
import codexSample from '../../fixtures/ccusage-codex-daily.sample.json';

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

function publishedFixture() {
  const draft = assembleDraft({
    sources: [
      { provider: 'claude', json: claudeSample },
      { provider: 'codex', json: codexSample },
    ],
    generatedAt: '2026-07-23T12:00:00.000Z',
    timezone: 'America/Phoenix',
    qiraProjects: [
      {
        name: 'TOKENS',
        category: 'Proof Infrastructure',
        status: 'instrumented',
        description: 'Public AI-agent usage observatory.',
        found: true,
        git: { branch: 'main', commit: 'c7154ba', changedFiles: 0 },
        stack: ['Vite', 'TypeScript'],
        scripts: ['build', 'collect'],
        fileCounts: { ts: 12 },
        lastModified: '2026-07-23T00:00:00.000Z',
        scannerWarnings: [],
      },
    ],
    scanner: { rootsChecked: 5, allowlistedProjects: 8, foundProjects: 1, privacyMode: 'allowlist_no_paths' },
    gitCommit: null,
  }).draft;
  return publishSnapshot(draft).published;
}

describe('canonical snapshot JSON Schema', () => {
  it('accepts a snapshot produced by the publication pipeline', () => {
    const ok = validate(publishedFixture());
    if (!ok) console.error(validate.errors);
    expect(ok).toBe(true);
  });

  it('rejects a snapshot missing a required top-level field', () => {
    const bad = publishedFixture() as unknown as Record<string, unknown>;
    delete bad.totals;
    expect(validate(bad)).toBe(false);
  });

  it('rejects a snapshot with an unknown top-level field (allowlist)', () => {
    const bad = { ...publishedFixture(), sneaky: 'extra' };
    expect(validate(bad)).toBe(false);
  });

  it('rejects an unknown measurementClass value', () => {
    const bad = publishedFixture();
    bad.measurement.classes.inputTokens.measurementClass = 'totally_made_up' as never;
    expect(validate(bad)).toBe(false);
  });
});
