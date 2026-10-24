import * as core from '@actions/core';
import * as github from '@actions/github';
import { createModel, type ModelSelection } from './agent/model.js';
import { apiKeyFor, assertApiKeys, ConfigError, parseInputs, type ActionConfig } from './config.js';
import { loadContextFiles } from './context.js';
import { resolveCriteria } from './criteria.js';
import { shouldFail } from './exit.js';
import { createGitHubApi, type GitHubApi, type RepoRef } from './github/api.js';
import { upsertReviewComment } from './github/comment.js';
import { fetchPullRequestFiles } from './github/pr.js';
import { logOutcome } from './log.js';
import { renderComment, renderFailureComment, type RenderMeta } from './render.js';
import { runReview, type Logger } from './review.js';

type Core = Pick<
  typeof core,
  'getInput' | 'setOutput' | 'setFailed' | 'setSecret' | 'info' | 'warning' | 'error'
>;

export interface PullRequestPayload {
  number: number;
  title?: string;
  body?: string | null;
  base: { sha: string };
  head: { sha: string };
}

export interface ActionContext {
  eventName: string;
  serverUrl: string;
  repo: RepoRef;
  pullRequest?: PullRequestPayload;
}

export interface ActionDeps {
  core: Core;
  context: ActionContext;
  createGitHubApi: (token: string) => GitHubApi;
  createModel: (config: ActionConfig) => ModelSelection;
}

export function defaultDeps(): ActionDeps {
  const ctx = github.context;
  const pr = ctx.payload.pull_request as PullRequestPayload | undefined;
  return {
    core,
    context: {
      eventName: ctx.eventName,
      serverUrl: ctx.serverUrl,
      repo: ctx.repo,
      ...(pr ? { pullRequest: pr } : {}),
    },
    createGitHubApi: (token) => createGitHubApi(github.getOctokit(token)),
    createModel: (config) =>
      createModel({ provider: config.provider, model: config.model, apiKey: apiKeyFor(config) }),
  };
}

export async function run(deps: ActionDeps = defaultDeps()): Promise<void> {
  const { core: c, context } = deps;
  const logger: Logger = { info: (m) => c.info(m), warning: (m) => c.warning(m) };
  let api: GitHubApi | undefined;
  let meta: RenderMeta = {};
  const pr = context.pullRequest;

  try {
    const config = parseInputs((name) => c.getInput(name));
    if (config.geminiApiKey) c.setSecret(config.geminiApiKey);
    if (config.openrouterApiKey) c.setSecret(config.openrouterApiKey);
    if (config.githubToken) c.setSecret(config.githubToken);

    if (!pr) {
      throw new ConfigError(
        `ai-pr-reviewer must run on a pull_request event (got "${context.eventName}").`,
      );
    }
    if (!config.githubToken) throw new ConfigError('Input "github-token" is empty.');
    const ghApi = deps.createGitHubApi(config.githubToken);
    api = ghApi;
    meta = {
      repoUrl: `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}`,
      headSha: pr.head.sha,
      criteriaFile: config.criteriaFile,
    };
    assertApiKeys(config);

    // Criteria and context come from the base commit so the PR cannot weaken its own review.
    const readAtBase = (path: string) => ghApi.getFileContent(context.repo, path, pr.base.sha);
    const criteriaText = await readAtBase(config.criteriaFile);
    const { criteria, source } = resolveCriteria(criteriaText);
    meta.criteriaSource = source;
    c.info(
      source === 'file'
        ? `Criteria: ${criteria.length} from ${config.criteriaFile} (base ${pr.base.sha.slice(0, 7)})`
        : `Criteria: ${config.criteriaFile} not found at base; using ${criteria.length} built-in defaults`,
    );
    const contextFiles = await loadContextFiles(config.contextFiles, readAtBase, logger);
    if (config.contextFiles.length > 0) c.info(`Context files loaded: ${contextFiles.length}`);

    const files = await fetchPullRequestFiles(ghApi, context.repo, pr.number);
    const outcome = await runReview(
      {
        files,
        criteria,
        context: contextFiles,
        pr: { title: pr.title ?? '', body: pr.body ?? '' },
        maxDiffChars: config.maxDiffChars,
      },
      { model: deps.createModel(config), logger },
    );
    logOutcome(outcome, config.maxDiffChars, logger);

    const comment = await upsertReviewComment(
      ghApi,
      context.repo,
      pr.number,
      renderComment(outcome, meta),
    );
    c.info(`Review comment ${comment.action}: ${comment.url}`);

    const verdict = outcome.decision.verdict;
    c.setOutput('verdict', verdict);
    if (shouldFail(verdict, config.failOn)) {
      c.setFailed(
        `AI review verdict: ${verdict} (${outcome.decision.reasons.join('; ')}). fail-on=${config.failOn}.`,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    c.setFailed(message);
    if (api && pr) {
      try {
        await upsertReviewComment(
          api,
          context.repo,
          pr.number,
          renderFailureComment(message, meta),
        );
      } catch (commentErr) {
        c.warning(`Could not post the failure comment: ${(commentErr as Error).message}`);
      }
    }
  }
}
