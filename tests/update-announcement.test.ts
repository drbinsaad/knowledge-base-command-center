import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import EntVaultCommandCenterPlugin, { SYNC_RECOVERY_LOCAL_STATE_KEY } from "../src/main.ts";
import { INDEX_FOLDER_VAULT_ROOT, type IndexFolderSource } from "../src/model.ts";
import { UpdateAnnouncementModal } from "../src/update-announcement-modal.ts";
import {
  compareSemanticVersions,
  isSemanticVersion,
  planUpdateAnnouncement,
  UPDATE_ANNOUNCEMENT_0_12_0,
  UPDATE_ANNOUNCEMENT_0_16_0,
  UPDATE_ANNOUNCEMENT_0_16_1,
  UPDATE_ANNOUNCEMENT_0_17_0,
  UPDATE_ANNOUNCEMENT_0_18_0,
  UPDATE_ANNOUNCEMENT_0_19_0,
  type UpdateAnnouncement,
} from "../src/update-announcement.ts";
import { asHtmlElement, createFakeDom } from "./support/fake-dom.ts";

test("semantic version comparison handles large identifiers, prereleases, builds, and invalid values", () => {
  assert.equal(compareSemanticVersions("0.12.0", "0.11.99"), 1);
  assert.equal(compareSemanticVersions("100000000000000000000.0.0", "99999999999999999999.99.99"), 1);
  assert.equal(compareSemanticVersions("0.12.0-alpha.2", "0.12.0-alpha.10"), -1);
  assert.equal(compareSemanticVersions("0.12.0-alpha", "0.12.0-alpha.1"), -1);
  assert.equal(compareSemanticVersions("0.12.0-1", "0.12.0-alpha"), -1);
  assert.equal(compareSemanticVersions("0.12.0-rc.1", "0.12.0"), -1);
  assert.equal(compareSemanticVersions("0.12.0+desktop", "0.12.0+mobile"), 0);
  assert.equal(compareSemanticVersions("v0.12.0", "0.12.0"), null);
  assert.equal(compareSemanticVersions("0.12", "0.12.0"), null);
  assert.equal(compareSemanticVersions("0.12.0-01", "0.12.0-1"), null);
  assert.equal(isSemanticVersion(`0.12.0+${"x".repeat(128)}`), false, "device-local version text is length-bounded");
});

test("fresh installs establish a baseline without showing an update window", () => {
  const first = planUpdateAnnouncement("0.12.0", null, false);
  assert.equal(first.announcement, null);
  assert.equal(first.shouldPersist, true);
  assert.equal(first.nextHighestObservedVersion, "0.12.0");

  const later = planUpdateAnnouncement("0.12.0", first.nextHighestObservedVersion, true);
  assert.equal(later.announcement, null);
  assert.equal(later.shouldPersist, false);
});

test("existing installs see each catalogued upgrade once and receive the exact release URL", () => {
  const noPriorMarker = planUpdateAnnouncement("0.12.0", null, true);
  assert.equal(noPriorMarker.announcement?.version, "0.12.0");
  assert.equal(noPriorMarker.announcement?.releaseUrl, "https://github.com/drbinsaad/knowledge-base-command-center/releases/tag/0.12.0");
  assert.equal(noPriorMarker.nextHighestObservedVersion, "0.12.0");

  const repeat = planUpdateAnnouncement("0.12.0", noPriorMarker.nextHighestObservedVersion, true);
  assert.equal(repeat.announcement, null);
  assert.equal(repeat.shouldPersist, false);

  const fromEarlierRelease = planUpdateAnnouncement("0.12.0", "0.11.0", true);
  assert.equal(fromEarlierRelease.announcement?.version, "0.12.0");
  assert.equal(fromEarlierRelease.nextHighestObservedVersion, "0.12.0");
});

