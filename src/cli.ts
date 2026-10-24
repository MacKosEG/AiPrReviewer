import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { createModel, DEFAULT_MODELS } from './agent/model.js';
import { DEFAULT_MAX_DIFF_CHARS, parseFailOn, parseMaxDiffChars, parseProvider } from './config.js';
import { loadContextFiles, parsePathList } from './context.js';
import { resolveCriteria } from './criteria.js';
import { parseUnifiedDiff } from './diff/parse.js';
import { shouldFail } from './exit.js';
import { logOutcome } from './log.js';
import { prepareReview, runReview, type Logger } from './review.js';

const HELP = `Usage: npm run review -- --diff <file.diff> [options]

Runs the review locally and prints the result as JSON. Nothing is published.

Options:
  --diff <path>            Unified diff to review (required)
  --criteria <path>        Criteria markdown (default: built-in criteria)
  --context <paths>        Comma-separated context files
  --provider <name>        google (default) or openrouter
  --model <id>             Model id (default: ${DEFAULT_MODELS.google} / ${DEFAULT_MODELS.openrouter})
  --max-diff-chars <n>     Diff budget (default: ${DEFAULT_MAX_DIFF_CHARS})
  --title <text>           PR title passed to the model
  --fail-on <value>        Exit 1 on DECLINED | NEEDS_WORK | never (default: never)
  --print-prompt           Print the prompt and JSON schema instead of calling the model
  -h, --help               Show this help

Environment: GEMINI_API_KEY (provider google) or OPENROUTER_API_KEY (provider openrouter).`;

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      diff: { type: 'string' },
      criteria: { type: 'string' },
      context: { type: 'string' },
      model: { type: 'string' },
      provider: { type: 'string', default: 'google' },
      'max-diff-chars': { type: 'string' },
      title: { type: 'string' },
      'fail-on': { type: 'string', default: 'never' },
      'print-prompt': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(HELP);
    return 0;
  }
  if (!values.diff) {
    console.error('Missing --diff.\n');
    console.error(HELP);
    return 2;
  }

  const logger: Logger = {
    info: (m) => console.error(`[info] ${m}`),
    warning: (m) => console.error(`[warn] ${m}`),
  };

  const diffText = await readFile(values.diff, 'utf8');
  let criteriaText: string | undefined;
  if (values.criteria) {
    criteriaText = await readOptional(values.criteria);
    if (criteriaText === undefined) throw new Error(`Criteria file not found: ${values.criteria}`);
  }
  const { criteria, source } = resolveCriteria(criteriaText);
  logger.info(
    `Criteria: ${criteria.length} (${source === 'file' ? values.criteria : 'built-in defaults'})`,
  );

  const context = await loadContextFiles(parsePathList(values.context ?? ''), readOptional, logger);
  const maxDiffChars = parseMaxDiffChars(values['max-diff-chars'] ?? '');
  const failOn = parseFailOn(values['fail-on'] ?? 'never');
  const input = {
    files: parseUnifiedDiff(diffText),
    criteria,
    context,
    maxDiffChars,
    ...(values.title ? { pr: { title: values.title } } : {}),
  };

  if (values['print-prompt']) {
    const prepared = prepareReview(input);
    console.log(`=== SYSTEM ===\n${prepared.system}\n\n=== USER ===\n${prepared.user}\n`);
    const schema = z.toJSONSchema(prepared.schema, { io: 'input', unrepresentable: 'any' });
    console.log(`=== OUTPUT JSON SCHEMA ===\n${JSON.stringify(schema, null, 2)}`);
    return 0;
  }

  const provider = parseProvider(values.provider ?? 'google');
  const envKey = provider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'GEMINI_API_KEY';
  const apiKey = process.env[envKey];
  if (!apiKey) throw new Error(`${envKey} is not set (or use --print-prompt).`);
  const model = createModel({ provider, model: values.model ?? '', apiKey });

  const outcome = await runReview(input, { model, logger });
  logOutcome(outcome, maxDiffChars, logger);
  console.log(
    JSON.stringify(
      {
        verdict: outcome.decision.verdict,
        modelVerdict: outcome.decision.modelVerdict,
        verdictOverridden: outcome.decision.overridden,
        verdictReasons: outcome.decision.reasons,
        summary: outcome.review.summary,
        criteria: outcome.review.criteria,
        findings: outcome.review.findings,
        omissions: outcome.omissions,
        filtered: outcome.filtered,
        stats: outcome.stats,
        model: outcome.model,
        usage: outcome.usage,
        cost: outcome.cost,
        durationMs: outcome.durationMs,
      },
      null,
      2,
    ),
  );
  return shouldFail(outcome.decision.verdict, failOn) ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  },
);
