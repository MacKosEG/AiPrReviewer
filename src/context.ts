import type { ContextFile } from './types.js';
import type { Logger } from './review.js';

export const MAX_CONTEXT_FILES = 10;
export const MAX_CONTEXT_CHARS_PER_FILE = 20_000;
export const MAX_CONTEXT_CHARS_TOTAL = 60_000;

/** Reads a file by repository-relative path; resolves to undefined when it does not exist. */
export type FileReader = (path: string) => Promise<string | undefined>;

export function parsePathList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export async function loadContextFiles(
  paths: string[],
  read: FileReader,
  logger: Logger,
): Promise<ContextFile[]> {
  const files: ContextFile[] = [];
  let remaining = MAX_CONTEXT_CHARS_TOTAL;
  if (paths.length > MAX_CONTEXT_FILES) {
    logger.warning(
      `context-files lists ${paths.length} files; only the first ${MAX_CONTEXT_FILES} are used.`,
    );
  }
  for (const path of paths.slice(0, MAX_CONTEXT_FILES)) {
    if (remaining <= 0) {
      logger.warning(`Context budget exhausted; skipping ${path}.`);
      continue;
    }
    const content = await read(path);
    if (content === undefined) {
      logger.warning(`Context file not found: ${path}`);
      continue;
    }
    const limit = Math.min(MAX_CONTEXT_CHARS_PER_FILE, remaining);
    const truncated = content.length > limit;
    const text = truncated ? `${content.slice(0, limit)}\n[... truncated ...]` : content;
    remaining -= Math.min(content.length, limit);
    files.push({ path, content: text, truncated });
    if (truncated) logger.warning(`Context file ${path} truncated to ${limit} characters.`);
  }
  return files;
}
