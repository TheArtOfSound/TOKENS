import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { selectGitHubCliInstallPlan } from '../githubCliSetup';

describe('simplified directory enrollment', () => {
  const setup = readFileSync(path.resolve('collector/listMeSetup.ts'), 'utf8');
  const packageJson = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };

  it('routes the public command through guided setup', () => {
    expect(packageJson.scripts?.['list-me']).toBe('tsx collector/listMeSetup.ts');
    expect(packageJson.scripts?.['list-me:core']).toBe('tsx collector/listMe.ts');
  });

  it('selects Windows Package Manager on Windows', () => {
    const plan = selectGitHubCliInstallPlan('win32', new Set(['winget.exe']));
    expect(plan).toMatchObject({
      label: 'Windows Package Manager',
      file: 'winget.exe',
      requiresElevation: false,
    });
    expect(plan?.args).toContain('GitHub.cli');
  });

  it('selects Homebrew on macOS', () => {
    expect(selectGitHubCliInstallPlan('darwin', new Set(['brew']))).toEqual({
      label: 'Homebrew',
      file: 'brew',
      args: ['install', 'gh'],
      requiresElevation: false,
    });
  });

  it.each([
    ['apt-get', 'APT', 'gh'],
    ['dnf', 'DNF', 'gh'],
    ['yum', 'YUM', 'gh'],
    ['pacman', 'Pacman', 'github-cli'],
    ['zypper', 'Zypper', 'gh'],
    ['apk', 'APK', 'github-cli'],
    ['brew', 'Homebrew on Linux', 'gh'],
  ])('selects %s on Linux', (command, label, packageName) => {
    const plan = selectGitHubCliInstallPlan('linux', new Set([command]));
    expect(plan?.label).toBe(label);
    expect(plan?.file).toBe(command);
    expect(plan?.args).toContain(packageName);
  });

  it('fails closed when no supported package manager exists', () => {
    expect(selectGitHubCliInstallPlan('linux', new Set())).toBeNull();
  });

  it('opens browser authentication and continues automatically', () => {
    expect(setup).toContain("'auth', 'login'");
    expect(setup).toContain("'--web'");
    expect(setup).toContain("await import('./listMe')");
    expect(setup).not.toContain('profiles/index.json');
    expect(setup).not.toContain('Paste it into');
  });

  it('keeps installation and authentication explicitly approved', () => {
    expect(setup).toContain('Type "yes" to continue');
    expect(setup).toContain('Install it with ${plan.label}?');
    expect(setup).toContain('Open GitHub sign-in now?');
  });
});
