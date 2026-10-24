#!/usr/bin/env node
/**
 * Runs the promptfoo evals:
 *   1. bundles evals/provider.ts (and the src/ pipeline it uses) to evals/.build/provider.mjs,
 *   2. writes evals/.build/promptfooconfig.json from evals/config.mjs,
 *   3. runs `promptfoo eval` and writes HTML/JSON reports to evals/output/.
 *
 * Env: GEMINI_API_KEY (required)
 *      OPENROUTER_API_KEY (optional) - adds the non-Google model; skipped with a warning when unset
 *      OPENROUTER_MODEL (optional) - overrides the default OpenRouter model
 *      EVAL_MODELS (optional) - comma-separated Gemini models overriding the default list
 * Extra CLI args are passed to promptfoo, e.g. `npm run eval -- --filter-pattern security`.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { geminiModels, openRouterModel, tests } from './config.mjs';

const PROMPTFOO = 'promptfoo@0.125.0';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const buildDir = path.join(here, '.build');
const outDir = path.join(here, 'output');
mkdirSync(buildDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY is not set. Export it before running the evals.');
  process.exit(1);
}

await build({
  entryPoints: [path.join(here, 'provider.ts')],
  outfile: path.join(buildDir, 'provider.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  logLevel: 'warning',
});

const models = (process.env.EVAL_MODELS ?? '')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);
const providers = (models.length > 0 ? models : geminiModels).map((model) => ({
  id: 'file://provider.mjs',
  label: model,
  config: { provider: 'google', model },
}));
if (process.env.OPENROUTER_API_KEY) {
  const model = process.env.OPENROUTER_MODEL || openRouterModel;
  providers.push({
    id: 'file://provider.mjs',
    label: `openrouter:${model}`,
    config: { provider: 'openrouter', model },
  });
} else {
  console.warn(
    `WARNING: OPENROUTER_API_KEY is not set - skipping the non-Google model (${process.env.OPENROUTER_MODEL || openRouterModel} via OpenRouter). Only Gemini models are compared.`,
  );
}

const config = {
  description: 'ai-pr-reviewer: verdict accuracy per model',
  prompts: ['Review {{diff}}'],
  providers,
  tests,
};
const configPath = path.join(buildDir, 'promptfooconfig.json');
writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log(`Models: ${providers.map((p) => p.label).join(', ')}`);

const args = [
  '--yes',
  PROMPTFOO,
  'eval',
  '-c',
  configPath,
  '--max-concurrency',
  '2',
  '--no-cache',
  '-o',
  path.join(outDir, 'results.html'),
  '-o',
  path.join(outDir, 'results.json'),
  ...process.argv.slice(2),
];
const result = spawnSync('npx', args, {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