test("0.16.0 has curated explicit-membership and safety news", () => {
  const upgrade = planUpdateAnnouncement("0.16.0", "0.15.0", true);
  assert.equal(upgrade.announcement, UPDATE_ANNOUNCEMENT_0_16_0);
  assert.equal(UPDATE_ANNOUNCEMENT_0_16_0.highlights.length, 5);
  assert.match(UPDATE_ANNOUNCEMENT_0_16_0.highlights.join("\n"), /default new-note folder/u);
  assert.match(UPDATE_ANNOUNCEMENT_0_16_0.highlights.join("\n"), /direct membership/u);
  assert.match(UPDATE_ANNOUNCEMENT_0_16_0.highlights.join("\n"), /linked folder is a named, removable Index source/u);
  assert.match(UPDATE_ANNOUNCEMENT_0_16_0.highlights.join("\n"), /rechecks the exact preview/u);
  assert.equal(
    UPDATE_ANNOUNCEMENT_0_16_0.releaseUrl,
    "https://github.com/drbinsaad/knowledge-base-command-center/releases/tag/0.16.0",
  );
});

test("0.16.1 has curated legacy-folder review news", () => {
  const upgrade = planUpdateAnnouncement("0.16.1", "0.16.0", true);
  assert.equal(upgrade.announcement, UPDATE_ANNOUNCEMENT_0_16_1);
  assert.equal(UPDATE_ANNOUNCEMENT_0_16_1.highlights.length, 5);
  const highlights = UPDATE_ANNOUNCEMENT_0_16_1.highlights.join("\n");
  assert.match(highlights, /legacy linked folder/u);
  assert.match(highlights, /durable direct members/u);
  assert.match(highlights, /Obsidian Sync is finished/u);
  assert.match(highlights, /Direct, Linked folder, Imported placeholder, or Protected source/u);
  assert.equal(
    UPDATE_ANNOUNCEMENT_0_16_1.releaseUrl,
    "https://github.com/drbinsaad/knowledge-base-command-center/releases/tag/0.16.1",
  );
});

test("0.17.0 has curated membership explanation and placeholder-resolution news", () => {
  const upgrade = planUpdateAnnouncement("0.17.0", "0.16.1", true);
  assert.equal(upgrade.announcement, UPDATE_ANNOUNCEMENT_0_17_0);
  assert.equal(UPDATE_ANNOUNCEMENT_0_17_0.highlights.length, 5);
  const highlights = UPDATE_ANNOUNCEMENT_0_17_0.highlights.join("\n");
  assert.match(highlights, /Why this appears/u);
  assert.match(highlights, /never link automatically/u);
  assert.match(highlights, /large placeholder imports require an extra confirmation/u);
  assert.match(highlights, /undo the import/u);
  assert.equal(
    UPDATE_ANNOUNCEMENT_0_17_0.releaseUrl,
    "https://github.com/drbinsaad/knowledge-base-command-center/releases/tag/0.17.0",
  );
});

test("0.18.0 has curated Global Note Organizer and safety news", () => {
  const upgrade = planUpdateAnnouncement("0.18.0", "0.17.0", true);
  assert.equal(upgrade.announcement, UPDATE_ANNOUNCEMENT_0_18_0);
  assert.equal(UPDATE_ANNOUNCEMENT_0_18_0.highlights.length, 5);
  const highlights = UPDATE_ANNOUNCEMENT_0_18_0.highlights.join("\n");
  assert.match(highlights, /Notes → Destinations → Review/u);
  assert.match(highlights, /untargeted bases stay unchanged/u);
  assert.match(highlights, /color-independent organization indicator/u);
  assert.match(highlights, /durable Undo/u);
  assert.match(highlights, /never creates, moves, renames, deletes, or rewrites Markdown/u);
  assert.equal(
    UPDATE_ANNOUNCEMENT_0_18_0.releaseUrl,
    "https://github.com/drbinsaad/knowledge-base-command-center/releases/tag/0.18.0",
  );
});

test("0.19.0 has curated in-place creation and return-navigation news", () => {
  const upgrade = planUpdateAnnouncement("0.19.0", "0.18.0", true);
  assert.equal(upgrade.announcement, UPDATE_ANNOUNCEMENT_0_19_0);
  assert.equal(UPDATE_ANNOUNCEMENT_0_19_0.highlights.length, 5);
  const highlights = UPDATE_ANNOUNCEMENT_0_19_0.highlights.join("\n");
  assert.match(highlights, /Create note here/u);
  assert.match(highlights, /before file creation/u);
  assert.match(highlights, /beside the organization indicator/u);
  assert.match(highlights, /survive Obsidian restarts/u);
  assert.match(highlights, /device-local/u);
  assert.equal(
    UPDATE_ANNOUNCEMENT_0_19_0.releaseUrl,
    "https://github.com/drbinsaad/knowledge-base-command-center/releases/tag/0.19.0",
  );
});

