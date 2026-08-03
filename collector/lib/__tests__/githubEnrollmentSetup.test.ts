import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('simplified directory enrollment', () => {
  const setup = readFileSync(path.resolve('collector/listMeSetup.ts'), 'utf8');
  const packageJson = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };

  it('routes the public command through guided setup', () => {
    expect(packageJson.scripts?.['list-me']).toBe('tsx collector/listMeSetup.ts');
    expect(packageJson.scripts?.['list-me:core']).toBe('tsx collector/listMe.ts');
  });

  it('offers automatic Windows installation rather than registry JSON editing', () => {
    expect(setup).toContain("'GitHub.cli'");
    expect(setup).toContain("'winget.exe'");
    expect(setup).toContain("'auth', 'login'");
    expect(setup).toContain("'--web'");
    expect(setup).toContain("await import('./listMe')");
    expect(setup).not.toContain('profiles/index.json');
    expect(setup).not.toContain('Paste it into');
  });

  it('keeps installation and authentication explicitly approved', () => {
    expect(setup).toContain('Type "yes" to continue');
    expect(setup).toContain('Install it automatically?');
    expect(setup).toContain('Open GitHub sign-in now?');
  });
});
