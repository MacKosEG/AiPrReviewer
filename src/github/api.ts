import type { getOctokit } from '@actions/github';

export type Octokit = ReturnType<typeof getOctokit>;

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface PullFile {
  filename: string;
  previous_filename?: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface IssueComment {
  id: number;
  body?: string;
  html_url: string;
  user?: { login: string; type?: string } | null;
}

/** The small slice of the GitHub REST API the Action needs; easy to fake in tests. */
export interface GitHubApi {
  listPullFiles(repo: RepoRef, pullNumber: number): Promise<PullFile[]>;
  /** Returns the file content at `ref`, or undefined when the file does not exist. */
  getFileContent(repo: RepoRef, path: string, ref: string): Promise<string | undefined>;
  listIssueComments(repo: RepoRef, issueNumber: number): Promise<IssueComment[]>;
  createComment(repo: RepoRef, issueNumber: number, body: string): Promise<IssueComment>;
  updateComment(repo: RepoRef, commentId: number, body: string): Promise<IssueComment>;
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { status?: number }).status === 404;
}

export function createGitHubApi(octokit: Octokit): GitHubApi {
  return {
    async listPullFiles(repo, pullNumber) {
      const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
        ...repo,
        pull_number: pullNumber,
        per_page: 100,
      });
      return files.map((f) => {
        const file: PullFile = {
          filename: f.filename,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
        };
        if (f.previous_filename) file.previous_filename = f.previous_filename;
        if (f.patch !== undefined) file.patch = f.patch;
        return file;
      });
    },

    async getFileContent(repo, path, ref) {
      try {
        const res = await octokit.rest.repos.getContent({
          ...repo,
          path,
          ref,
          mediaType: { format: 'raw' },
        });
        // With the raw media type the body is the file content as a string.
        if (typeof res.data === 'string') return res.data;
        if (Array.isArray(res.data)) throw new Error(`${path} is a directory, expected a file`);
        const data = res.data as { content?: string; encoding?: string };
        if (data.content !== undefined && data.encoding === 'base64') {
          return Buffer.from(data.content, 'base64').toString('utf8');
        }
        throw new Error(`Unexpected content response for ${path}`);
      } catch (err) {
        if (isNotFound(err)) return undefined;
        throw err;
      }
    },

    async listIssueComments(repo, issueNumber) {
      return octokit.paginate(octokit.rest.issues.listComments, {
        ...repo,
        issue_number: issueNumber,
        per_page: 100,
      });
    },

    async createComment(repo, issueNumber, body) {
      const res = await octokit.rest.issues.createComment({
        ...repo,
        issue_number: issueNumber,
        body,
      });
      return res.data;
    },

    async updateComment(repo, commentId, body) {
      const res = await octokit.rest.issues.updateComment({ ...repo, comment_id: commentId, body });
      return res.data;
    },
  };
}
