import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKER = path.join('config', 'default-criteria.md');

let cachedRoot: string | undefined;

/**
 * Finds the Action's own root directory (the one containing `config/`), walking up from this
 * module. Works from `src/` (tests, CLI), from the bundle in `dist/` and from `evals/.build/`.
 */
export function assetsRoot(): string {
  if (cachedRoot) return cachedRoot;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    if (existsSync(path.join(dir, MARKER))) {
      cachedRoot = dir;
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error(`Cannot locate ${MARKER} next to the ai-pr-reviewer code.`);
}

export function readAsset(relativePath: string): string {
  return readFileSync(path.join(assetsRoot(), relativePath), 'utf8');
}
