import { z } from 'zod';
import type { Criterion } from './types.js';

export const VERDICTS = ['APPROVED', 'NEEDS_WORK', 'DECLINED'] as const;
export const STATUSES = ['pass', 'warn', 'fail'] as const;
export const SEVERITIES = ['critical', 'major', 'minor'] as const;

export type Verdict = (typeof VERDICTS)[number];
export type CriterionStatus = (typeof STATUSES)[number];
export type Severity = (typeof SEVERITIES)[number];

export interface CriterionResult {
  id: string;
  name: string;
  status: CriterionStatus;
  comment: string;
}

export interface Finding {
  file: string;
  line?: number | undefined;
  severity: Severity;
  message: string;
  suggestion?: string | undefined;
}

export interface Review {
  verdict: Verdict;
  summary: string;
  criteria: CriterionResult[];
  findings: Finding[];
}

/**
 * Zod schema for the agent's structured output, built per run: criterion ids are an enum and the
 * array has exactly one entry per criterion. The JSON-Schema part (enums, required, min/maxItems)
 * is sent to the model; the refinement (no duplicate ids) is enforced when the SDK validates.
 */
export function buildReviewSchema(criteria: Criterion[]) {
  const ids = criteria.map((c) => c.id) as [string, ...string[]];
  return z
    .object({
      verdict: z
        .enum(VERDICTS)
        .describe('Overall verdict. Must follow the verdict rule from the instructions.'),
      summary: z
        .string()
        .min(1)
        .describe('Two to five sentences summarizing the change and the main concerns.'),
      criteria: z
        .array(
          z.object({
            id: z.enum(ids),
            name: z.string(),
            status: z.enum(STATUSES),
            comment: z
              .string()
              .describe('Short justification referencing concrete code when not "pass".'),
          }),
        )
        .length(criteria.length)
        .describe('Exactly one entry per review criterion, in the given order.'),
      findings: z
        .array(
          z.object({
            file: z.string().min(1).describe('Path of the file exactly as shown in the diff.'),
            line: z
              .number()
              .int()
              .min(1)
              .optional()
              .describe('Line number in the new version of the file, if applicable.'),
            severity: z.enum(SEVERITIES),
            message: z.string().min(1),
            suggestion: z.string().optional().describe('Optional concrete fix.'),
          }),
        )
        .describe('Concrete problems found in the diff. Empty array when there are none.'),
    })
    .superRefine((value, ctx) => {
      const seen = new Set<string>();
      for (const [i, entry] of value.criteria.entries()) {
        if (seen.has(entry.id)) {
          ctx.addIssue({
            code: 'custom',
            path: ['criteria', i, 'id'],
            message: `duplicate entry for criterion "${entry.id}"; each criterion must appear exactly once`,
          });
        }
        seen.add(entry.id);
      }
    });
}

export type ReviewSchema = ReturnType<typeof buildReviewSchema>;
export type ReviewOutput = z.output<ReviewSchema>;

/** Puts criteria in configured order with configured names and drops empty optional fields. */
export function normalizeReview(output: ReviewOutput, criteria: Criterion[]): Review {
  const byId = new Map(output.criteria.map((c) => [c.id, c]));
  return {
    verdict: output.verdict,
    summary: output.summary.trim(),
    criteria: criteria.map((c) => {
      const entry = byId.get(c.id);
      if (!entry) throw new Error(`missing entry for criterion "${c.id}"`);
      return { id: c.id, name: c.name, status: entry.status, comment: entry.comment };
    }),
    findings: output.findings.map((f) => ({
      file: f.file,
      line: f.line,
      severity: f.severity,
      message: f.message,
      suggestion: f.suggestion?.trim() ? f.suggestion : undefined,
    })),
  };
}
