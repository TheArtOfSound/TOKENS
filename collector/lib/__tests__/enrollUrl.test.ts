/**
 * Guard against the worst bug this feature can have.
 *
 * The first version of listMe.ts defaulted every member's registry entry to
 * `${SITE_ORIGIN}/data/latest.json` — the OPERATOR's snapshot. Member #2 would
 * have joined the directory displaying somebody else's measured record under
 * their own name, signed by somebody else's key, and the site would have
 * verified it happily because the signature was genuine — just not theirs.
 *
 * It shipped because every test used the operator's own machine, where that URL
 * happens to be correct. These tests read the source directly, because the bug
 * was a default value rather than a behaviour any unit test was exercising.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = readFileSync(path.join(__dirname, '..', '..', 'listMe.ts'), 'utf8');

describe('enrollment never points a member at someone else’s snapshot', () => {
  it('does not template SITE_ORIGIN into a snapshotUrl', () => {
    expect(SRC).not.toMatch(/snapshotUrl:\s*`\$\{SITE_ORIGIN\}/);
  });

  it('resolves the snapshot URL per member', () => {
    expect(SRC).toMatch(/function resolveSnapshotUrl\(/);
    expect(SRC).toMatch(/entry\.snapshotUrl = resolveSnapshotUrl\(/);
  });

  it('prefers an explicitly declared URL over publishing a copy', () => {
    expect(SRC).toMatch(/identity\.snapshotUrl/);
  });

  it('falls back to the member’s OWN repo, not the site', () => {
    expect(SRC).toMatch(/raw\.githubusercontent\.com\/\$\{login\}\//);
  });

  it('sends the current blob sha when updating an existing snapshot', () => {
    // A PUT without it is rejected by the API; overwriting blindly loses history.
    expect(SRC).toMatch(/sha \? \['-f', `sha=\$\{sha\}`\] : \[\]/);
  });
});
