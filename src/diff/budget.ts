import type { FileDiff } from '../types.js';
import { formatFile } from './format.js';

export interface BudgetResult {
  /** Diff text sent to the model. */
  text: string;
  includedFiles: string[];
  /** Files left out entirely because the budget was exhausted. */
  omittedFiles: string[];
  /** File whose patch was cut (only ever the first file, when it alone exceeds the budget). */
  truncatedFile?: string;
  /** Characters of formatted diff that were not sent. */
  omittedChars: number;
  totalChars: number;
}

function truncatePatch(file: FileDiff, maxChars: number): string {
  const hunks = (file.patch ?? '').split(/\n(?=@@ )/);
  const kept: string[] = [];
  for (const hunk of hunks) {
    const candidate = [...kept, hunk].join('\n');
    if (formatFile(file, candidate).length > maxChars) break;
    kept.push(hunk);
  }
  if (kept.length > 0) return kept.join('\n');
  // Even the first hunk is too big: cut it at a line boundary.
  const lines = (hunks[0] ?? '').split('\n');
  const out: string[] = [];
  for (const line of lines) {
    if (formatFile(file, [...out, line].join('\n')).length > maxChars) break;
    out.push(line);
  }
  return out.join('\n');
}

/**
 * Greedily packs files (in the given order) into `maxChars`. A file that does not fit is
 * omitted entirely; only when the very first file exceeds the budget is it cut at a hunk
 * boundary, so the model always sees something.
 */
export function applyBudget(files: FileDiff[], maxChars: number): BudgetResult {
  const parts: string[] = [];
  const result: BudgetResult = {
    text: '',
    includedFiles: [],
    omittedFiles: [],
    omittedChars: 0,
    totalChars: 0,
  };
  let used = 0;
  for (const file of files) {
    const block = formatFile(file);
    result.totalChars += block.length;
    if (used + block.length <= maxChars) {
      parts.push(block);
      used += block.length;
      result.includedFiles.push(file.path);
    } else if (result.includedFiles.length === 0 && result.truncatedFile === undefined) {
      const cut = formatFile(file, truncatePatch(file, maxChars));
      parts.push(cut + '[... patch truncated ...]\n');
      used += cut.length;
      result.includedFiles.push(file.path);
      result.truncatedFile = file.path;
      result.omittedChars += block.length - cut.length;
    } else {
      result.omittedFiles.push(file.path);
      result.omittedChars += block.length;
    }
  }
  result.text = parts.join('\n');
  return result;
}