test("downgrades never replay an announcement and prerelease precedence stays deterministic", () => {
  const downgrade = planUpdateAnnouncement("0.12.0", "0.13.0", true);
  assert.equal(downgrade.announcement, null);
  assert.equal(downgrade.nextHighestObservedVersion, "0.13.0");
  assert.equal(downgrade.shouldPersist, false);

  const prerelease = planUpdateAnnouncement("0.12.0-rc.1", "0.11.0", true);
  assert.equal(prerelease.announcement, null, "uncatalogued prereleases are never presented as stable release news");
  assert.equal(prerelease.nextHighestObservedVersion, "0.12.0-rc.1");
  const stable = planUpdateAnnouncement("0.12.0", prerelease.nextHighestObservedVersion, true);
  assert.equal(stable.announcement?.version, "0.12.0");

  const localBuild = planUpdateAnnouncement("0.12.0+local", "0.11.0", true);
  assert.equal(localBuild.announcement, null, "a non-release build cannot borrow the stable tag announcement");
});

test("malformed local version state is bounded and recoverable without trusting partial values", () => {
  for (const malformed of [
    "bad",
    { highestObservedVersion: "0.11.0" },
    `0.12.0+${"x".repeat(128)}`,
  ]) {
    const recovered = planUpdateAnnouncement("0.12.0", malformed, true);
    assert.equal(recovered.malformedStoredVersion, true);
    assert.equal(recovered.announcement?.version, "0.12.0");
    assert.equal(recovered.nextHighestObservedVersion, "0.12.0");
  }
});

interface AnnouncementInternal {
  maybeShowUpdateAnnouncement(result: { compatible: boolean; sourceWasMissing: boolean }): void;
  openUpdateAnnouncement(announcement: UpdateAnnouncement): void;
  openCurrentUpdateAnnouncement(announcement: UpdateAnnouncement): void;
  unloaded: boolean;
  deviceLocalPersistenceSuppressed: boolean;
  loadSyncRecoveryLocalState(): void;
}

interface LegacyReviewLifecycleInternal {
  maybeShowLegacyIndexReview(): void;
  openLegacyIndexReview(sourceId?: string): void;
  unloaded: boolean;
  deviceLocalPersistenceSuppressed: boolean;
}

function availableLegacySource(): IndexFolderSource {
  return { id: "legacy-root", path: INDEX_FOLDER_VAULT_ROOT, origin: "legacy-primary-folder" };
}

