import { formatCost } from './pricing.js';
import type { ReviewOutcome } from './review.js';
import type { CriterionStatus, Finding, Severity, Verdict } from './schema.js';

export const COMMENT_MARKER = '<!-- ai-pr-reviewer:comment -->';
/** GitHub rejects comment bodies above 65536 characters. */
export const MAX_COMMENT_CHARS = 65_000;

export interface RenderMeta {
  /** e.g. https://github.com/owner/repo */
  repoUrl?: string;
  headSha?: string;
  criteriaSource?: 'file' | 'default';
  criteriaFile?: string;
}

const VERDICT_BADGE: Record<Verdict, string> = {
  APPROVED: '✅ APPROVED',
  NEEDS_WORK: '🟡 NEEDS_WORK',
  DECLINED: '⛔ DECLINED',
};

const STATUS_BADGE: Record<CriterionStatus, string> = {
  pass: '✅ pass',
  warn: '⚠️ warn',
  fail: '❌ fail',
};

const SEVERITY_TITLE: Record<Severity, string> = {
  critical: '🔴 Critical',
  major: '🟠 Major',
  minor: '🔵 Minor',
};

function cell(text: string): string {
  return text.replace(/\r?\n/g, '<br>').replace(/\|/g, '\\|').trim() || '—';
}

function inline(text: string): string {
  return text.replace(/\r?\n+/g, ' ').trim();
}

function fileLink(f: Finding, meta: RenderMeta): string {
  const label = f.line ? `${f.file}:${f.line}` : f.file;
  if (!meta.repoUrl || !meta.headSha) return `\`${label}\``;
  const anchor = f.line ? `#L${f.line}` : '';
  const path = f.file.split('/').map(encodeURIComponent).join('/');
  return `[\`${label}\`](${meta.repoUrl}/blob/${meta.headSha}/${path}${anchor})`;
}

function truncateBody(body: string): string {
  if (body.length <= MAX_COMMENT_CHARS) return body;
  const note = '\n\n> ✂️ Comment truncated to fit GitHub limits; see the job log for details.\n';
  return body.slice(0, MAX_COMMENT_CHARS - note.length) + note;
}

function list(items: string[], max = 50): string {
  const shown = items.slice(0, max).map((item) => `- ${item}`);
  if (items.length > max) shown.push(`- … and ${items.length - max} more`);
  return shown.join('\n');
}

export function renderComment(outcome: ReviewOutcome, meta: RenderMeta = {}): string {
  const { review, decision, stats } = outcome;
  const out: string[] = [COMMENT_MARKER];

  out.push(`## 🤖 AI review: ${VERDICT_BADGE[decision.verdict]}`);
  out.push('');
  out.push(review.summary);

  if (decision.overridden) {
    out.push('');
    out.push(
      `> ℹ️ Verdict adjusted by policy: the model said **${decision.modelVerdict}**, but ${decision.reasons.join('; ')} → **${decision.verdict}**.`,
    );
  }

  if (outcome.omissions.length > 0) {
    out.push('');
    out.push('> [!WARNING]');
    out.push('> **Partial review**: parts of this PR were not sent to the model.');
    for (const o of outcome.omissions) out.push(`> - ${inline(o)}`);
  }

  out.push('');
  out.push('### Criteria');
  out.push('');
  out.push('| Status | Criterion | Comment |');
  out.push('| --- | --- | --- |');
  for (const c of review.criteria) {
    out.push(`| ${STATUS_BADGE[c.status]} | ${cell(c.name)} | ${cell(c.comment)} |`);
  }

  out.push('');
  out.push(`### Findings (${review.findings.length})`);
  if (review.findings.length === 0) {
    out.push('');
    out.push('No findings.');
  }
  for (const severity of ['critical', 'major', 'minor'] as const) {
    const items = review.findings.filter((f) => f.severity === severity);
    if (items.length === 0) continue;
    out.push('');
    out.push(`#### ${SEVERITY_TITLE[severity]} (${items.length})`);
    out.push('');
    for (const f of items) {
      out.push(`- ${fileLink(f, meta)}: ${inline(f.message)}`);
      if (f.suggestion) {
        const suggestion = f.suggestion.trim();
        if (suggestion.includes('\n')) {
          out.push('  <details><summary>Suggestion</summary>');
          out.push('');
          out.push(
            suggestion
              .split('\n')
              .map((l) => `  ${l}`)
              .join('\n'),
          );
          out.push('');
          out.push('  </details>');
        } else {
          out.push(`  - 💡 ${suggestion}`);
        }
      }
    }
  }

  if (outcome.filtered.length > 0) {
    out.push('');
    out.push(
      `<details><summary>${outcome.filtered.length} file(s) skipped as noise (lockfiles, generated, binaries, snapshots)</summary>\n`,
    );
    out.push(list(outcome.filtered.map((f) => `\`${f.path}\` (${f.reason})`)));
    out.push('\n</details>');
  }

  const criteriaNote =
    meta.criteriaSource === 'file'
      ? `criteria: \`${meta.criteriaFile ?? 'file'}\``
      : 'criteria: built-in defaults';
  const tokens = `${outcome.usage.inputTokens} in / ${outcome.usage.outputTokens} out`;
  const sha = meta.headSha ? ` · commit ${meta.headSha.slice(0, 7)}` : '';
  out.push('');
  out.push('---');
  out.push(
    `<sub>ai-pr-reviewer · model \`${outcome.model}\` · ${criteriaNote} · ${stats.reviewedFiles}/${stats.totalFiles} files reviewed · ${tokens} tokens · cost ${formatCost(outcome.cost)}${sha}</sub>`,
  );

  return truncateBody(out.join('\n'));
}

export function renderFailureComment(message: string, meta: RenderMeta = {}): string {
  const sha = meta.headSha ? ` for commit ${meta.headSha.slice(0, 7)}` : '';
  return truncateBody(
    [
      COMMENT_MARKER,
      '## 🤖 AI review: ❗ review failed',
      '',
      `The automated review could not be completed${sha}, so no verdict was produced. The check fails closed.`,
      '',
      '```',
      message.slice(0, 2000),
      '```',
      '',
      'Re-run the workflow to retry. See the job log for details.',
    ].join('\n'),
  );
}
