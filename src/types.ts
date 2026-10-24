export type FileStatus =
  'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'changed' | 'unchanged';

/** One changed file of a pull request, normalized from the GitHub API or a local unified diff. */
export interface FileDiff {
  path: string;
  previousPath?: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  /** Unified diff hunks (starting at the first `@@`). Undefined for binary or too-large files. */
  patch?: string;
  /** True when the source marked the file as binary. */
  binary?: boolean;
}

/** What pass / warn / fail mean for one criterion. */
export interface Rubric {
  pass?: string;
  warn?: string;
  fail?: string;
}

export interface Criterion {
  id: string;
  name: string;
  description: string;
  rubric?: Rubric;
}

export interface ContextFile {
  path: string;
  content: string;
  truncated: boolean;
}
