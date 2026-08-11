const MAX_SEMANTIC_VERSION_LENGTH = 128;

export interface UpdateAnnouncement {
  version: string;
  title: string;
  intro: string;
  highlights: readonly string[];
  releaseUrl: string;
}

export interface UpdateAnnouncementPlan {
  announcement: UpdateAnnouncement | null;
  malformedStoredVersion: boolean;
  nextHighestObservedVersion: string | null;
  shouldPersist: boolean;
}

interface ParsedSemanticVersion {
  core: [string, string, string];
  prerelease: string[] | null;
}

export const UPDATE_ANNOUNCEMENT_0_12_0: UpdateAnnouncement = {
  version: "0.12.0",
  title: "What’s new in Knowledge Base Command Center 0.12.0",
  intro: "Knowledge Base Command Center has been updated. Your notes stay in place while the plugin adds safer organization and faster mobile workflows.",
  highlights: [
    "Safer Sync conflict handling, device-local navigation and Undo history, plus a local Sync & Recovery Center.",
    "Quick Append for Questions, Lectures to watch, Sources, Thoughts, To read, and your own categories.",
    "Per-Library note templates and guarded attachment placement that follows your chosen policy.",
    "Taxonomy health checks and preview-first multi-base portfolio transfer.",
    "Responsive stacked-pane layouts and iPhone keyboard, touch-target, Dynamic Type, VoiceOver, and RTL improvements.",
  ],
  releaseUrl: "https://github.com/drbinsaad/knowledge-base-command-center/releases/tag/0.12.0",
};

const ANNOUNCEMENTS = new Map<string, UpdateAnnouncement>([
  [UPDATE_ANNOUNCEMENT_0_12_0.version, UPDATE_ANNOUNCEMENT_0_12_0],
]);

function parseSemanticVersion(value: string): ParsedSemanticVersion | null {
  if (value.length === 0 || value.length > MAX_SEMANTIC_VERSION_LENGTH) return null;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.exec(value);
  if (!match) return null;
  const prerelease = match[4]?.split(".") ?? null;
  if (prerelease?.some((identifier) => /^\d+$/u.test(identifier) && identifier.length > 1 && identifier.startsWith("0"))) {
    return null;
  }
  return {
    core: [match[1] ?? "0", match[2] ?? "0", match[3] ?? "0"],
    prerelease,
  };
}

function compareNumericIdentifiers(left: string, right: string): number {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  return left === right ? 0 : left < right ? -1 : 1;
}

/** Semantic Versioning precedence. Build metadata is intentionally ignored. */
export function compareSemanticVersions(left: string, right: string): number | null {
  const parsedLeft = parseSemanticVersion(left);
  const parsedRight = parseSemanticVersion(right);
  if (!parsedLeft || !parsedRight) return null;
  for (let index = 0; index < parsedLeft.core.length; index += 1) {
    const comparison = compareNumericIdentifiers(parsedLeft.core[index] ?? "0", parsedRight.core[index] ?? "0");
    if (comparison !== 0) return comparison;
  }
  if (parsedLeft.prerelease === null) return parsedRight.prerelease === null ? 0 : 1;
  if (parsedRight.prerelease === null) return -1;
  const count = Math.max(parsedLeft.prerelease.length, parsedRight.prerelease.length);
  for (let index = 0; index < count; index += 1) {
    const leftIdentifier = parsedLeft.prerelease[index];
    const rightIdentifier = parsedRight.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    if (leftIdentifier === rightIdentifier) continue;
    const leftNumeric = /^\d+$/u.test(leftIdentifier);
    const rightNumeric = /^\d+$/u.test(rightIdentifier);
    if (leftNumeric && rightNumeric) return compareNumericIdentifiers(leftIdentifier, rightIdentifier);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftIdentifier < rightIdentifier ? -1 : 1;
  }
  return 0;
}

export function isSemanticVersion(value: unknown): value is string {
  return typeof value === "string" && parseSemanticVersion(value) !== null;
}

export function updateAnnouncementForVersion(version: string): UpdateAnnouncement | null {
  return ANNOUNCEMENTS.get(version) ?? null;
}

/**
 * Decide whether the current release should be announced. The caller persists
 * `nextHighestObservedVersion` before opening the modal, so a reload or second live instance
 * cannot show the same release twice. No plugin data or note is involved.
 */
export function planUpdateAnnouncement(
  currentVersion: string,
  storedHighestObservedVersion: unknown,
  eligibleFirstRolloutUpgrade: boolean,
): UpdateAnnouncementPlan {
  if (compareSemanticVersions(currentVersion, currentVersion) === null) {
    return { announcement: null, malformedStoredVersion: false, nextHighestObservedVersion: null, shouldPersist: false };
  }
  const storedValueAbsent = storedHighestObservedVersion === null || storedHighestObservedVersion === undefined;
  const parsed = isSemanticVersion(storedHighestObservedVersion) ? storedHighestObservedVersion : null;
  const malformedStoredVersion = !storedValueAbsent && parsed === null;

  const upgrade = parsed !== null
    && (compareSemanticVersions(currentVersion, parsed) ?? 0) > 0;
  const nextHighestObservedVersion = parsed === null || upgrade ? currentVersion : parsed;

  // 0.12.0 introduces this marker. Its one-time fallback is supplied only
  // when startup proved that a compatible persisted plugin payload already
  // existed. A truly fresh install or unrecognized payload is not treated as
  // an update, while an existing vault that was migrated by an earlier 0.12
  // candidate can still receive the official release announcement.
  const eligibleWithoutHistory = parsed === null && eligibleFirstRolloutUpgrade;
  const knownAnnouncement = updateAnnouncementForVersion(currentVersion);
  const announcement = knownAnnouncement
    && (upgrade || eligibleWithoutHistory)
    ? knownAnnouncement
    : null;

  return {
    announcement,
    malformedStoredVersion,
    nextHighestObservedVersion,
    shouldPersist: parsed === null || upgrade,
  };
}
