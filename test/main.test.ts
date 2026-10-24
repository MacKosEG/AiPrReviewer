import { describe, expect, it, vi } from 'vitest';
import { loadDefaultCriteria, parseCriteria } from '../src/criteria.js';
import { parseUnifiedDiff } from '../src/diff/parse.js';
import { run, type ActionDeps } from '../src/main.js';
import { COMMENT_MARKER } from '../src/render.js';
import { fakeGitHub, fixture, mockModel, pullFilesFromDiff, reviewJson } from './helpers.js';

const DEFAULT_CRITERIA = loadDefaultCriteria();

const PR = {
  number: 42,
  title: 'Add user search',
  body: 'Adds search.',
  base: { sha: 'base000' },
  head: { sha: 'head111' },
};

function setup(options: {
  inputs?: Record<string, string>;
  llmTexts?: string[];
  repoFiles?: Record<string, string>;
  pullRequest?: typeof PR | undefined;
}) {
  const inputs: Record<string, string> = {
    provider: '',
    'gemini-api-key': 'AIza-secret',
    'openrouter-api-key': '',
    'github-token': 'ghs_token',
    model: '',
    'criteria-file': '',
    'context-files': '',
    'fail-on': '',
    'max-diff-chars': '',
    ...options.inputs,
  };
  const files = pullFilesFromDiff(
    parseUnifiedDiff(fixture('security.diff')).map((f) => ({ path: f.path, patch: f.patch ?? '' })),
  );
  const gh = fakeGitHub({ files, repoFiles: options.repoFiles ?? {} });
  const llm = mockModel(options.llmTexts ?? [reviewJson(DEFAULT_CRITERIA)]);
  const core = {
    getInput: vi.fn((name: string) => inputs[name] ?? ''),
    setOutput: vi.fn(),
    setFailed: vi.fn(),
    setSecret: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  };
  const createModel = vi.fn(() => llm.selection);
  const deps: ActionDeps = {
    core,
    context: {
      eventName: 'pull_request',
      serverUrl: 'https://github.com',
      repo: { owner: 'o', repo: 'r' },
      ...('pullRequest' in options
        ? options.pullRequest
          ? { pullRequest: options.pullRequest }
          : {}
        : { pullRequest: PR }),
    },
    createGitHubApi: () => gh.api,
    createModel,
  };
  return { deps, core, gh, llm, createModel };
}

function logLines(core: ReturnType<typeof setup>['core']): string {
  return [...core.info.mock.calls, ...core.warning.mock.calls].map((c) => String(c[0])).join('\n');
}

