import { App, Notice, Plugin, PluginSettingTab, Setting, SettingDefinitionItem, SettingDefinitionRender, TFile, TFolder } from "obsidian";
import { ManageKnowledgeBasesModal } from "./knowledge-base-modal";
import { ManageLibrariesModal } from "./library-modal";
import { FollowUpCategoryManagerModal } from "./follow-up-modal";
import type { FollowUpCategoryDefinition } from "./follow-up";
import { ManageLibraryNoteProfilesModal } from "./library-profile-modal";
import type EntVaultCommandCenterPlugin from "./main";
import {
  asUnknownRecord,
  DEFAULT_PROPOSAL_FOLDER,
  libraryTabId,
  pathIsInsideFolder,
  validateProposalFolderPath,
  validateWritableFolderPath,
  type LibraryDefinition,
  type AttachmentInsertionMode,
  type AttachmentStorageMode,
  type MainTab,
  type NewNoteMode,
  type OpenNoteBehavior,
  type KnowledgeBaseEntry,
  type PluginData,
  objectFromEntries,
} from "./model";
import { createOpenedBaseGuard, StringPickerModal, TextPromptModal, VaultFilePickerModal } from "./modals";

interface SettingsHost extends Plugin {
  data: PluginData;
  savePluginData(): Promise<void>;
  saveCompensatingRollback(): Promise<void>;
  markPersistenceUncertain(message: string): void;
  refreshViews(): Promise<void>;
  getTemplateFiles(): TFile[];
  getIndexGroups(): string[];
  getIndexRecords(): Array<{ path: string }>;
  isDataReadOnly(): boolean;
  dataCompatibilityWarning: string;
  getKnowledgeBases(includeArchived?: boolean): KnowledgeBaseEntry[];
  getActiveKnowledgeBaseId(): string;
  getDataEpoch?(): number;
  getExternalChangeGeneration?(): number;
  switchKnowledgeBase(id: string): Promise<void>;
  renameKnowledgeBase(id: string, name: string): Promise<void>;
  getLibraries(includeArchived?: boolean): LibraryDefinition[];
  librarySubjectCount(id: string): number;
  getFollowUpCategories(): FollowUpCategoryDefinition[];
  replaceFollowUpCategories(categories: readonly FollowUpCategoryDefinition[]): Promise<void>;
}

type DirectSettingsDataField = "activeTab" | "indexGroupOrder";

function renderSetting(
  name: string,
  desc: string,
  render: (setting: Setting) => void,
  aliases: string[] = [],
): SettingDefinitionRender {
  return {
    name,
    desc,
    aliases,
    render: (setting) => {
      setting.settingEl.addClass("ent-cc-setting");
      render(setting);
    },
  };
}

export class EntCommandCenterSettingsTab extends PluginSettingTab {
  private static readonly TEXT_SAVE_DELAY_MS = 600;
  private persistedDataSnapshot: PluginData | null = null;
  private settingsSaveRevision = 0;
  private persistedSettingsRevision = 0;
  private pendingSettingsSaves = 0;
  private settingsSaveBarrier: Promise<boolean> = Promise.resolve(true);
  private settingsWriteUncertain = false;
  private settingsRefreshPending = false;
  private settingsRefreshGeneration = 0;
  private bufferedTextSaveTimer: number | null = null;
  private bufferedTextSaveWindow: Window | null = null;
  private bufferedTextSaveBaseId = "";
  private bufferedTextSaveDataEpoch = 0;
  private bufferedTextSaveExternalGeneration = 0;
  private bufferedTextSaveData: PluginData | null = null;
  private bufferedTextSaveRefresh = false;

  constructor(app: App, private readonly host: SettingsHost) {
    super(app, host);
  }

  private rollbackAttemptedData(
    baseline: PluginData,
    attempted: PluginData,
    directDataFields: readonly DirectSettingsDataField[],
  ): void {
    const live = this.host.data;
    const liveSettings = live.settings as unknown as Record<string, unknown>;
    const baselineSettings = baseline.settings as unknown as Record<string, unknown>;
    const attemptedSettings = attempted.settings as unknown as Record<string, unknown>;
    for (const key of Object.keys(attemptedSettings)) {
      const before = baselineSettings[key];
      const tried = attemptedSettings[key];
      // Restore only fields this settings attempt changed, and only while the
      // live field still contains that attempted value. This is a three-way
      // rollback: a concurrent rename or other newer writer remains untouched.
      if (!Object.is(before, tried) && Object.is(liveSettings[key], tried)) {
        liveSettings[key] = before;
      }
    }
    if (directDataFields.includes("activeTab")
      && baseline.activeTab !== attempted.activeTab
      && live.activeTab === attempted.activeTab) {
      live.activeTab = baseline.activeTab;
    }
    const sameOrder = (left: readonly string[], right: readonly string[]): boolean => (
      left.length === right.length && left.every((value, index) => value === right[index])
    );
    if (directDataFields.includes("indexGroupOrder")
      && !sameOrder(baseline.indexGroupOrder, attempted.indexGroupOrder)
      && sameOrder(live.indexGroupOrder, attempted.indexGroupOrder)) {
      live.indexGroupOrder = [...baseline.indexGroupOrder];
    }
  }

  private clearBufferedTextSaveTimer(): void {
    if (this.bufferedTextSaveTimer !== null) {
      this.bufferedTextSaveWindow?.clearTimeout(this.bufferedTextSaveTimer);
    }
    this.bufferedTextSaveTimer = null;
    this.bufferedTextSaveWindow = null;
  }

