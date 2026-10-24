import type { FileDiff, FileStatus } from '../types.js';
import type { GitHubApi, PullFile, RepoRef } from './api.js';

const STATUSES: FileStatus[] = [
  'added',
  'modified',
  'removed',
  'renamed',
  'copied',
  'changed',
  'unchanged',
];

export function toFileDiff(file: PullFile): FileDiff {
  const status = (STATUSES as string[]).includes(file.status)
    ? (file.status as FileStatus)
    : 'modified';
  const diff: FileDiff = {
    path: file.filename,
    status,
    additions: file.additions,
    deletions: file.deletions,
  };
  if (file.previous_filename) diff.previousPath = file.previous_filename;
  if (file.patch !== undefined && file.patch !== '') diff.patch = file.patch;
  return diff;
}

export async function fetchPullRequestFiles(
  api: GitHubApi,
  repo: RepoRef,
  pullNumber: number,
): Promise<FileDiff[]> {
  const files = await api.listPullFiles(repo, pullNumber);
  return files.map(toFileDiff);
}
