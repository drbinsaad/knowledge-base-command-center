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

export const UPDATE_ANNOUNCEMENT_0_12_1: UpdateAnnouncement = {
  version: "0.12.1",
  title: "What’s new in Knowledge Base Command Center 0.12.1",
  intro: "This update is entirely about protecting your organization. Your notes and knowledge bases stay exactly as they are.",
  highlights: [
    "Plugin data is now backed up on this device before every save and restored automatically if the file cannot be read.",
    "Sync no longer discards edits made to a knowledge base that another device deleted; the newer copy is preserved in a private rescue.",
    "Switching or creating a knowledge base can no longer freeze the Command Center.",
    "Library drag-and-drop, group ordering, index health, and folder renames behave correctly again.",
    "Right-to-left names display properly in settings, and exports are stamped with your local date.",
  ],
  releaseUrl: "https://github.com/drbinsaad/knowledge-base-command-center/releases/tag/0.12.1",
};

export const UPDATE_ANNOUNCEMENT_0_13_0: UpdateAnnouncement = {
  version: "0.13.0",
  title: "What’s new in Knowledge Base Command Center 0.13.0",
  intro: "Subheadings can now hold subheadings, and large vaults feel considerably faster. Your notes stay exactly where they are.",
  highlights: [
    "Nest subheadings up to five levels deep in Collections and Libraries; removing one moves its notes and nested subheadings up to the parent.",
    "Editing a note no longer re-reads every file in the vault, and searching in Manage index no longer re-scans it on each keystroke.",
    "Destination pickers and Quick Entry now show the full path of each heading, so deep structures stay unambiguous.",
    "Portable packages and recovery files carry nested layouts; older packages still import, and older plugin versions keep your data read-only instead of flattening it.",
    "A starter template pack and an Apple Shortcuts guide are now included with the project documentation.",
  ],
  releaseUrl: "https://github.com/drbinsaad/knowledge-base-command-center/releases/tag/0.13.0",
};

export const UPDATE_ANNOUNCEMENT_0_13_1: UpdateAnnouncement = {
  version: "0.13.1",
  title: "What’s new in Knowledge Base Command Center 0.13.1",
  intro: "A compatibility fix for older iPhones, iPads, and Android devices. Nothing about your knowledge bases changes.",
  highlights: [
    "Fixed a failure to load on older mobile web views: the plugin used four JavaScript methods newer than the version it promises to support, one of them while reading note paths.",
    "The supported JavaScript level is now enforced when the plugin is built, so this cannot return unnoticed.",
    "Build and development tooling was updated; plugin behaviour is unchanged.",
  ],
  releaseUrl: "https://github.com/drbinsaad/knowledge-base-command-center/releases/tag/0.13.1",
};

export const UPDATE_ANNOUNCEMENT_0_13_2: UpdateAnnouncement = {
  version: "0.13.2",
  title: "What’s new in Knowledge Base Command Center 0.13.2",
  intro: "Nested subheadings can now be rearranged on iPhone and iPad, not only on desktop.",
  highlights: [
    "Every subheading menu gains Move under…, which lists the destinations it can move to by their full path, and Outdent one level for the common case.",
    "A move carries the subheading's notes and everything nested inside it, and destinations that would exceed the five-level limit or sit inside the subheading itself are not offered.",
    "These actions also appear on desktop, where a precise menu move is often easier than dragging.",
  ],
  releaseUrl: "https://github.com/drbinsaad/knowledge-base-command-center/releases/tag/0.13.2",
};

export const UPDATE_ANNOUNCEMENT_0_13_3: UpdateAnnouncement = {
  version: "0.13.3",
  title: "What’s new in Knowledge Base Command Center 0.13.3",
  intro: "A maintenance release. Nothing changes in how the plugin behaves — every message, command, and stored format is exactly as before.",
  highlights: [
    "Error messages are now produced in one place instead of about fifty, so future wording improvements reach every message at once. No message you can see changed.",
    "Moving a subheading on a touch device, added in 0.13.2, is now described in the user guide and troubleshooting notes.",
  ],
  releaseUrl: "https://github.com/drbinsaad/knowledge-base-command-center/releases/tag/0.13.3",
};

export const UPDATE_ANNOUNCEMENT_0_14_0: UpdateAnnouncement = {
  version: "0.14.0",
  title: "What’s new in Knowledge Base Command Center 0.14.0",
  intro: "Creating a note is now one step: the form opens aimed at your Inbox, and a Destination row can send it anywhere else. A full review pass also hardens syncing, older-device support, and data safety.",
  highlights: [
    "Create note opens one form that files into the Inbox by default — type a title and press Create. The Destination row re-targets the same form at the Index, a Collection heading or subheading, or a Library, and a Collection can now be chosen at creation time.",
    "Very long pasted text can no longer make the knowledge-base store open read-only on the next launch; every entry point now applies the same length bound the loader enforces.",
    "Restored compatibility with older mobile web views a second time: a platform API newer than the supported floor was in use, once while the plugin was still loading. The build now fails if it returns.",
    "Devices with different system languages can no longer disagree about the order of tied names, which could quietly reset sync history; stored ordering is now language-independent.",
    "Smaller fixes: focus no longer jumps while a synced change refreshes the compact view, collection menus act on the live items, Manage index Diagnostics recompute after in-modal changes, and upgrade documentation no longer names an outdated version.",
  ],
  releaseUrl: "https://github.com/drbinsaad/knowledge-base-command-center/releases/tag/0.14.0",
};

export const UPDATE_ANNOUNCEMENT_0_14_1: UpdateAnnouncement = {
  version: "0.14.1",
  title: "What’s new in Knowledge Base Command Center 0.14.1",
  intro: "A fix for the new create-note form: a note aimed at the Inbox can no longer end up invisible to the plugin.",
  highlights: [
    "The Inbox shows exactly the notes inside the folder configured as your Inbox. If the form's folder drifted outside that folder, the created note appeared in no tab and no search even though the file was safe in your vault.",
    "The form now refuses that mismatch with a clear explanation, names the real Inbox folder, and — if a change it cannot see still lands the file elsewhere — adds the note to the Index instead of losing track of it.",
    "If a note already vanished this way, the file is intact: move it into your configured Inbox folder, or use Add existing note to index it.",
  ],
  releaseUrl: "https://github.com/drbinsaad/knowledge-base-command-center/releases/tag/0.14.1",
};

const ANNOUNCEMENTS = new Map<string, UpdateAnnouncement>([
  [UPDATE_ANNOUNCEMENT_0_12_0.version, UPDATE_ANNOUNCEMENT_0_12_0],
  [UPDATE_ANNOUNCEMENT_0_12_1.version, UPDATE_ANNOUNCEMENT_0_12_1],
  [UPDATE_ANNOUNCEMENT_0_13_0.version, UPDATE_ANNOUNCEMENT_0_13_0],
  [UPDATE_ANNOUNCEMENT_0_13_1.version, UPDATE_ANNOUNCEMENT_0_13_1],
  [UPDATE_ANNOUNCEMENT_0_13_2.version, UPDATE_ANNOUNCEMENT_0_13_2],
  [UPDATE_ANNOUNCEMENT_0_13_3.version, UPDATE_ANNOUNCEMENT_0_13_3],
  [UPDATE_ANNOUNCEMENT_0_14_0.version, UPDATE_ANNOUNCEMENT_0_14_0],
  [UPDATE_ANNOUNCEMENT_0_14_1.version, UPDATE_ANNOUNCEMENT_0_14_1],
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
