// One shared pattern for "a local absolute path leaked into a release asset".
// Used by tests/release.test.ts and scripts/package-release.mjs.
// Covers: Unix user, temp and CI runner roots (only at the start of the text or after a
// delimiter, so URL paths and relative paths do not match), file:// URLs with any or no host,
// and Windows drive letters.
export const localPathPattern =
  /(?:(?:^|[\s"'`(=,:;<>[{])\/(?:Users|Volumes|home|root|tmp|private|var\/folders)\/|file:\/\/[^\s"'`()/]*\/|(?:^|[\s"'(])[A-Za-z]:[\\/])/m;