describe('run (Action entry)', () => {
  it('reviews the PR, posts one comment, sets the output and passes on APPROVED', async () => {
    const { deps, core, gh, createModel } = setup({});
    await run(deps);

    expect(core.setSecret).toHaveBeenCalledWith('AIza-secret');
    expect(createModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-3.8-flash', failOn: 'DECLINED' }),
    );
    expect(gh.api.getFileContent).toHaveBeenCalledWith(
      { owner: 'o', repo: 'r' },
      '.github/ai-review-criteria.md',
      'base000',
    );
    expect(gh.api.listPullFiles).toHaveBeenCalledWith({ owner: 'o', repo: 'r' }, 42);
    expect(gh.comments).toHaveLength(1);
    expect(gh.comments[0]?.body).toContain(COMMENT_MARKER);
    expect(gh.comments[0]?.body).toContain('✅ APPROVED');
    expect(core.setOutput).toHaveBeenCalledWith('verdict', 'APPROVED');
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('logs metrics but never the key or the diff', async () => {
    const { deps, core } = setup({});
    await run(deps);
    const logs = logLines(core);
    expect(logs).toMatch(/Model: gemini-3\.8-flash/);
    expect(logs).toMatch(/Diff size: \d+ chars reviewable/);
    expect(logs).toMatch(/Tokens: input 1000 \(cached 100\), output 500 \(reasoning 300\)/);
    expect(logs).toMatch(/Cost: ~\$0\.00263 \(tokens x rates from config\/pricing\.json\)/);
    expect(logs).toMatch(/Time: model \d+\.\ds over 1 step\(s\)/);
    expect(logs).not.toContain('AIza-secret');
    expect(logs).not.toContain('SELECT id, name');
  });

  it('fails the step on DECLINED with the default fail-on', async () => {
    const { deps, core } = setup({
      llmTexts: [
        reviewJson(DEFAULT_CRITERIA, { verdict: 'DECLINED', statuses: { security: 'fail' } }),
      ],
    });
    await run(deps);
    expect(core.setOutput).toHaveBeenCalledWith('verdict', 'DECLINED');
    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('AI review verdict: DECLINED'),
    );
  });

  it.each([
    ['DECLINED', false],
    ['NEEDS_WORK', true],
    ['never', false],
  ])('NEEDS_WORK with fail-on=%s fails=%s', async (failOn, fails) => {
    const { deps, core } = setup({
      inputs: { 'fail-on': failOn },
      llmTexts: [
        reviewJson(DEFAULT_CRITERIA, { verdict: 'NEEDS_WORK', statuses: { tests: 'warn' } }),
      ],
    });
    await run(deps);
    expect(core.setOutput).toHaveBeenCalledWith('verdict', 'NEEDS_WORK');
    expect(core.setFailed).toHaveBeenCalledTimes(fails ? 1 : 0);
  });

  it('does not fail on DECLINED when fail-on=never', async () => {
    const { deps, core } = setup({
      inputs: { 'fail-on': 'never' },
      llmTexts: [
        reviewJson(DEFAULT_CRITERIA, { verdict: 'DECLINED', statuses: { security: 'fail' } }),
      ],
    });
    await run(deps);
    expect(core.setOutput).toHaveBeenCalledWith('verdict', 'DECLINED');
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('uses the criteria file from the base commit when present', async () => {
    const md = fixture('criteria.md');
    const criteria = parseCriteria(md);
    const { deps, gh, llm } = setup({
      repoFiles: { '.github/ai-review-criteria.md': md },
      llmTexts: [reviewJson(criteria)],
    });
    await run(deps);
    expect(llm.prompts()[0]).toContain('id: code-quality');
    expect(gh.comments[0]?.body).toContain('criteria: `.github/ai-review-criteria.md`');
  });

  it('fails with a clear message and a failure comment when the API key is missing', async () => {
    const { deps, core, gh, createModel } = setup({ inputs: { 'gemini-api-key': '' } });
    await run(deps);
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('gemini-api-key'));
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('forks'));
    expect(createModel).not.toHaveBeenCalled();
    expect(core.setOutput).not.toHaveBeenCalled();
    expect(gh.comments[0]?.body).toContain('review failed');
  });

  it('with provider=openrouter requires openrouter-api-key (gemini-api-key stays required)', async () => {
    const missingOr = setup({ inputs: { provider: 'openrouter' } });
    await run(missingOr.deps);
    expect(missingOr.core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('openrouter-api-key'),
    );

    const ok = setup({ inputs: { provider: 'openrouter', 'openrouter-api-key': 'sk-or-secret' } });
    await run(ok.deps);
    expect(ok.core.setSecret).toHaveBeenCalledWith('sk-or-secret');
    expect(ok.createModel).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'openrouter', model: 'google/gemini-3.8-flash' }),
    );
    expect(ok.core.setFailed).not.toHaveBeenCalled();
  });

  it('fails on invalid inputs', async () => {
    const { deps, core } = setup({ inputs: { 'fail-on': 'sometimes' } });
    await run(deps);
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Invalid fail-on'));
  });

  it('fails when not running on a pull request', async () => {
    const { deps, core } = setup({ pullRequest: undefined });
    await run(deps);
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('pull_request event'));
  });

  it('fails closed and updates the comment when the model output stays invalid', async () => {
    const { deps, core, gh } = setup({ llmTexts: ['garbage'] });
    await run(deps);
    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('did not return a valid review'),
    );
    expect(core.setOutput).not.toHaveBeenCalled();
    expect(gh.comments).toHaveLength(1);
    expect(gh.comments[0]?.body).toContain('review failed');
  });
});