  private hasPersistedSettingsChange(directDataFields: readonly DirectSettingsDataField[]): boolean {
    const persisted = this.persistedDataSnapshot;
    if (!persisted) return true;
    if (JSON.stringify(this.host.data.settings) !== JSON.stringify(persisted.settings)) return true;
    if (directDataFields.includes("activeTab") && this.host.data.activeTab !== persisted.activeTab) return true;
    if (directDataFields.includes("indexGroupOrder")) {
      const current = this.host.data.indexGroupOrder;
      const previous = persisted.indexGroupOrder;
      if (current.length !== previous.length || current.some((value, index) => value !== previous[index])) return true;
    }
    return false;
  }

  private requestSettingsRefresh(): void {
    this.settingsRefreshPending = true;
    this.settingsRefreshGeneration = (this.settingsRefreshGeneration ?? 0) + 1;
  }

  private scheduleTextSave(refresh = true): void {
    const viewWindow = this.containerEl.ownerDocument.defaultView;
    if (!viewWindow) {
      void this.save(refresh);
      return;
    }
    this.clearBufferedTextSaveTimer();
    this.bufferedTextSaveWindow = viewWindow;
    this.bufferedTextSaveBaseId = this.host.getActiveKnowledgeBaseId();
    this.bufferedTextSaveDataEpoch = this.host.getDataEpoch?.() ?? 0;
    this.bufferedTextSaveExternalGeneration = this.host.getExternalChangeGeneration?.() ?? 0;
    this.bufferedTextSaveData = this.host.data;
    this.bufferedTextSaveRefresh = this.bufferedTextSaveRefresh || refresh;
    if (refresh) this.requestSettingsRefresh();
    this.bufferedTextSaveTimer = viewWindow.setTimeout(() => {
      void this.flushBufferedTextSave();
    }, EntCommandCenterSettingsTab.TEXT_SAVE_DELAY_MS);
  }

  private async flushBufferedTextSave(acceptCompensatedRejection = false): Promise<boolean> {
    if (this.bufferedTextSaveTimer === null) return true;
    const openedBaseId = this.bufferedTextSaveBaseId;
    const openedDataEpoch = this.bufferedTextSaveDataEpoch;
    const openedExternalGeneration = this.bufferedTextSaveExternalGeneration;
    const openedData = this.bufferedTextSaveData;
    const refresh = this.bufferedTextSaveRefresh;
    this.clearBufferedTextSaveTimer();
    this.bufferedTextSaveRefresh = false;
    this.bufferedTextSaveData = null;
    if (this.host.data !== openedData
      || this.host.getActiveKnowledgeBaseId() !== openedBaseId
      || (this.host.getDataEpoch?.() ?? 0) !== openedDataEpoch
      || (this.host.getExternalChangeGeneration?.() ?? 0) !== openedExternalGeneration) {
      new Notice("The active knowledge base changed or synced data was replaced. Reopen this setting before continuing.", 8000);
      this.persistedDataSnapshot = structuredClone(this.host.data);
      this.update();
      return false;
    }
    const saved = await this.save(refresh);
    if (saved || !acceptCompensatedRejection) return saved;
    // The user's requested value was rejected, but a base lifecycle operation
    // only needs memory and disk to have converged. The save barrier resolves
    // true after a verified host/Sync compensation and stays false for an
    // ambiguous partial write or read-only state.
    return this.settingsSaveBarrier;
  }

  /** Flush settings drafts and in-flight saves before rebinding active data. */
  async prepareForKnowledgeBaseChange(): Promise<boolean> {
    for (;;) {
      if (!await this.flushBufferedTextSave(true)) return false;
      const barrier = this.settingsSaveBarrier;
      if (!await barrier) return false;
      if (this.bufferedTextSaveTimer === null
        && this.pendingSettingsSaves === 0
        && barrier === this.settingsSaveBarrier) return true;
    }
  }

