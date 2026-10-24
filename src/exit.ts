import type { Verdict } from './schema.js';

export const FAIL_ON = ['DECLINED', 'NEEDS_WORK', 'never'] as const;
export type FailOn = (typeof FAIL_ON)[number];

export function shouldFail(verdict: Verdict, failOn: FailOn): boolean {
  switch (failOn) {
    case 'never':
      return false;
    case 'NEEDS_WORK':
      return verdict === 'NEEDS_WORK' || verdict === 'DECLINED';
    case 'DECLINED':
      return verdict === 'DECLINED';
  }
}
