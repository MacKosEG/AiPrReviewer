import type { FileDiff } from '../types.js';

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Prefixes each patch line with its line number in the new file, so the model can
 * cite accurate `line` values. Removed lines get a blank number column.
 */
export function annotatePatch(patch: string): string {
  const out: string[] = [];
  let newLine = 0;
  for (const line of patch.split('\n')) {
    const h = HUNK.exec(line);
    if (h) {
      newLine = Number(h[2]);
      out.push(line);
      continue;
    }
    if (line.startsWith('-') || line.startsWith('\\')) {
      out.push(`      ${line}`);
    } else {
      out.push(`${String(newLine).padStart(5)} ${line}`);
      newLine++;
    }
  }
  return out.join('\n');
}

export function fileHeader(file: FileDiff): string {
  const rename = file.previousPath ? ` (renamed from ${file.previousPath})` : '';
  return `### FILE: ${file.path} [${file.status}${rename}] +${file.additions}/-${file.deletions}`;
}

export function formatFile(file: FileDiff, patch = file.patch ?? ''): string {
  return `${fileHeader(file)}\n${annotatePatch(patch)}\n`;
}
