import { describe, expect, it } from 'vitest';
import { isSafeString, scanForProhibited } from '../secretScan';
import adversarial from '../../fixtures/adversarial-secrets.json';

describe('scanForProhibited', () => {
  it('flags every planted secret / path / PII value in the adversarial fixture', () => {
    for (const [name, value] of Object.entries(adversarial.prohibited)) {
      const findings = scanForProhibited(value);
      expect(findings.length, `expected "${name}" to be flagged`).toBeGreaterThan(0);
    }
  });

  it('does not flag legitimate clean values (models, domains, warning codes)', () => {
    for (const [name, value] of Object.entries(adversarial.clean)) {
      expect(isSafeString(value as string), `expected "${name}" to be clean`).toBe(true);
    }
  });

  it('finds secrets nested in arrays and objects, with a path to the location', () => {
    const findings = scanForProhibited({ a: { b: ['ok', '/Users/bry/secret/app.ts'] } });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('$.a.b[1]');
    expect(findings[0].label).toBe('macOS user path');
  });

  it('flags secrets that appear as OBJECT KEYS, not just values', () => {
    const findings = scanForProhibited({ '/Users/bry/leak': 1 });
    expect(findings.some((f) => f.label === 'macOS user path')).toBe(true);
  });

  it('never leaks the raw secret into the finding excerpt', () => {
    const findings = scanForProhibited('sk-ant-api03-REALLOOKINGSECRET1234567890');
    expect(findings[0].excerpt).not.toContain('REALLOOKINGSECRET');
  });

  it('decodes base64-encoded secrets and flags them', () => {
    const encoded = Buffer.from('sk-ant-api03-encodedSecretValue1234567890').toString('base64');
    const findings = scanForProhibited(encoded);
    expect(findings.some((f) => f.path.includes('<base64>'))).toBe(true);
  });

  it('flags disallowed control characters', () => {
    const findings = scanForProhibited(`bad${String.fromCharCode(0)}value`);
    expect(findings.some((f) => f.label === 'control character')).toBe(true);
  });

  it('treats a well-formed https URL as clean (not an email)', () => {
    expect(isSafeString('https://mydigital.imagineqira.com/pricing')).toBe(true);
  });
});