  private bindBufferedTextCommit(inputEl: HTMLInputElement): void {
    inputEl.addEventListener("blur", () => { void this.flushBufferedTextSave(); });
    inputEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      void this.flushBufferedTextSave();
      inputEl.blur();
    });
  }

  /** Persist direct settings controls transactionally, including Sync rejections. */
  private async save(
    refresh = true,
    directDataFields: readonly DirectSettingsDataField[] = [],
  ): Promise<boolean> {
    if (refresh) this.requestSettingsRefresh();
    const operation = this.performSave(refresh, directDataFields);
    this.settingsSaveBarrier = operation.then(
      () => !this.settingsWriteUncertain && !(this.host.isDataReadOnly?.() ?? false),
      () => false,
    );
    return operation;
  }

  private async performSave(
    refresh: boolean,
    directDataFields: readonly DirectSettingsDataField[],
  ): Promise<boolean> {
    const effectiveRefresh = refresh || this.bufferedTextSaveRefresh || this.settingsRefreshPending;
    const refreshGeneration = this.settingsRefreshGeneration;
    this.clearBufferedTextSaveTimer();
    this.bufferedTextSaveRefresh = false;
    this.bufferedTextSaveData = null;
    this.host.data.settings.setupComplete = true;
    // Matching the last committed snapshot is not a no-op while an older write
    // is pending: that older write may contain the value the user just reverted.
    if (this.pendingSettingsSaves === 0 && !this.hasPersistedSettingsChange(directDataFields)) {
      if (effectiveRefresh) {
        try {
          await this.host.refreshViews();
          if (refreshGeneration === this.settingsRefreshGeneration) this.settingsRefreshPending = false;
        } catch (error) {
          console.error("Knowledge Base Command Center could not refresh its saved settings", error);
          new Notice("The setting is already saved, but the command center could not refresh. Reopen it to see the change.", 8000);
        }
      }
      return true;
    }
    const revision = this.settingsSaveRevision + 1;
    this.settingsSaveRevision = revision;
    const attemptedBaseId = this.host.getActiveKnowledgeBaseId?.() ?? "";
    const attemptedDataEpoch = this.host.getDataEpoch?.() ?? 0;
    const attemptedExternalGeneration = this.host.getExternalChangeGeneration?.() ?? 0;
    const attemptedLiveData = this.host.data;
    const fallbackRollback = structuredClone(this.persistedDataSnapshot ?? this.host.data);
    // Keep the exact attempted value independently from the host transaction:
    // a later input event may mutate the live object before this promise
    // settles, and three-way rollback must never read that newer value.
    const attempted = structuredClone(this.host.data);
    this.pendingSettingsSaves += 1;
    try {
      await this.host.savePluginData();
    } catch (error) {
      // Text controls can start another save while this one is in flight. An
      // older rejection must not roll back the newer live value; the latest
      // revision will either persist it or restore the last successful attempt.
      if (revision !== this.settingsSaveRevision) {
        this.pendingSettingsSaves -= 1;
        return false;
      }
      const stillOwnsAttemptedData = this.host.data === attemptedLiveData
        && (this.host.getActiveKnowledgeBaseId?.() ?? "") === attemptedBaseId
        && (this.host.getDataEpoch?.() ?? 0) === attemptedDataEpoch
        && (this.host.getExternalChangeGeneration?.() ?? 0) === attemptedExternalGeneration;
      if (stillOwnsAttemptedData) {
        this.rollbackAttemptedData(this.persistedDataSnapshot ?? fallbackRollback, attempted, directDataFields);
      }
      let compensated = false;
      try {
        await this.host.saveCompensatingRollback();
        compensated = !(this.host.isDataReadOnly?.() ?? false);
      } catch (rollbackError) {
        console.error("Knowledge Base Command Center could not persist a rejected setting rollback", rollbackError);
        this.host.markPersistenceUncertain("A rejected setting may have reached Sync, and its compensating rollback could not be saved. Knowledge bases remain read-only until Obsidian is restarted after the plugin data.json is copied or a same-vault recovery is exported.");
      }
      this.pendingSettingsSaves -= 1;
      this.settingsWriteUncertain = !compensated;
      if (compensated) {
        this.persistedDataSnapshot = structuredClone(this.host.data);
        this.persistedSettingsRevision = Math.max(this.persistedSettingsRevision, revision);
      }
      new Notice(
        compensated
          ? `The setting was not saved and its prior value was restored: ${error instanceof Error ? error.message : String(error)}`
          : `The setting write could not be confirmed: ${error instanceof Error ? error.message : String(error)}`,
        8000,
      );
      try {
        await this.host.refreshViews();
        if (compensated && refreshGeneration === this.settingsRefreshGeneration) this.settingsRefreshPending = false;
      } catch (refreshError) {
        console.error("Knowledge Base Command Center restored a failed setting but could not refresh its view", refreshError);
      }
      this.update();
      return false;
    }
    this.pendingSettingsSaves -= 1;
    if (revision > this.persistedSettingsRevision) {
      this.persistedDataSnapshot = attempted;
      this.persistedSettingsRevision = revision;
    }
    this.settingsWriteUncertain = false;
    // A later input owns the live value and the eventual refresh. Refreshing
    // this superseded revision can make Obsidian rebuild controls mid-typing.
    if (revision !== this.settingsSaveRevision) return true;
    if (effectiveRefresh) {
      try {
        await this.host.refreshViews();
        if (refreshGeneration === this.settingsRefreshGeneration) this.settingsRefreshPending = false;
      } catch (error) {
        console.error("Knowledge Base Command Center saved a setting but could not refresh its view", error);
        new Notice("The setting was saved, but the command center could not refresh. Reopen it to see the change.", 8000);
      }
    }
    return true;
  }

  private createOpenedBaseGuard(openedBaseId = this.host.getActiveKnowledgeBaseId()): () => boolean {
    return createOpenedBaseGuard(this.host, {
      openedBaseId,
      message: "The active knowledge base changed or synced data was replaced. Reopen this setting before continuing.",
    });
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    // Settings search can ask for definitions while an onChange save is still
    // pending. Never bless that uncommitted live value as the rollback point.
    if (this.pendingSettingsSaves === 0 && this.bufferedTextSaveTimer === null) {
      this.persistedDataSnapshot = structuredClone(this.host.data);
    }
    const settings = this.host.data.settings;
    const readOnly = this.host.isDataReadOnly();
    const definitions: SettingDefinitionItem[] = [{
      name: "About this knowledge base",
      desc: "Configure the command center for this vault. Organization and visual hierarchy remain in plugin data; source notes are never moved by index actions.",
      aliases: ["knowledge base", "index", "command center"],
    }];
    if (readOnly) {
      definitions.push({
        name: "Read-only compatibility mode",
        desc: this.host.dataCompatibilityWarning,
        aliases: ["warning", "data version"],
      });
    }

    const knowledgeBases = this.host.getKnowledgeBases();
    const activeBaseId = this.host.getActiveKnowledgeBaseId();
    const ownsConfiguredBase = this.createOpenedBaseGuard(activeBaseId);
    const activeBase = knowledgeBases.find((entry) => entry.id === activeBaseId);
    definitions.push({
      type: "group",
      heading: "Knowledge bases",
      items: [
        {
          name: "Separate knowledge bases",
          desc: "Use separate index profiles for ENT, research, general medicine, or any other subject inside the same vault. These are plugin knowledge bases—not Obsidian .base files or saved Workspace layouts. Each keeps its own index, folders, templates, collections, study state, and history. Switching never moves or rewrites Markdown notes.",
          aliases: ["multiple knowledge bases", "workspace", "profile", "ENT", "research"],
        },
        renderSetting(
          "Active knowledge base",
          activeBase
            ? `${this.host.getIndexRecords().length} index entries · ${activeBase.data.collections.length} collections · ${activeBase.data.settings.workspaceMode === "ent-clinical" ? "ENT clinical" : "Generic"} preset`
            : "Choose the independent knowledge base shown in the command center.",
          (row) => {
            row.settingEl.addClass("ent-cc-base-setting");
            row.addDropdown((dropdown) => {
              const options = objectFromEntries(knowledgeBases.map((entry) => [entry.id, entry.data.settings.workspaceName] as const));
              dropdown.selectEl.addClass("ent-cc-base-setting-select");
              dropdown
                .addOptions(options)
                .setValue(activeBaseId)
                .setDisabled(readOnly || knowledgeBases.length < 2)
                .onChange(async (value) => {
                  dropdown.setDisabled(true);
                  try {
                    await this.host.switchKnowledgeBase(value);
                    this.update();
                  } catch (error) {
                    new Notice(error instanceof Error ? error.message : "Could not switch knowledge bases.", 8000);
                    dropdown.setValue(activeBaseId).setDisabled(readOnly || knowledgeBases.length < 2);
                  }
                });
            });
            row.addButton((button) => {
              button.buttonEl.addClass("ent-cc-base-setting-manage");
              button
                .setButtonText("Manage…")
                .setIcon("library")
                .setDisabled(readOnly)
                .onClick(() => new ManageKnowledgeBasesModal(this.host as EntVaultCommandCenterPlugin).open());
            });
          },
          ["switch", "manage", "rename", "duplicate", "archive", "restore", "base", "profile"],
        ),
      ],
    });

    const activeLibraries = this.host.getLibraries();
    const allLibraries = this.host.getLibraries(true);
    const archivedLibraryCount = allLibraries.length - activeLibraries.length;
    const libraryRecordCount = activeLibraries.reduce(
      (total, library) => total + this.host.librarySubjectCount(library.id),
      0,
    );
    definitions.push({
      type: "group",
      heading: "Libraries",
      items: [
        {
          name: "Top-level libraries",
          desc: "Libraries are top-level tabs inside this knowledge base. Each has its own headings and subheadings. They are not separate knowledge bases, Obsidian .base files, or Collections.",
          aliases: ["categories", "sections", "tabs", "medications", "procedures", "syndromes"],
        },
        renderSetting(
          "Manage libraries",
          `${activeLibraries.length} active · ${archivedLibraryCount} archived · ${libraryRecordCount} classified ${libraryRecordCount === 1 ? settings.itemSingular : settings.itemPlural}. Library actions never move, rewrite, or delete Markdown notes.`,
          (row) => {
            row.addButton((button) => button
              .setButtonText("Manage…")
              .setIcon("library")
              .setDisabled(readOnly)
              .onClick(() => {
                if (!ownsConfiguredBase()) return;
                new ManageLibrariesModal(this.host as EntVaultCommandCenterPlugin, () => this.update()).open();
              }));
          },
          ["create", "rename", "icon", "reorder", "archive", "restore", "delete", "library"],
        ),
        renderSetting(
          "Library creation profiles",
          "Optionally override the destination folder, empty/template mode, and template for each active or archived Library. Unconfigured Libraries inherit the knowledge base defaults, and every Create note form remains editable.",
          (row) => {
            row.addButton((button) => button
              .setButtonText("Configure…")
              .setIcon("file-cog")
              .setDisabled(readOnly || allLibraries.length === 0)
              .onClick(() => {
                if (!ownsConfiguredBase()) return;
                new ManageLibraryNoteProfilesModal(this.host as EntVaultCommandCenterPlugin, () => this.update()).open();
              }));
          },
          ["template profile", "library folder", "default template", "note creation"],
        ),
      ],
    });

    const folderPaths = (): string[] => this.host.app.vault.getAllLoadedFiles()
      .filter((file): file is TFolder => file instanceof TFolder && !file.isRoot())
      .map((folder) => folder.path)
      .filter((path) => !validateWritableFolderPath(path, this.host.app.vault.configDir))
      .sort((a, b) => a.localeCompare(b));

    const folderSetting = (
      name: string,
      description: string,
      current: string,
      onValid: (value: string) => void,
      allowEmpty = true,
    ): SettingDefinitionRender => renderSetting(name, description, (row) => {
      row.addText((text) => {
        text
          .setPlaceholder(allowEmpty ? "Vault root (leave empty)" : "Folder/path")
          .setValue(current)
          .setDisabled(readOnly)
          .onChange((value) => {
            if (!ownsConfiguredBase()) return;
            const clean = value.trim().replace(/^\/+|\/+$/g, "");
            const error = validateWritableFolderPath(clean, this.host.app.vault.configDir) || (!allowEmpty && !clean ? "Choose a folder." : null);
            text.inputEl.toggleClass("is-error", Boolean(error));
            row.setDesc(error ?? description);
            if (error) return;
            onValid(clean);
            this.scheduleTextSave();
          });
        text.inputEl.dir = "auto";
        this.bindBufferedTextCommit(text.inputEl);
      });
      row.addButton((button) => button.setButtonText("Browse…").setDisabled(readOnly).onClick(() => {
        if (!ownsConfiguredBase()) return;
        const folders = folderPaths();
        if (folders.length === 0) return;
        new StringPickerModal(this.host.app, folders, `Choose ${name.toLowerCase()}`, "Search vault folders…", async (path) => {
          if (!ownsConfiguredBase()) return;
          onValid(path);
          await this.save();
          if (!ownsConfiguredBase()) return;
          this.update();
        }).open();
      }));
    }, ["folder", "path"]);

    const propertyNames = (): string[] => {
      const names = new Set<string>();
      const manual = new Set(this.host.data.manualIndexPaths);
      const files = this.host.app.vault.getMarkdownFiles()
        .filter((file) => pathIsInsideFolder(file.path, settings.primaryFolder) || manual.has(file.path))
        .slice(0, 2000);
      for (const file of files) {
        const frontmatter = asUnknownRecord(this.host.app.metadataCache.getFileCache(file)?.frontmatter);
        for (const key of Object.keys(frontmatter)) if (key !== "position") names.add(key);
      }
      return [...names].sort((a, b) => a.localeCompare(b));
    };

    const propertySetting = (
      name: string,
      description: string,
      placeholder: string,
      current: string,
      onChange: (value: string) => void,
    ): SettingDefinitionRender => renderSetting(name, description, (row) => {
      row.addText((text) => {
        text
          .setPlaceholder(placeholder)
          .setValue(current)
          .setDisabled(readOnly)
          .onChange((value) => {
            if (!ownsConfiguredBase()) return;
            onChange(value.trim());
            this.scheduleTextSave();
          });
        text.inputEl.dir = "auto";
        this.bindBufferedTextCommit(text.inputEl);
      });
      row.addButton((button) => button.setButtonText("Choose…").setDisabled(readOnly).onClick(() => {
        if (!ownsConfiguredBase()) return;
        const properties = propertyNames();
        if (properties.length === 0) return;
        new StringPickerModal(this.host.app, properties, `Choose ${name.toLowerCase()}`, "Search frontmatter properties…", async (property) => {
          if (!ownsConfiguredBase()) return;
          onChange(property);
          await this.save();
          if (!ownsConfiguredBase()) return;
          this.update();
        }).open();
      }));
    }, ["frontmatter", "property", "metadata"]);

    const defaultTabs: Record<string, string> = {
      curriculum: settings.indexLabel,
      inbox: settings.inboxLabel,
      collections: "My Collections",
      queues: "Smart Queues",
    };
    for (const library of activeLibraries) defaultTabs[libraryTabId(library.id)] = library.name;

    definitions.push(
      {
        type: "group",
        heading: "Knowledge-base configuration",
        items: [
          renderSetting("Index preset", "The preset is fixed for this knowledge base so its folder and creation rules cannot drift apart. Create or duplicate a base to use another preset.", (row) => {
            row.addDropdown((dropdown) => dropdown
              .addOptions({ generic: "Generic knowledge base", "ent-clinical": "ENT clinical preset" })
              .setValue(settings.workspaceMode)
              .setDisabled(true));
          }, ["generic", "ENT", "clinical", "preset"]),
          renderSetting("Command center name", "Displayed in the view title, header, and settings. The ribbon and hover source retain the stable plugin name.", (row) => {
            row.addText((text) => {
              text.setValue(settings.workspaceName).setDisabled(true);
              text.inputEl.dir = "auto";
            });
            row.addButton((button) => button
              .setButtonText("Rename…")
              .setDisabled(readOnly)
              .onClick(() => {
                if (!ownsConfiguredBase()) return;
                new TextPromptModal(this.app, {
                  title: "Rename knowledge base",
                  placeholder: "Knowledge base name",
                  initialValue: settings.workspaceName,
                  submitLabel: "Rename",
                  onSubmit: async (value) => {
                    if (!ownsConfiguredBase()) return;
                    await this.host.renameKnowledgeBase(activeBaseId, value);
                    if (ownsConfiguredBase()) this.update();
                  },
                }).open();
              }));
          }, ["workspace name", "title"]),
          renderSetting("Header description", "Short explanation shown below the command center name.", (row) => {
            row.addText((text) => {
              text.setPlaceholder("Search, organize, arrange, and create notes.").setValue(settings.workspaceSubtitle).setDisabled(readOnly).onChange((value) => {
                if (!ownsConfiguredBase()) return;
                settings.workspaceSubtitle = value.trim();
                this.scheduleTextSave();
              });
              text.inputEl.dir = "auto";
              this.bindBufferedTextCommit(text.inputEl);
            });
          }, ["subtitle"]),
          renderSetting("Index name", "For example: Knowledge Index, Curriculum, Projects, Research Library.", (row) => {
            row.addText((text) => {
              text.setPlaceholder("Knowledge index").setValue(settings.indexLabel).setDisabled(readOnly).onChange((value) => {
                if (!ownsConfiguredBase()) return;
                const clean = value.trim();
                if (!clean) return;
                settings.indexLabel = clean;
                this.scheduleTextSave();
              });
              text.inputEl.dir = "auto";
              this.bindBufferedTextCommit(text.inputEl);
            });
          }, ["curriculum", "library"]),
          renderSetting("Item singular", "Singular label used throughout the interface.", (row) => {
            row.addText((text) => {
              text.setPlaceholder("Note").setValue(settings.itemSingular).setDisabled(readOnly).onChange((value) => {
                if (!ownsConfiguredBase()) return;
                if (!value.trim()) return;
                settings.itemSingular = value.trim();
                this.scheduleTextSave();
              });
              text.inputEl.dir = "auto";
              this.bindBufferedTextCommit(text.inputEl);
            });
          }, ["item name", "terminology"]),
          renderSetting("Item plural", "Plural label used throughout the interface.", (row) => {
            row.addText((text) => {
              text.setPlaceholder("Notes").setValue(settings.itemPlural).setDisabled(readOnly).onChange((value) => {
                if (!ownsConfiguredBase()) return;
                if (!value.trim()) return;
                settings.itemPlural = value.trim();
                this.scheduleTextSave();
              });
              text.inputEl.dir = "auto";
              this.bindBufferedTextCommit(text.inputEl);
            });
          }, ["item names", "terminology"]),
          renderSetting("Group name", "Label for the top-level grouping property, such as Category, Domain, Area, or Course.", (row) => {
            row.addText((text) => {
              text.setPlaceholder("Group").setValue(settings.groupLabel).setDisabled(readOnly).onChange((value) => {
                if (!ownsConfiguredBase()) return;
                if (!value.trim()) return;
                settings.groupLabel = value.trim();
                this.scheduleTextSave();
              });
              text.inputEl.dir = "auto";
              this.bindBufferedTextCommit(text.inputEl);
            });
          }, ["category", "domain", "area", "course"]),
        ],
      },
      {
        type: "group",
        heading: "Folders and templates",
        items: [
          settings.workspaceMode === "ent-clinical"
            ? renderSetting("Indexed notes folder", "Protected ENT scope. Canonical creation and index discovery both follow this folder; its path updates automatically when the folder is renamed in the vault.", (row) => {
                row.addText((text) => {
                  text.setValue(settings.primaryFolder).setDisabled(true);
                  text.inputEl.dir = "auto";
                });
              }, ["folder", "path", "clinical scope"])
            : folderSetting("Indexed notes folder", "Every Markdown note in this folder and its subfolders appears in the main index.", settings.primaryFolder, (value) => { settings.primaryFolder = value; }, false),
          folderSetting("Default new-note folder", "Initial destination in Create note. It can still be changed for each note.", settings.defaultNoteFolder, (value) => { settings.defaultNoteFolder = value; }),
          folderSetting("Templates folder", "Markdown templates offered by the per-note template picker. Leave empty to allow any Markdown file.", settings.templatesFolder, (value) => { settings.templatesFolder = value; }),
          renderSetting("Default starting content", "Every new note can override this choice.", (row) => {
            row.addDropdown((dropdown) => dropdown
              .addOptions({ empty: "Empty note", template: "Selected template" })
              .setValue(settings.defaultNewNoteMode)
              .setDisabled(readOnly)
              .onChange(async (value) => {
                if (!ownsConfiguredBase()) return;
                settings.defaultNewNoteMode = value as NewNoteMode;
                await this.save(false);
              }));
          }, ["empty note", "template"]),
          renderSetting("Default template", settings.defaultTemplatePath || "No default template selected. Every new note can still choose a template.", (row) => {
            row.addButton((button) => button
              .setButtonText(settings.defaultTemplatePath ? settings.defaultTemplatePath.split("/").pop()?.replace(/\.md$/, "") ?? "Choose…" : "Choose…")
              .setDisabled(readOnly)
              .onClick(() => {
                if (!ownsConfiguredBase()) return;
                const templates = this.host.getTemplateFiles();
                if (templates.length === 0) return;
                new VaultFilePickerModal(this.host.app, templates, "Choose the default note template", async (file) => {
                  if (!ownsConfiguredBase()) return;
                  settings.defaultTemplatePath = file.path;
                  await this.save(false);
                  if (!ownsConfiguredBase()) return;
                  this.update();
                }).open();
              }));
            row.addButton((button) => button.setIcon("x").setTooltip("Clear default template").setDisabled(readOnly || !settings.defaultTemplatePath).onClick(async () => {
              if (!ownsConfiguredBase()) return;
              settings.defaultTemplatePath = "";
              if (settings.defaultNewNoteMode === "template") settings.defaultNewNoteMode = "empty";
              await this.save(false);
              if (!ownsConfiguredBase()) return;
              this.update();
            }));
          }, ["template file"]),
          renderSetting("Attachment storage", "Used only by the explicit Attach file command. Ordinary paste and drag-and-drop continue to follow Obsidian's Files & Links setting.", (row) => {
            row.addDropdown((dropdown) => dropdown
              .addOptions({
                obsidian: "Follow Obsidian attachment setting",
                "fixed-folder": "Use a fixed vault folder",
                "note-subfolder": "Use a folder beside each note",
                ask: "Ask for a folder each time",
              })
              .setValue(settings.attachmentStorageMode)
              .setDisabled(readOnly)
              .onChange(async (value) => {
                if (!ownsConfiguredBase()) return;
                settings.attachmentStorageMode = value as AttachmentStorageMode;
                await this.save(false);
                if (ownsConfiguredBase()) this.update();
              }));
          }, ["attachments", "files", "upload", "folder"]),
          renderSetting("Fixed attachment folder", "Used only when Attachment storage is set to a fixed vault folder.", (row) => {
            const disabled = readOnly || settings.attachmentStorageMode !== "fixed-folder";
            row.addText((text) => {
              text.setPlaceholder("Attachments")
                .setValue(settings.attachmentFolder)
                .setDisabled(disabled)
                .onChange((value) => {
                  if (!ownsConfiguredBase()) return;
                  const clean = value.trim().replace(/^\/+|\/+$/g, "");
                  const error = validateWritableFolderPath(clean, this.host.app.vault.configDir);
                  text.inputEl.toggleClass("is-error", Boolean(error));
                  if (error) return;
                  settings.attachmentFolder = clean;
                  this.scheduleTextSave(false);
                });
              text.inputEl.dir = "auto";
              this.bindBufferedTextCommit(text.inputEl);
            });
            row.addButton((button) => button.setButtonText("Browse…").setDisabled(disabled).onClick(() => {
              if (!ownsConfiguredBase()) return;
              new StringPickerModal(this.host.app, folderPaths(), "Choose attachment folder", "Search vault folders…", async (path) => {
                if (!ownsConfiguredBase()) return;
                const error = validateWritableFolderPath(path, this.host.app.vault.configDir);
                if (error) return;
                settings.attachmentFolder = path;
                await this.save(false);
                if (ownsConfiguredBase()) this.update();
              }).open();
            }));
          }, ["attachments", "fixed folder"]),
          renderSetting("Attachment link location", "Default insertion point for the generated Markdown link. It can be changed for each upload.", (row) => {
            row.addDropdown((dropdown) => dropdown
              .addOptions({
                cursor: "Current editor cursor",
                marker: "Configured marker",
                heading: "Configured heading",
                end: "End of note",
              })
              .setValue(settings.attachmentInsertionMode)
              .setDisabled(readOnly)
              .onChange(async (value) => {
                if (!ownsConfiguredBase()) return;
                settings.attachmentInsertionMode = value as AttachmentInsertionMode;
                await this.save(false);
                if (ownsConfiguredBase()) this.update();
              }));
          }, ["insert", "embed", "cursor", "heading", "marker"]),
          renderSetting("Attachment marker", "Exact standalone line used when the link location is Configured marker.", (row) => {
            row.addText((text) => {
              text.setPlaceholder("<!-- kbcc:attachments -->")
                .setValue(settings.attachmentMarker)
                .setDisabled(readOnly || settings.attachmentInsertionMode !== "marker")
                .onChange((value) => {
                  if (!ownsConfiguredBase() || !value.trim()) return;
                  settings.attachmentMarker = value.trim();
                  this.scheduleTextSave(false);
                });
              text.inputEl.dir = "auto";
              this.bindBufferedTextCommit(text.inputEl);
            });
          }, ["attachment marker"]),
          renderSetting("Attachment heading", "Heading title used when the link location is Configured heading.", (row) => {
            row.addText((text) => {
              text.setPlaceholder("Attachments")
                .setValue(settings.attachmentHeading)
                .setDisabled(readOnly || settings.attachmentInsertionMode !== "heading")
                .onChange((value) => {
                  if (!ownsConfiguredBase() || !value.trim()) return;
                  settings.attachmentHeading = value.trim().replace(/^#{1,6}\s+/u, "").replace(/\s+#+\s*$/u, "");
                  this.scheduleTextSave(false);
                });
              text.inputEl.dir = "auto";
              this.bindBufferedTextCommit(text.inputEl);
            });
          }, ["attachment heading"]),
          renderSetting("Inbox folder", settings.workspaceMode === "ent-clinical" ? "Clinical proposals must stay inside 01 Inbox." : "Notes in this folder appear in the Inbox section.", (row) => {
            const description = settings.workspaceMode === "ent-clinical" ? "Clinical proposals must stay inside 01 Inbox." : "Notes in this folder appear in the Inbox section.";
            row.addText((text) => {
              text.setPlaceholder(DEFAULT_PROPOSAL_FOLDER).setValue(settings.proposalFolder).setDisabled(readOnly).onChange((value) => {
                if (!ownsConfiguredBase()) return;
                const clean = value.trim().replace(/^\/+|\/+$/g, "");
                const error = settings.workspaceMode === "ent-clinical"
                  ? validateProposalFolderPath(clean, this.host.app.vault.configDir)
                  : validateWritableFolderPath(clean, this.host.app.vault.configDir);
                text.inputEl.toggleClass("is-error", Boolean(error));
                row.setDesc(error ?? description);
                if (error) return;
                settings.proposalFolder = clean;
                this.scheduleTextSave();
              });
              text.inputEl.dir = "auto";
              this.bindBufferedTextCommit(text.inputEl);
            });
            row.addButton((button) => button.setButtonText("Browse…").setDisabled(readOnly).onClick(() => {
              if (!ownsConfiguredBase()) return;
              new StringPickerModal(this.host.app, folderPaths(), "Choose inbox folder", "Search vault folders…", async (path) => {
                if (!ownsConfiguredBase()) return;
                const error = settings.workspaceMode === "ent-clinical"
                  ? validateProposalFolderPath(path, this.host.app.vault.configDir)
                  : validateWritableFolderPath(path, this.host.app.vault.configDir);
                if (error) return;
                settings.proposalFolder = path;
                await this.save();
                if (!ownsConfiguredBase()) return;
                this.update();
              }).open();
            }));
          }, ["proposal folder"]),
          renderSetting("Inbox name", "Label used for the Inbox section.", (row) => {
            row.addText((text) => {
              text.setPlaceholder("Inbox").setValue(settings.inboxLabel).setDisabled(readOnly).onChange((value) => {
                if (!ownsConfiguredBase()) return;
                if (!value.trim()) return;
                settings.inboxLabel = value.trim();
                this.scheduleTextSave();
              });
              text.inputEl.dir = "auto";
              this.bindBufferedTextCommit(text.inputEl);
            });
          }, ["proposal inbox"]),
        ],
      },
      {
        type: "group",
        heading: "Metadata mapping",
        items: [
          {
            name: "Metadata mapping behavior",
            desc: "Property names are vault-specific. Suggestions sample up to 2,000 notes inside the indexed folder (plus manual members); notes without properties still appear and folders provide safe fallbacks.",
            aliases: ["frontmatter", "properties"],
          },
          propertySetting("ID property", "Optional identifier shown beside each indexed note. Leave empty to disable it.", "id", settings.idProperty, (value) => { settings.idProperty = value; }),
          propertySetting("Group property", "If empty or absent on a note, the first subfolder under the indexed folder becomes the group.", "category", settings.groupProperty, (value) => { settings.groupProperty = value; }),
          propertySetting("Parent property", "A wikilink or note title used for default nesting. Leave empty to use only visual arrangement.", "parent", settings.parentProperty, (value) => { settings.parentProperty = value; }),
        ],
      },
      {
        type: "group",
        heading: "Navigation and behavior",
        items: [
          renderSetting("Default section", "Section shown when the command center opens for the first time.", (row) => {
            row.addDropdown((dropdown) => dropdown.addOptions(defaultTabs).setValue(settings.defaultTab).setDisabled(readOnly).onChange(async (value) => {
              if (!ownsConfiguredBase()) return;
              settings.defaultTab = value as MainTab;
              this.host.data.activeTab = value as MainTab;
              await this.save(true, ["activeTab"]);
            }));
          }, ["tab", "start page"]),
          renderSetting("Recent changes limit", "Maximum entries in the Recently changed smart queue (5–100).", (row) => {
            row.addSlider((slider) => {
              // A drag reports every intermediate step; instant updates plus a
              // direct save would clone the store and queue a data.json write on
              // each one. setInstant exists since Obsidian 1.6.6.
              if (typeof slider.setInstant === "function") slider.setInstant(false);
              slider.setLimits(5, 100, 5).setValue(settings.recentLimit).setDisabled(readOnly).onChange((value) => {
                if (!ownsConfiguredBase()) return;
                settings.recentLimit = value;
                this.scheduleTextSave();
              });
            });
          }, ["recent queue", "history"]),
          renderSetting("Hover previews", "Use Obsidian Page Preview when hovering a record title.", (row) => {
            row.addToggle((toggle) => toggle.setValue(settings.enableHoverPreview).setDisabled(readOnly).onChange(async (value) => {
              if (!ownsConfiguredBase()) return;
              settings.enableHoverPreview = value;
              await this.save();
            }));
          }, ["page preview"]),
          renderSetting("Open notes", "Choose where records open so the command center can remain available.", (row) => {
            row.addDropdown((dropdown) => dropdown
              .addOptions({ "new-tab": "New tab (recommended)", "same-tab": "Current tab", split: "Vertical split" })
              .setValue(settings.openNoteBehavior)
              .setDisabled(readOnly)
              .onChange(async (value) => {
                if (!ownsConfiguredBase()) return;
                settings.openNoteBehavior = value as OpenNoteBehavior;
                await this.save(false);
              }));
          }, ["new tab", "same tab", "split"]),
        ],
      },
      {
        type: "group",
        heading: "Quick Append",
        items: [
          {
            name: "Quick Append behavior",
            desc: "Adds one item beneath a strict, plugin-owned Follow-up notes block in a chosen Markdown note. Existing text, ordinary paste/drop attachments, and note location are not changed.",
            aliases: ["follow up", "questions", "sources", "thoughts", "lectures", "reading"],
          },
          renderSetting(
            "Categories",
            `${String(settings.followUpCategories.filter((category) => !category.archived).length)} active · ${String(settings.followUpCategories.length)} total. Labels can change while stable marker IDs keep existing sections connected.`,
            (row) => {
              row.addButton((button) => button.setButtonText("Manage…").setDisabled(readOnly).onClick(() => {
                if (!ownsConfiguredBase()) return;
                new FollowUpCategoryManagerModal(this.host.app, this.host.getFollowUpCategories(), (categories) => {
                  if (!ownsConfiguredBase()) throw new Error("The active knowledge base changed. Reopen category management.");
                  return this.host.replaceFollowUpCategories(categories).then(() => {
                    if (ownsConfiguredBase()) this.update();
                  });
                }).open();
              }));
            },
            ["append", "category", "question", "source", "lecture"],
          ),
          {
            name: "Attachments in appended items",
            desc: "Quick Append writes Markdown text only. Paste, drag, and attachment storage continue to follow Obsidian’s Files and Links setting; the plugin does not move existing attachments.",
            aliases: ["attachment folder", "files", "images"],
          },
        ],
      },
      {
        type: "group",
        heading: "Privacy and capabilities",
        items: [
          {
            name: "Vault indexing",
            desc: "Enumerates Markdown file paths and reads metadata inside this vault to build the index, pick notes and templates, and repair missing plugin references. No vault content is sent over a network.",
            aliases: ["privacy", "permissions", "enumeration", "files"],
          },
          {
            name: "Clipboard shortcuts",
            desc: "A copy button writes only the plugin-generated text shown by that action after you click it. The plugin never reads the clipboard.",
            aliases: ["privacy", "permissions", "copy"],
          },
        ],
      },
      {
        type: "group",
        heading: "ENT clinical safeguards",
        visible: settings.workspaceMode === "ent-clinical",
        items: [
          renderSetting("Safety badges", "Show a safety-critical indicator. This never changes clinical metadata.", (row) => {
            row.addToggle((toggle) => toggle.setValue(settings.showSafetyBadges).setDisabled(readOnly).onChange(async (value) => {
              if (!ownsConfiguredBase()) return;
              settings.showSafetyBadges = value;
              await this.save();
            }));
          }, ["clinical", "safety critical"]),
          renderSetting("Advanced canonical actions", "Show direct ENT canonical creation and placement editing. Promotion from the clinical Inbox remains available.", (row) => {
            row.addToggle((toggle) => toggle.setValue(settings.enableAdvancedCanonicalActions).setDisabled(readOnly).onChange(async (value) => {
              if (!ownsConfiguredBase()) return;
              settings.enableAdvancedCanonicalActions = value;
              await this.save();
            }));
          }, ["clinical", "topic placement", "create canonical"]),
          renderSetting("Visual cross-domain movement", "Allow ENT topics to be visually grouped across canonical domains. This changes only plugin organization; note folders, curriculum IDs, domain properties, and clinical metadata stay untouched. Off by default.", (row) => {
            row.addToggle((toggle) => toggle.setValue(settings.allowClinicalVisualGroupMoves).setDisabled(readOnly).onChange(async (value) => {
              if (!ownsConfiguredBase()) return;
              if (value && this.host.data.indexGroupOrder.length === 0) this.host.data.indexGroupOrder = this.host.getIndexGroups();
              settings.allowClinicalVisualGroupMoves = value;
              await this.save(true, ["indexGroupOrder"]);
            }));
          }, ["clinical", "groups", "arrange"]),
        ],
      },
    );
    return definitions;
  }

  override hide(): void {
    void this.flushBufferedTextSave();
    super.hide();
  }
}