function announcementPlugin(
  localStorage: Map<string, unknown>,
  opens: UpdateAnnouncement[],
  options: { failSave?: boolean; version?: string } = {},
): EntVaultCommandCenterPlugin & AnnouncementInternal {
  const app = {
    loadLocalStorage: (key: string) => structuredClone(localStorage.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => {
      if (options.failSave) throw new Error("private storage path");
      localStorage.set(key, structuredClone(value));
    },
  };
  const plugin = new EntVaultCommandCenterPlugin(app as never, {
    version: options.version ?? "0.12.0",
  } as never) as EntVaultCommandCenterPlugin & AnnouncementInternal;
  plugin.openUpdateAnnouncement = (announcement) => { opens.push(announcement); };
  return plugin;
}

test("plugin lifecycle persists before opening and never repeats within a session or reload", () => {
  const localStorage = new Map<string, unknown>();
  const opens: UpdateAnnouncement[] = [];
  const first = announcementPlugin(localStorage, opens);
  first.maybeShowUpdateAnnouncement({ compatible: true, sourceWasMissing: false });
  first.maybeShowUpdateAnnouncement({ compatible: true, sourceWasMissing: false });
  assert.equal(opens.length, 1);
  assert.equal(
    (localStorage.get(SYNC_RECOVERY_LOCAL_STATE_KEY) as { highestPluginVersionSeen?: unknown })?.highestPluginVersionSeen,
    "0.12.0",
    "the one-time marker is durable before the modal opens",
  );

  const reloaded = announcementPlugin(localStorage, opens);
  reloaded.maybeShowUpdateAnnouncement({ compatible: true, sourceWasMissing: false });
  assert.equal(opens.length, 1);
});

test("two replacement instances with stale local snapshots share one synchronous App-lifetime claim", () => {
  const localStorage = new Map<string, unknown>();
  const app = {
    loadLocalStorage: (key: string) => structuredClone(localStorage.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => { localStorage.set(key, structuredClone(value)); },
  };
  const opened: UpdateAnnouncement[] = [];
  const create = () => {
    const plugin = new EntVaultCommandCenterPlugin(app as never, { version: "0.12.0" } as never) as
      EntVaultCommandCenterPlugin & AnnouncementInternal;
    plugin.openUpdateAnnouncement = (announcement) => { opened.push(announcement); };
    return plugin;
  };
  const first = create();
  const replacement = create();
  first.loadSyncRecoveryLocalState();
  replacement.loadSyncRecoveryLocalState();
  first.maybeShowUpdateAnnouncement({ compatible: true, sourceWasMissing: false });
  replacement.maybeShowUpdateAnnouncement({ compatible: true, sourceWasMissing: false });
  assert.equal(opened.length, 1);
});

test("legacy folder review is offered once per App session and remains eligible after restart", () => {
  const opened: string[] = [];
  const create = (app: object) => {
    const plugin = new EntVaultCommandCenterPlugin(app as never, { version: "0.16.0" } as never) as
      EntVaultCommandCenterPlugin & LegacyReviewLifecycleInternal;
    plugin.data.settings.workspaceMode = "generic";
    plugin.data.indexFolderSources = [availableLegacySource()];
    plugin.openLegacyIndexReview = () => { opened.push(plugin.getActiveKnowledgeBaseId()); };
    return plugin;
  };

  const firstApp = {};
  const first = create(firstApp);
  const replacement = create(firstApp);
  first.maybeShowLegacyIndexReview();
  first.maybeShowLegacyIndexReview();
  replacement.maybeShowLegacyIndexReview();
  assert.equal(opened.length, 1, "Not now or a hot-reload cannot repeat the automatic offer in one App session");

  create({}).maybeShowLegacyIndexReview();
  assert.equal(opened.length, 2, "a full Obsidian restart offers an unresolved legacy source again");
});

test("legacy folder review is not offered without a writable Generic legacy source", () => {
  for (const mode of ["fresh", "clinical", "read-only", "unloaded", "suppressed"] as const) {
    const plugin = new EntVaultCommandCenterPlugin({} as never, { version: "0.16.0" } as never) as
      EntVaultCommandCenterPlugin & LegacyReviewLifecycleInternal;
    if (mode !== "fresh") plugin.data.indexFolderSources = [availableLegacySource()];
    if (mode === "clinical") plugin.data.settings.workspaceMode = "ent-clinical";
    if (mode === "read-only") plugin.dataCompatibilityWarning = "Protected read-only state";
    if (mode === "unloaded") plugin.unloaded = true;
    if (mode === "suppressed") plugin.deviceLocalPersistenceSuppressed = true;
    let opens = 0;
    plugin.openLegacyIndexReview = () => { opens += 1; };
    plugin.maybeShowLegacyIndexReview();
    assert.equal(opens, 0, mode);
  }
});

test("plugin lifecycle skips fresh installs and fails closed when its one-time marker cannot persist", () => {
  const freshStorage = new Map<string, unknown>();
  const freshOpens: UpdateAnnouncement[] = [];
  announcementPlugin(freshStorage, freshOpens).maybeShowUpdateAnnouncement({ compatible: true, sourceWasMissing: true });
  assert.equal(freshOpens.length, 0);
  assert.equal(
    (freshStorage.get(SYNC_RECOVERY_LOCAL_STATE_KEY) as { highestPluginVersionSeen?: unknown })?.highestPluginVersionSeen,
    "0.12.0",
  );

  const failedStorage = new Map<string, unknown>();
  const failedOpens: UpdateAnnouncement[] = [];
  announcementPlugin(failedStorage, failedOpens, { failSave: true })
    .maybeShowUpdateAnnouncement({ compatible: true, sourceWasMissing: false });
  assert.equal(failedOpens.length, 0, "a modal that cannot be marked as shown is not replayed on every restart");

  const invalidVersionStorage = new Map<string, unknown>();
  const invalidVersionOpens: UpdateAnnouncement[] = [];
  announcementPlugin(invalidVersionStorage, invalidVersionOpens, { version: "development" })
    .maybeShowUpdateAnnouncement({ compatible: true, sourceWasMissing: false });
  assert.equal(invalidVersionOpens.length, 0);
  assert.equal(invalidVersionStorage.size, 0);
});

test("incompatible, unloaded, and privacy-reset lifecycles never open over their primary safety state", () => {
  for (const mode of ["incompatible", "unloaded", "suppressed"] as const) {
    const localStorage = new Map<string, unknown>();
    const opens: UpdateAnnouncement[] = [];
    const plugin = announcementPlugin(localStorage, opens);
    if (mode === "unloaded") plugin.unloaded = true;
    if (mode === "suppressed") plugin.deviceLocalPersistenceSuppressed = true;
    plugin.maybeShowUpdateAnnouncement({ compatible: mode !== "incompatible", sourceWasMissing: false });
    assert.equal(opens.length, 0, mode);
    if (mode === "incompatible") {
      assert.equal(
        (localStorage.get(SYNC_RECOVERY_LOCAL_STATE_KEY) as { highestPluginVersionSeen?: unknown })?.highestPluginVersionSeen,
        "0.12.0",
      );
    } else {
      assert.equal(localStorage.size, 0);
    }
  }
});

test("manual reopening marks the release, refuses stacked duplicates, and closes its active modal on unload", () => {
  const localStorage = new Map<string, unknown>();
  const plugin = announcementPlugin(localStorage, []);
  Reflect.deleteProperty(plugin, "openUpdateAnnouncement");
  const originalOpen = Reflect.get(UpdateAnnouncementModal.prototype, "open");
  const originalClose = Reflect.get(UpdateAnnouncementModal.prototype, "close");
  let opens = 0;
  let closes = 0;
  UpdateAnnouncementModal.prototype.open = function open(): void { opens += 1; };
  UpdateAnnouncementModal.prototype.close = function close(): void { closes += 1; };
  try {
    plugin.openCurrentUpdateAnnouncement(UPDATE_ANNOUNCEMENT_0_12_0);
    plugin.openCurrentUpdateAnnouncement(UPDATE_ANNOUNCEMENT_0_12_0);
    plugin.maybeShowUpdateAnnouncement({ compatible: true, sourceWasMissing: false });
    assert.equal(opens, 1);
    assert.equal(
      (localStorage.get(SYNC_RECOVERY_LOCAL_STATE_KEY) as { highestPluginVersionSeen?: unknown })?.highestPluginVersionSeen,
      "0.12.0",
    );
    plugin.onunload();
    assert.equal(closes, 1);
  } finally {
    Reflect.set(UpdateAnnouncementModal.prototype, "open", originalOpen);
    Reflect.set(UpdateAnnouncementModal.prototype, "close", originalClose);
  }
});

test("What’s New finishes before the once-per-session legacy review is offered", () => {
  const localStorage = new Map<string, unknown>();
  const plugin = announcementPlugin(localStorage, [], { version: "0.16.1" });
  Reflect.deleteProperty(plugin, "openUpdateAnnouncement");
  plugin.data.indexFolderSources = [availableLegacySource()];
  let legacyOpens = 0;
  plugin.openLegacyIndexReview = () => {
    legacyOpens += 1;
  };
  const originalOpen = Reflect.get(UpdateAnnouncementModal.prototype, "open");
  const updateModals: UpdateAnnouncementModal[] = [];
  UpdateAnnouncementModal.prototype.open = function open(): void { updateModals.push(this); };
  try {
    plugin.maybeShowUpdateAnnouncement({ compatible: true, sourceWasMissing: false });
    const updateModal = updateModals[0];
    assert.ok(updateModal);
    assert.equal(legacyOpens, 0, "the two startup modals never stack");
    Object.assign(updateModal, { contentEl: { empty: () => undefined } });
    updateModal.onClose();
    assert.equal(legacyOpens, 1);
  } finally {
    Reflect.set(UpdateAnnouncementModal.prototype, "open", originalOpen);
  }
});

test("an App-wide What’s New barrier blocks a replacement instance's legacy review", () => {
  const localStorage = new Map<string, unknown>();
  const app = {
    loadLocalStorage: (key: string) => structuredClone(localStorage.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => { localStorage.set(key, structuredClone(value)); },
  };
  const announcement = new EntVaultCommandCenterPlugin(app as never, { version: "0.16.0" } as never) as
    EntVaultCommandCenterPlugin & AnnouncementInternal;
  const replacement = new EntVaultCommandCenterPlugin(app as never, { version: "0.16.0" } as never) as
    EntVaultCommandCenterPlugin & LegacyReviewLifecycleInternal;
  replacement.data.indexFolderSources = [availableLegacySource()];
  let legacyOpens = 0;
  replacement.openLegacyIndexReview = () => { legacyOpens += 1; };

  announcement.openCurrentUpdateAnnouncement(UPDATE_ANNOUNCEMENT_0_16_0);
  replacement.maybeShowLegacyIndexReview();
  assert.equal(legacyOpens, 0, "replacement instances share the active update-modal barrier");

  announcement.onunload();
  replacement.maybeShowLegacyIndexReview();
  assert.equal(legacyOpens, 1);
});

test("onLayoutReady owns automatic presentation and unload prevents a late or duplicate open", async () => {
  const createLifecycle = () => {
    const localStorage = new Map<string, unknown>();
    let layoutReady: (() => void) | null = null;
    let subscriptions = 0;
    const app = {
      vault: {
        configDir: ".obsidian",
        getMarkdownFiles: () => [],
        getAbstractFileByPath: () => null,
        createFolder: async () => {},
        create: async () => null,
        on: () => { subscriptions += 1; return { unsubscribe: () => {} }; },
      },
      workspace: {
        getActiveFile: () => null,
        getLeavesOfType: () => [],
        onLayoutReady: (callback: () => void) => { layoutReady = callback; },
      },
      metadataCache: {
        getFileCache: () => null,
        on: () => { subscriptions += 1; return { unsubscribe: () => {} }; },
      },
      fileManager: {},
      loadLocalStorage: (key: string) => structuredClone(localStorage.get(key) ?? null),
      saveLocalStorage: (key: string, value: unknown) => { localStorage.set(key, structuredClone(value)); },
    };
    const plugin = new EntVaultCommandCenterPlugin(app as never, {
      id: "ent-vault-command-center",
      name: "Knowledge Base Command Center",
      version: "0.12.0",
    } as never) as EntVaultCommandCenterPlugin & AnnouncementInternal & {
      loadPluginData(): Promise<{ compatible: boolean; sourceWasMissing: boolean }>;
      registerObsidianProtocolHandler(): void;
    };
    plugin.loadPluginData = async () => ({ compatible: true, sourceWasMissing: false });
    plugin.registerObsidianProtocolHandler = () => {};
    const opened: UpdateAnnouncement[] = [];
    plugin.openUpdateAnnouncement = (announcement) => { opened.push(announcement); };
    return { plugin, opened, ready: () => layoutReady?.(), subscriptions: () => subscriptions };
  };

  const active = createLifecycle();
  await active.plugin.onload();
  assert.equal(active.opened.length, 0);
  active.ready();
  active.ready();
  assert.equal(active.opened.length, 1);
  assert.equal(active.subscriptions(), 4, "layout readiness installs one owned listener set");

  const unloaded = createLifecycle();
  await unloaded.plugin.onload();
  unloaded.plugin.onunload();
  unloaded.ready();
  assert.equal(unloaded.opened.length, 0);
  assert.equal(unloaded.subscriptions(), 0, "a late layout callback installs no post-unload listeners");
});

test("What’s New modal is semantic, owner-document local, touch-sized, and safely links to the exact release", () => {
  const dom = createFakeDom();
  const modal = new UpdateAnnouncementModal({}, UPDATE_ANNOUNCEMENT_0_12_0) as UpdateAnnouncementModal & {
    modalEl: HTMLElement;
    contentEl: HTMLElement;
    titleEl: HTMLElement;
    close(): void;
  };
  modal.modalEl = asHtmlElement(dom.document.body.createDiv());
  modal.contentEl = asHtmlElement(dom.document.body.createDiv());
  modal.titleEl = asHtmlElement(dom.document.body.createEl("h2"));
  let closes = 0;
  modal.close = () => { closes += 1; };
  modal.onOpen();

  assert.equal(modal.titleEl.textContent, "What’s new in Knowledge Base Command Center 0.12.0");
  const descriptionId = modal.modalEl.getAttribute("aria-describedby");
  assert.match(descriptionId ?? "", /^ent-cc-whats-new-intro-\d+$/u);
  assert.equal(modal.contentEl.querySelector(`[id="${descriptionId}"]`)?.textContent, UPDATE_ANNOUNCEMENT_0_12_0.intro);
  const region = modal.contentEl.querySelector('[role="region"]');
  assert.ok(region);
  assert.equal(region.ownerDocument, dom.document as unknown as Document);
  assert.equal(region.getAttribute("aria-label"), "Version 0.12.0 highlights");
  assert.equal(modal.contentEl.querySelectorAll("li").length, UPDATE_ANNOUNCEMENT_0_12_0.highlights.length);
  const link = modal.contentEl.querySelector<HTMLAnchorElement>("a.ent-cc-whats-new-release-link");
  assert.ok(link);
  assert.equal(link.getAttribute("href"), UPDATE_ANNOUNCEMENT_0_12_0.releaseUrl);
  assert.equal(link.getAttribute("target"), "_blank");
  assert.equal(link.getAttribute("rel"), "noopener noreferrer");
  assert.match(link.getAttribute("aria-label") ?? "", /opens in your browser/i);
  assert.equal(dom.document.activeElement, null, "initial focus remains with Obsidian's modal title/context policy");

  const close = modal.contentEl.querySelector<HTMLButtonElement>('button[type="button"]');
  assert.ok(close);
  assert.equal(close.textContent, "Continue");
  close.click();
  assert.equal(closes, 1);
  modal.onClose();
  assert.equal(modal.contentEl.textContent, "");
});

test("What’s New source has no network API and its responsive modal has one bounded scroll owner", () => {
  const dom = createFakeDom();
  const source = readFileSync(new URL("../src/update-announcement-modal.ts", import.meta.url), "utf8")
    + readFileSync(new URL("../src/update-announcement.ts", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket|requestUrl|sendBeacon)\b/u);
  assert.doesNotMatch(source, /\bwindow\b|activeWindow/u);
  assert.match(source, /target: "_blank"[\s\S]*?rel: "noopener noreferrer"/u);
  assert.match(styles, /\.ent-cc-whats-new-body\s*\{[^}]*overflow-y:\s*auto/su);
  assert.doesNotMatch(styles, /\.ent-cc-whats-new(?:-modal)?\s*\{[^}]*overflow-y:\s*auto/su);
  assert.match(styles, /\.ent-cc-whats-new-actions \.ent-cc-button\s*\{[^}]*min-height:\s*44px/su);
  assert.match(styles, /\.ent-cc-whats-new-actions \.ent-cc-button\s*\{[^}]*font-size:\s*var\(--font-ui-small\)/su);
  assert.match(styles, /\.ent-cc-whats-new-modal\s*\{[^}]*100dvh/su);
  const hostModal = dom.document.body.createDiv({ cls: "ent-cc-whats-new-modal" });
  const hostHeader = hostModal.createDiv({ cls: "modal-header" });
  const hostTitle = hostHeader.createDiv({ cls: "modal-title" });
  assert.equal(hostTitle.parentElement, hostHeader);
  assert.equal(hostHeader.parentElement, hostModal, "the fixture preserves Obsidian's inspected modal header nesting");
  assert.match(styles, /\.ent-cc-whats-new-modal\s*>\s*\.modal-header\s*>\s*\.modal-title\s*\{[^}]*padding-inline-end:\s*calc\(44px \+ var\(--size-4-3, 12px\)\)/su);
  assert.match(styles, /\.ent-cc-whats-new-modal\s*>\s*\.modal-header\s*>\s*\.modal-title\s*\{[^}]*overflow:\s*visible[^}]*text-overflow:\s*clip/su);
  assert.match(styles, /\.ent-cc-whats-new-modal\s*>\s*\.modal-header\s*>\s*\.modal-title\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*white-space:\s*normal/su);
});
