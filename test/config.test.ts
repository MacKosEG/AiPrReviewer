import { describe, expect, it, vi } from 'vitest';
import { ConfigError, parseInputs } from '../src/config.js';
import { loadContextFiles, MAX_CONTEXT_CHARS_PER_FILE, parsePathList } from '../src/context.js';

describe('parseInputs', () => {
  it('applies defaults', () => {
    const config = parseInputs((name) => (name === 'gemini-api-key' ? 'k' : ''));
    expect(config).toEqual({
      provider: 'google',
      geminiApiKey: 'k',
      openrouterApiKey: '',
      githubToken: '',
      model: 'gemini-3.8-flash',
      criteriaFile: '.github/ai-review-criteria.md',
      contextFiles: [],
      failOn: 'DECLINED',
      maxDiffChars: 120_000,
    });
  });

  it('normalizes fail-on case and parses lists', () => {
    const values: Record<string, string> = {
      'fail-on': 'needs_work',
      'context-files': 'docs/PRD.md, AGENTS.md\n\nREADME.md',
      'max-diff-chars': '50000',
    };
    const config = parseInputs((name) => values[name] ?? '');
    expect(config.failOn).toBe('NEEDS_WORK');
    expect(config.contextFiles).toEqual(['docs/PRD.md', 'AGENTS.md', 'README.md']);
    expect(config.maxDiffChars).toBe(50_000);
  });

  it('resolves the default model per provider and rejects unknown providers', () => {
    expect(parseInputs((n) => (n === 'provider' ? 'OpenRouter' : '')).model).toBe(
      'google/gemini-3.8-flash',
    );
    expect(parseInputs((n) => (n === 'model' ? 'gemini-4-argon' : '')).model).toBe(
      'gemini-4-argon',
    );
    expect(() => parseInputs((n) => (n === 'provider' ? 'anthropic' : ''))).toThrow(
      /Invalid provider/,
    );
  });

  it.each(['abc', '10', '1.5', '-1'])('rejects max-diff-chars=%s', (value) => {
    expect(() => parseInputs((name) => (name === 'max-diff-chars' ? value : ''))).toThrow(
      ConfigError,
    );
  });
});

describe('loadContextFiles', () => {
  const logger = () => ({ info: vi.fn(), warning: vi.fn() });

  it('loads files, warns on missing ones and truncates large ones', async () => {
    const files: Record<string, string> = {
      'AGENTS.md': 'rules',
      'PRD.md': 'x'.repeat(MAX_CONTEXT_CHARS_PER_FILE + 10),
    };
    const log = logger();
    const result = await loadContextFiles(
      parsePathList('AGENTS.md,missing.md,PRD.md'),
      async (p) => files[p],
      log,
    );
    expect(result.map((f) => [f.path, f.truncated])).toEqual([
      ['AGENTS.md', false],
      ['PRD.md', true],
    ]);
    expect(result[1]?.content.endsWith('[... truncated ...]')).toBe(true);
    expect(log.warning).toHaveBeenCalledWith('Context file not found: missing.md');
  });

  it('enforces the total budget', async () => {
    const big = 'y'.repeat(MAX_CONTEXT_CHARS_PER_FILE);
    const log = logger();
    const result = await loadContextFiles(['a', 'b', 'c', 'd'], async () => big, log);
    expect(result).toHaveLength(3);
    expect(log.warning).toHaveBeenCalledWith('Context budget exhausted; skipping d.');
  });
});
