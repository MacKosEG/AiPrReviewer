import { COMMENT_MARKER } from '../render.js';
import type { GitHubApi, IssueComment, RepoRef } from './api.js';

export interface UpsertResult {
  action: 'created' | 'updated';
  id: number;
  url: string;
}

/**
 * Finds the review comment by its hidden marker. Comments written by a bot (the Action itself)
 * win over user comments that merely contain the marker text.
 */
export function findReviewComment(comments: IssueComment[]): IssueComment | undefined {
  const marked = comments.filter((c) => c.body?.includes(COMMENT_MARKER));
  return marked.find((c) => c.user?.type === 'Bot') ?? marked[0];
}

/** Creates the single review comment, or updates it in place on subsequent runs. */
export async function upsertReviewComment(
  api: GitHubApi,
  repo: RepoRef,
  issueNumber: number,
  body: string,
): Promise<UpsertResult> {
  const existing = findReviewComment(await api.listIssueComments(repo, issueNumber));
  if (existing) {
    const updated = await api.updateComment(repo, existing.id, body);
    return { action: 'updated', id: updated.id, url: updated.html_url };
  }
  const created = await api.createComment(repo, issueNumber, body);
  return { action: 'created', id: created.id, url: created.html_url };
}
