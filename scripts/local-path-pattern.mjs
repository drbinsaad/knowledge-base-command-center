// One shared pattern for "a local absolute path leaked into a release asset".
// Used by tests/release.test.ts and scripts/package-release.mjs.
// Covers macOS/Linux user and temp paths, CI runner paths, file:// URLs and Windows drive letters.
export const localPathPattern =
  /(?:\/(?:Users|Volumes|home|root|tmp|private|var\/folders)\/|file:\/\/\/|(?:^|[\s"'(])[A-Za-z]:[\\/])/m;
