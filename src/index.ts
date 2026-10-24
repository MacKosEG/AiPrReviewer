import * as core from '@actions/core';
import { defaultDeps, run } from './main.js';

try {
  await run(defaultDeps());
} catch (err) {
  // Only reached when the GitHub context itself is unusable (run() reports everything else).
  core.setFailed(err instanceof Error ? err.message : String(err));
}
