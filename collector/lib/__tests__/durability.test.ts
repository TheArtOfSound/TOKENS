import { describe, expect, it } from 'vitest';
import {
  buildDurabilityBlock,
  buildProjectDurability,
  buildWindowEvidence,
  classifyFollowUpSubject,
  countFollowUps,
} from '../durability';

describe('durability evidence — never a quality score', () => {
  it('summarizes survival without inventing a score field', () => {
    const w = buildWindowEvidence('30d', {
      introducedLines: 100,
      remainingLines: 82,
      reverts: 0,
      correctiveCommits: 1,
      hotfixes: 0,
      bugLinkedFollowUps: 0,
      failedCiAfterMerge: 0,
      filesReopened: 2,
    });
    expect(w.remainingPct).toBe(82);
    expect(w.summary).toMatch(/82%/);
    expect(w.summary).toMatch(/corrective commit/);
    expect(w.summary).toMatch(/not a quality score/i);
    expect(JSON.stringify(w)).not.toMatch(/qualityScore|skillScore|rank/i);
  });

  it('handles zero baseline honestly', () => {
    const w = buildWindowEvidence('7d', {
      introducedLines: 0,
      remainingLines: 0,
      reverts: 0,
      correctiveCommits: 0,
      hotfixes: 0,
      bugLinkedFollowUps: 0,
      failedCiAfterMerge: 0,
      filesReopened: 0,
    });
    expect(w.remainingPct).toBeNull();
    expect(w.summary).toMatch(/not measured/i);
  });

  it('classifies follow-up subjects conservatively', () => {
    expect(classifyFollowUpSubject('Revert "bad change"').revert).toBe(true);
    expect(classifyFollowUpSubject('fix: null pointer in parser').corrective).toBe(true);
    expect(classifyFollowUpSubject('hotfix payment race').hotfix).toBe(true);
    expect(classifyFollowUpSubject('Fixes #42 login').bugLinked).toBe(true);
    expect(classifyFollowUpSubject('docs: clarify README').corrective).toBe(false);
  });

  it('aggregates follow-ups into evidence counts', () => {
    const snap = countFollowUps(
      ['Revert oops', 'fix: edge case', 'feat: new button', 'hotfix prod', 'Closes #9'],
      { introduced: 50, remaining: 40 },
    );
    expect(snap.reverts).toBe(1);
    expect(snap.correctiveCommits).toBe(1);
    expect(snap.hotfixes).toBe(1);
    expect(snap.bugLinkedFollowUps).toBe(1);
    expect(snap.introducedLines).toBe(50);
    expect(snap.remainingLines).toBe(40);
  });

  it('block lists non-claims and never a universal score', () => {
    const project = buildProjectDurability({
      projectName: 'TOKENS',
      linkedArtifact: 'repo',
      measured: true,
      windows: {
        '30d': {
          introducedLines: 100,
          remainingLines: 82,
          reverts: 0,
          correctiveCommits: 1,
          hotfixes: 0,
          bugLinkedFollowUps: 0,
          failedCiAfterMerge: 0,
          filesReopened: 0,
        },
      },
    });
    const block = buildDurabilityBlock([project]);
    expect(block.doesNotEstablish).toContain('quality');
    expect(block.note).toMatch(/not a ranking/i);
    expect(block.projects[0].limitations.length).toBeGreaterThan(2);
  });
});
