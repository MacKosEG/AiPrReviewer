import { readAsset } from './assets.js';
import type { Criterion, Rubric } from './types.js';

export const MAX_CRITERIA = 20;
export const DEFAULT_CRITERIA_ASSET = 'config/default-criteria.md';

const HEADING = /^##\s+(.+?)\s*$/;
const EXPLICIT_ID = /\s*\{#([a-z0-9][a-z0-9-]*)\}\s*$/i;
const RUBRIC_LINE = /^\s*[-*]\s+\**(pass|warn|fail)\**\s*[:–—-]\s*(.+)$/i;

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'criterion'
  );
}

/**
 * Parses a criteria markdown file:
 * - every `## Heading` is one criterion (id = slug of the heading, or an explicit `{#id}` suffix),
 * - text below it is the description,
 * - bullets `- **pass**: …`, `- **warn**: …`, `- **fail**: …` form the optional rubric.
 * Text before the first heading is ignored.
 */
export function parseCriteria(markdown: string): Criterion[] {
  const criteria: Criterion[] = [];
  const used = new Set<string>();
  let current: { heading: string; body: string[] } | undefined;

  const flush = () => {
    if (!current) return;
    const explicit = EXPLICIT_ID.exec(current.heading);
    const name = current.heading.replace(EXPLICIT_ID, '').trim();
    if (!name) return;
    const baseId = explicit?.[1]?.toLowerCase() ?? slugify(name);
    let id = baseId;
    for (let n = 2; used.has(id); n++) id = `${baseId}-${n}`;
    used.add(id);

    const rubric: Rubric = {};
    const description: string[] = [];
    for (const line of current.body) {
      const m = RUBRIC_LINE.exec(line);
      if (m) rubric[(m[1] ?? '').toLowerCase() as keyof Rubric] = (m[2] ?? '').trim();
      else description.push(line);
    }
    const criterion: Criterion = { id, name, description: description.join('\n').trim() };
    if (Object.keys(rubric).length > 0) criterion.rubric = rubric;
    criteria.push(criterion);
  };

  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      current = { heading: heading[1] ?? '', body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  flush();

  if (criteria.length === 0) {
    throw new Error(
      'Criteria file contains no "## <name>" headings; each criterion must be a level-2 heading.',
    );
  }
  if (criteria.length > MAX_CRITERIA) {
    throw new Error(
      `Criteria file defines ${criteria.length} criteria; the maximum is ${MAX_CRITERIA}.`,
    );
  }
  return criteria;
}

let defaults: Criterion[] | undefined;

/** The built-in criteria from config/default-criteria.md (shipped with the Action). */
export function loadDefaultCriteria(): Criterion[] {
  defaults ??= parseCriteria(readAsset(DEFAULT_CRITERIA_ASSET));
  return defaults;
}

/**
 * Criteria from the consumer's file when it exists (it replaces the defaults completely),
 * otherwise the built-in defaults.
 */
export function resolveCriteria(markdown: string | undefined): {
  criteria: Criterion[];
  source: 'file' | 'default';
} {
  if (markdown === undefined) return { criteria: loadDefaultCriteria(), source: 'default' };
  return { criteria: parseCriteria(markdown), source: 'file' };
}
