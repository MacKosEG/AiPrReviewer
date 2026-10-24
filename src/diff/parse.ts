import type { FileDiff, FileStatus } from '../types.js';

const DIFF_GIT = /^diff --git a\/(.+?) b\/(.+)$/;

interface Draft {
  path: string;
  previousPath?: string;
  status: FileStatus;
  binary: boolean;
  lines: string[];
  inHunks: boolean;
}

function stripPrefix(p: string): string | undefined {
  const trimmed = p.replace(/\t.*$/, '').trim();
  if (trimmed === '/dev/null') return undefined;
  return trimmed.replace(/^[ab]\//, '');
}

function finish(d: Draft): FileDiff {
  const patch = d.lines.length > 0 ? d.lines.join('\n') : undefined;
  let additions = 0;
  let deletions = 0;
  for (const line of d.lines) {
    if (line.startsWith('+')) additions++;
    else if (line.startsWith('-')) deletions++;
  }
  const file: FileDiff = { path: d.path, status: d.status, additions, deletions };
  if (d.previousPath && d.previousPath !== d.path) file.previousPath = d.previousPath;
  if (d.binary) file.binary = true;
  else if (patch !== undefined) file.patch = patch;
  return file;
}

/**
 * Parses a unified diff (as produced by `git diff` / GitHub `.diff`) into per-file entries.
 * The `patch` of each entry starts at the first hunk header, matching the GitHub API format.
 */
export function parseUnifiedDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let cur: Draft | undefined;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const hasGitHeaders = lines.some((l) => DIFF_GIT.test(l));

  const start = (path: string, previousPath?: string): Draft => {
    if (cur) files.push(finish(cur));
    const d: Draft = { path, status: 'modified', binary: false, lines: [], inHunks: false };
    if (previousPath !== undefined) d.previousPath = previousPath;
    cur = d;
    return d;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const git = DIFF_GIT.exec(line);
    if (git) {
      start(git[2] ?? '', git[1]);
      continue;
    }

    // Plain unified diff without a `diff --git` header.
    if (
      !hasGitHeaders &&
      line.startsWith('--- ') &&
      (lines[i + 1] ?? '').startsWith('+++ ') &&
      (!cur || cur.inHunks)
    ) {
      const oldPath = stripPrefix(line.slice(4));
      const newPath = stripPrefix((lines[i + 1] ?? '').slice(4));
      const d = start(newPath ?? oldPath ?? 'unknown', oldPath);
      if (!oldPath) d.status = 'added';
      if (!newPath) d.status = 'removed';
      i++;
      continue;
    }

    if (!cur) continue;

    if (!cur.inHunks) {
      if (line.startsWith('new file mode')) cur.status = 'added';
      else if (line.startsWith('deleted file mode')) cur.status = 'removed';
      else if (line.startsWith('rename from '))
        cur.previousPath = line.slice('rename from '.length);
      else if (line.startsWith('rename to ')) {
        cur.path = line.slice('rename to '.length);
        cur.status = 'renamed';
      } else if (line.startsWith('copy to ')) cur.status = 'copied';
      else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch'))
        cur.binary = true;
      else if (line.startsWith('--- ')) {
        const oldPath = stripPrefix(line.slice(4));
        if (!oldPath) cur.status = 'added';
      } else if (line.startsWith('+++ ')) {
        const newPath = stripPrefix(line.slice(4));
        if (!newPath) cur.status = 'removed';
        else cur.path = newPath;
      } else if (line.startsWith('@@')) {
        cur.inHunks = true;
        cur.lines.push(line);
      }
      continue;
    }

    if (cur.binary) continue;
    if (
      line.startsWith('@@') ||
      line.startsWith('+') ||
      line.startsWith('-') ||
      line.startsWith(' ') ||
      line.startsWith('\\')
    ) {
      cur.lines.push(line);
    } else if (line === '' && i < lines.length - 1) {
      // Some tools strip the trailing space of empty context lines.
      cur.lines.push(' ');
    }
  }
  if (cur) files.push(finish(cur));
  return files;
}
