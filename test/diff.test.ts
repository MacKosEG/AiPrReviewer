import { describe, expect, it } from 'vitest';
import { applyBudget } from '../src/diff/budget.js';
import { filterNoise, noiseReason } from '../src/diff/filter.js';
import { annotatePatch, formatFile } from '../src/diff/format.js';
import { parseUnifiedDiff } from '../src/diff/parse.js';
import type { FileDiff } from '../src/types.js';
import { fixture } from './helpers.js';

describe('parseUnifiedDiff', () => {
  it('parses files, statuses and counts from a git diff', () => {
    const files = parseUnifiedDiff(fixture('good.diff'));
    expect(files.map((f) => [f.path, f.status])).toEqual([
      ['src/utils/slugify.ts', 'added'],
      ['src/utils/slugify.test.ts', 'added'],
      ['src/routes/articles.ts', 'modified'],
      ['test/routes/articles.test.ts', 'added'],
    ]);
    expect(files[0]?.additions).toBe(20);
    expect(files[0]?.deletions).toBe(0);
    expect(files[2]?.additions).toBe(8);
    expect(files[2]?.deletions).toBe(1);
    expect(files[2]?.patch?.startsWith('@@ -1,6 +1,7 @@')).toBe(true);
  });

  it('detects binary files, renames and deletions', () => {
    const diff = [
      'diff --git a/old/name.ts b/new/name.ts',
      'similarity index 90%',
      'rename from old/name.ts',
      'rename to new/name.ts',
      'index 1..2 100644',
      '--- a/old/name.ts',
      '+++ b/new/name.ts',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      'diff --git a/img.png b/img.png',
      'index 3..4 100644',
      'Binary files a/img.png and b/img.png differ',
      'diff --git a/gone.ts b/gone.ts',
      'deleted file mode 100644',
      'index 5..0',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-x',
      '-y',
      '',
    ].join('\n');
    const files = parseUnifiedDiff(diff);
    expect(files).toHaveLength(3);
    expect(files[0]).toMatchObject({
      path: 'new/name.ts',
      previousPath: 'old/name.ts',
      status: 'renamed',
    });
    expect(files[1]).toMatchObject({ path: 'img.png', binary: true });
    expect(files[1]?.patch).toBeUndefined();
    expect(files[2]).toMatchObject({ path: 'gone.ts', status: 'removed', deletions: 2 });
  });

  it('parses a plain unified diff without git headers and CRLF line endings', () => {
    const diff = '--- a/x.txt\r\n+++ b/x.txt\r\n@@ -1 +1,2 @@\r\n a\r\n+b\r\n';
    const files = parseUnifiedDiff(diff);
    expect(files).toEqual([
      {
        path: 'x.txt',
        status: 'modified',
        additions: 1,
        deletions: 0,
        patch: '@@ -1 +1,2 @@\n a\n+b',
      },
    ]);
  });
});

describe('annotatePatch', () => {
  it('prefixes context and added lines with new-file line numbers', () => {
    const out = annotatePatch('@@ -10,3 +20,3 @@ fn\n ctx\n-old\n+new\n tail').split('\n');
    expect(out[0]).toBe('@@ -10,3 +20,3 @@ fn');
    expect(out[1]).toBe('   20  ctx');
    expect(out[2]).toBe('      -old');
    expect(out[3]).toBe('   21 +new');
    expect(out[4]).toBe('   22  tail');
  });
});

describe('filterNoise', () => {
  it.each([
    ['package-lock.json', 'lockfile'],
    ['apps/web/pnpm-lock.yaml', 'lockfile'],
    ['go.sum', 'lockfile'],
    ['dist/index.js', 'generated'],
    ['web/static/app.min.js', 'generated'],
    ['src/api/__generated__/types.ts', 'generated'],
    ['src/__snapshots__/a.test.ts.snap', 'snapshot'],
    ['assets/logo.PNG', 'binary'],
    ['fonts/inter.woff2', 'binary'],
  ])('classifies %s as %s', (path, reason) => {
    expect(noiseReason({ path, status: 'modified', additions: 1, deletions: 0, patch: '@@' })).toBe(
      reason,
    );
  });

  it('keeps source files', () => {
    expect(
      noiseReason({ path: 'src/dist-utils.ts', status: 'modified', additions: 1, deletions: 0 }),
    ).toBeUndefined();
  });

  it('splits the noise fixture into filtered and kept files', () => {
    const result = filterNoise(parseUnifiedDiff(fixture('noise-only.diff')));
    expect(result.kept.map((f) => f.path)).toEqual(['README.md']);
    expect(result.filtered).toEqual([
      { path: 'package-lock.json', reason: 'lockfile' },
      { path: 'dist/index.js', reason: 'generated' },
      { path: 'src/__snapshots__/banner.test.ts.snap', reason: 'snapshot' },
      { path: 'assets/logo.png', reason: 'binary' },
    ]);
    expect(result.missingPatch).toEqual([]);
  });

  it('reports source files without a patch as missing (too large)', () => {
    const result = filterNoise([
      { path: 'src/huge.ts', status: 'modified', additions: 5000, deletions: 10 },
      {
        path: 'src/renamed.ts',
        previousPath: 'src/old.ts',
        status: 'renamed',
        additions: 0,
        deletions: 0,
      },
    ]);
    expect(result.missingPatch).toEqual(['src/huge.ts']);
    expect(result.kept).toEqual([]);
  });
});

function file(path: string, lines: number): FileDiff {
  const body = Array.from({ length: lines }, (_, i) => `+line ${i}`).join('\n');
  return {
    path,
    status: 'added',
    additions: lines,
    deletions: 0,
    patch: `@@ -0,0 +1,${lines} @@\n${body}`,
  };
}

describe('applyBudget', () => {
  it('includes everything when it fits', () => {
    const files = [file('a.ts', 3), file('b.ts', 3)];
    const r = applyBudget(files, 10_000);
    expect(r.includedFiles).toEqual(['a.ts', 'b.ts']);
    expect(r.omittedFiles).toEqual([]);
    expect(r.omittedChars).toBe(0);
    expect(r.text).toContain('### FILE: a.ts');
  });

  it('omits whole files that do not fit and keeps packing smaller ones', () => {
    const small = file('small.ts', 2);
    const big = file('big.ts', 500);
    const tail = file('tail.ts', 2);
    const limit = formatFile(small).length + formatFile(tail).length + 10;
    const r = applyBudget([small, big, tail], limit);
    expect(r.includedFiles).toEqual(['small.ts', 'tail.ts']);
    expect(r.omittedFiles).toEqual(['big.ts']);
    expect(r.omittedChars).toBe(formatFile(big).length);
    expect(r.text.length).toBeLessThanOrEqual(limit);
  });

  it('truncates the first file at a hunk boundary when it alone exceeds the budget', () => {
    const twoHunks: FileDiff = {
      path: 'x.ts',
      status: 'modified',
      additions: 2,
      deletions: 0,
      patch: `@@ -1,1 +1,2 @@\n a\n+b\n@@ -100,1 +101,${200} @@\n${'+zzzzzzzzzz\n'.repeat(200)}`,
    };
    const r = applyBudget([twoHunks, file('next.ts', 100)], 200);
    expect(r.truncatedFile).toBe('x.ts');
    expect(r.text).toContain('+b');
    expect(r.text).not.toContain('@@ -100');
    expect(r.text).toContain('[... patch truncated ...]');
    expect(r.omittedFiles).toEqual(['next.ts']);
  });
});
