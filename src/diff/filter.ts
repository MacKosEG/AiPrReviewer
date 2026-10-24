import picomatch from 'picomatch';
import type { FileDiff } from '../types.js';

export type NoiseReason = 'lockfile' | 'generated' | 'snapshot' | 'binary';

const LOCKFILES = [
  '**/package-lock.json',
  '**/npm-shrinkwrap.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/bun.lock',
  '**/bun.lockb',
  '**/Cargo.lock',
  '**/poetry.lock',
  '**/uv.lock',
  '**/Pipfile.lock',
  '**/Gemfile.lock',
  '**/composer.lock',
  '**/go.sum',
  '**/packages.lock.json',
  '**/flake.lock',
];

const GENERATED = [
  'dist/**',
  'build/**',
  'out/**',
  '**/*.min.js',
  '**/*.min.css',
  '**/*.map',
  '**/*.generated.*',
  '**/__generated__/**',
  '**/*.pb.go',
  '**/*_pb2.py',
  '**/*_pb2_grpc.py',
  '**/*.g.dart',
  '**/*.designer.cs',
];

const SNAPSHOTS = ['**/*.snap', '**/__snapshots__/**'];

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'avif', 'tif', 'tiff', 'psd',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'tar', 'jar', 'war',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'exe', 'dll', 'so', 'dylib', 'bin', 'o', 'a', 'lib', 'class', 'pyc', 'wasm',
  'mp3', 'mp4', 'mov', 'avi', 'wav', 'ogg', 'flac', 'webm',
  'sqlite', 'db', 'keystore', 'p12',
]); // prettier-ignore

const matchers: [NoiseReason, (path: string) => boolean][] = [
  ['lockfile', picomatch(LOCKFILES, { dot: true })],
  ['snapshot', picomatch(SNAPSHOTS, { dot: true })],
  ['generated', picomatch(GENERATED, { dot: true })],
];

export function noiseReason(file: FileDiff): NoiseReason | undefined {
  for (const [reason, isMatch] of matchers) {
    if (isMatch(file.path)) return reason;
  }
  const ext = file.path.split('.').pop()?.toLowerCase() ?? '';
  if (file.binary || BINARY_EXTENSIONS.has(ext)) return 'binary';
  return undefined;
}

export interface FilterResult {
  /** Files that should be reviewed. */
  kept: FileDiff[];
  /** Noise that is intentionally not reviewed. */
  filtered: { path: string; reason: NoiseReason }[];
  /** Real source files the API returned without a patch (too large); these make the review partial. */
  missingPatch: string[];
}

export function filterNoise(files: FileDiff[]): FilterResult {
  const result: FilterResult = { kept: [], filtered: [], missingPatch: [] };
  for (const file of files) {
    if (file.status === 'unchanged') continue;
    const reason = noiseReason(file);
    if (reason) {
      result.filtered.push({ path: file.path, reason });
    } else if (file.patch === undefined || file.patch === '') {
      // Pure renames / mode changes have no patch and nothing to review.
      if (file.additions + file.deletions > 0) result.missingPatch.push(file.path);
    } else {
      result.kept.push(file);
    }
  }
  return result;
}
