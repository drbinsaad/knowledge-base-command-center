import { Modal, Notice, Platform, Setting, TFile, TFolder, normalizePath } from "obsidian";
import type EntVaultCommandCenterPlugin from "./main";
import {
  assertPersonalBackupMatchesVault,
  cleanLibraryNoteProfiles,
  cloneJsonValue,
  errorMessage,
  resolveLibraryNoteProfile,
  subjectLibraryId,
  validateProposalFolderPath,
  validateTemplateFilePath,
  validateWritableFolderPath,
  type LibraryDefinition,
  type PluginData,
  type PortableIndexLocalState,
  type VaultRecord,
  type WorkspaceMode,
} from "./model";
import {
  createOpenedBaseGuard,
  deliverJsonExport,
  type OpenedBaseGuard,
  modalOwnerWindow,
  requestJsonImport,
  setGuardedTimer,
} from "./modals";
import {
  applyPortableExport,
  assertPortableImportDestinationCompatible,
  completePortableSelection,
  createPortableExport,
  EMPTY_PORTABLE_SELECTION,
  MAX_PORTABLE_PACKAGE_BYTES,
  normalizePortableSelection,
  parseAnyCommandCenterExport,
  portableSelectionHasAny,
  PortableExportSelection,
  PortableExportV1,
  PortableImportMode,
  type PortableLibraryDefinition,
  selectionAvailableForExport,
  serializePortableExport,
  summarizePortableExport,
  synchronizePortableRegistry,
} from "./portability";

type CenterMode = "export" | "import";
type ComponentKey = "workspace" | "index" | "collections" | "study" | "savedViews" | "recovery";
type BusyAction = "export" | "import" | "file";
type LibraryDescriptor = Pick<PortableLibraryDefinition, "id" | "name" | "singularName" | "icon" | "order" | "sourceKind">;

interface WorkspaceImportValidation {
  defaultTemplateReset: boolean;
  libraryTemplateResetIds: string[];
  droppedLibraryProfileIds: string[];
  missingFolderText: string;
}

/**
 * Completion-notice sentences naming imported workspace folders the vault does
 * not have. Deliberate design: a fresh-vault import legitimately references
 * folders that do not exist yet, so a missing folder neither blocks the import
 * nor silently falls back to the previous value — the notice names it instead.
 * An ent-clinical destination keeps its own primaryFolder (applyPortableExport
 * protects it), so only the Inbox folder can go missing there. In a generic
 * base primaryFolder is grouping-only; linked-folder membership is personal
 * organization and is not inferred from this imported setting.
 */
export function missingImportedFolderNoticeText(
  settings: { primaryFolder: string; proposalFolder: string },
  destinationMode: WorkspaceMode,
  folderExists: (path: string) => boolean,
): string {
  const sentences: string[] = [];
  if (destinationMode !== "ent-clinical" && settings.primaryFolder && !folderExists(settings.primaryFolder)) {
    sentences.push(`The imported folder grouping root “${settings.primaryFolder}” does not exist in this vault yet, so folder-based group fallbacks will remain unavailable until it is created or the setting is changed. Index membership is unchanged.`);
  }
  if (settings.proposalFolder && !folderExists(settings.proposalFolder)) {
    sentences.push(`The imported Inbox folder “${settings.proposalFolder}” does not exist in this vault yet, so the Inbox will be empty until it is created or the setting is changed.`);
  }
  return sentences.map((sentence) => ` ${sentence}`).join("");
}

const CENTER_MODES: readonly CenterMode[] = ["export", "import"];
let portabilityCenterSequence = 0;

export function portabilityLibraryUnavailableText(importing: boolean, available: boolean): string {
  return importing && !available
    ? " Referenced by another selected section; this file does not declare the complete Library."
    : "";
}

export interface PreparedPortableExport {
  value: PortableExportV1;
  serialized: string;
  portableIndex: PortableIndexLocalState;
}

function isolatedExportData(data: PluginData): PluginData {
  // Portable export preparation mutates only the identity registry. Keep large
  // undo and named-snapshot histories shared and read-only during preparation.
  return {
    ...data,
    portableIndex: cloneJsonValue(data.portableIndex),
  };
}

/** Build and validate an export without touching live plugin data. */
export function preparePortableExport(
  data: PluginData,
  records: VaultRecord[],
  selection: PortableExportSelection,
  exportedAt: string,
  sourceVaultId: string,
  sourceBaseId = "",
  sourceBaseName = "",
): PreparedPortableExport {
  const preparedData = isolatedExportData(data);
  const value = createPortableExport(
    preparedData,
    records,
    selection,
    exportedAt,
    sourceVaultId,
    sourceBaseId,
    sourceBaseName,
  );
  const serialized = serializePortableExport(value);
  return { value, serialized, portableIndex: preparedData.portableIndex };
}

const COMPONENTS: Array<{
  key: ComponentKey;
  label: string;
  description: string;
}> = [
  {
    key: "workspace",
    label: "Workspace settings",
    description: "Labels, compatible folder and template paths, metadata mappings, behavior, and group order. The destination base name, preset, and protected ENT scope stay unchanged.",
  },
  {
    key: "index",
    label: "Index blueprint",
    description: "Subject names, groups, nested hierarchy, and visual order. Missing notes become actionable placeholders.",
  },
  {
    key: "collections",
    label: "Collections",
    description: "Collection and subheading structure plus membership by portable subject identity.",
  },
  {
    key: "study",
    label: "Study state",
    description: "Pinned subjects and the Next list, without note content.",
  },
  {
    key: "savedViews",
    label: "Saved views",
    description: "Named Command Center tabs and literal search text, which may include a path you typed.",
  },
  {
    key: "recovery",
    label: "Same-vault recovery",
    description: "Private exact-path recovery. New backups carry vault, knowledge-base, and preset identities; a cross-base restore requires a separate explicit override and can never cross presets.",
  },
];

function cloneSelection(value: PortableExportSelection): PortableExportSelection {
  return { ...value, libraryIds: [...(value.libraryIds ?? [])] };
}

function selectionCount(selection: PortableExportSelection): number {
  const normalized = normalizePortableSelection(selection);
  return COMPONENTS.filter(({ key }) => normalized[key]).length + normalized.libraryIds.length;
}

function selectionUsesSubjectCatalog(selection: PortableExportSelection): boolean {
  const normalized = normalizePortableSelection(selection);
  return normalized.index
    || normalized.libraryIds.length > 0
    || normalized.collections
    || normalized.study;
}

function selectionWithLibraryIds(selection: PortableExportSelection, libraryIds: string[]): PortableExportSelection {
  return normalizePortableSelection({
    ...selection,
    libraryIds,
    // Clear the compatibility flags before normalizing so deselecting a
    // built-in library cannot be undone by its legacy boolean alias.
    procedures: false,
    medications: false,
    syndromes: false,
  });
}

export class ExportImportCenterModal extends Modal {
  private mode: CenterMode;
  private exportSelection = cloneSelection(EMPTY_PORTABLE_SELECTION);
  private importSelection = cloneSelection(EMPTY_PORTABLE_SELECTION);
  private importValue: PortableExportV1 | null = null;
  private importSourceLabel = "";
  private importMode: PortableImportMode = "merge";
  private recoveryConfirmed = false;
  private crossBaseRecoveryConfirmed = false;
  private exportRecoveryConfirmed = false;
  private busyAction: BusyAction | null = null;
  private centerOpen = false;
  private dataChanged = false;
  private completionNotified = false;
  private pendingFocusKey: string | null = null;
  private accessibilityInstanceId = `ent-cc-portability-${++portabilityCenterSequence}`;
  private panelEl: HTMLElement | null = null;
  private openedBaseId = "";
  private openedDataEpoch = -1;
  private ownsBase: OpenedBaseGuard | null = null;
  private pendingTimers = new Set<number>();

  private readonly blockCloseWhileBusy = (event: KeyboardEvent): void => {
    if (!this.busyAction || event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  constructor(
    private readonly plugin: EntVaultCommandCenterPlugin,
    initialMode: CenterMode = "export",
    private readonly onComplete?: (dataChanged: boolean) => void,
  ) {
    super(plugin.app);
    this.mode = initialMode;
    this.exportSelection = completePortableSelection(this.activeExportLibraries().map((library) => library.id));
  }

  onOpen(): void {
    this.openedBaseId = this.plugin.getActiveKnowledgeBaseId();
    this.openedDataEpoch = this.plugin.getDataEpoch();
    this.ownsBase = this.createBaseGuard();
    this.centerOpen = true;
    this.modalEl.addClass("ent-cc-portability-modal");
    this.contentEl.addClass("ent-cc-modal", "ent-cc-portability-center");
    this.modalEl.addEventListener("keydown", this.blockCloseWhileBusy, true);
    this.render();
  }

  onClose(): void {
    this.centerOpen = false;
    const viewWindow = modalOwnerWindow(this.contentEl);
    for (const timer of this.pendingTimers) viewWindow.clearTimeout(timer);
    this.pendingTimers.clear();
    this.modalEl.removeEventListener("keydown", this.blockCloseWhileBusy, true);
    if (this.completionNotified) return;
    this.completionNotified = true;
    this.onComplete?.(this.dataChanged);
  }

  private render(): void {
    if (!this.guardOpenedBase()) return;
    const scrollTop = this.contentEl.scrollTop;
    this.panelEl = null;
    this.contentEl.empty();
    this.titleEl.setText("Export / import center");
    this.renderModePicker();
    this.renderModePanel();
    this.contentEl.scrollTop = scrollTop;
    this.updateBusyPresentation();
    this.restorePendingFocus();
  }

  private renderModePanel(): void {
    this.panelEl = this.contentEl.createDiv({
      cls: "ent-cc-portability-panel",
      attr: {
        id: this.modePanelId(this.mode),
        role: "tabpanel",
        "aria-labelledby": this.modeTabId(this.mode),
        tabindex: "0",
      },
    });
    if (this.mode === "export") this.renderExport();
    else this.renderImport();
  }

  private rerenderFromControl(focusKey: string): void {
    this.pendingFocusKey = focusKey;
    this.render();
  }

  private restorePendingFocus(): void {
    const focusKey = this.pendingFocusKey;
    this.pendingFocusKey = null;
    if (!focusKey) return;
    this.setGuardedTimer(() => {
      const control = Array.from(this.contentEl.querySelectorAll<HTMLElement>("[data-portability-focus]"))
        .find((element) => element.dataset.portabilityFocus === focusKey);
      control?.focus({ preventScroll: true });
    }, 0);
  }

  private updateBusyPresentation(): void {
    const busy = Boolean(this.busyAction);
    this.contentEl.setAttribute("aria-busy", String(busy));
    this.modalEl.toggleClass("is-busy", busy);
    const close = this.modalEl.querySelector<HTMLButtonElement>(".modal-close-button");
    if (close) {
      close.disabled = busy;
      close.setAttribute("aria-disabled", String(busy));
    }
  }

  private accessibilityId(): string {
    if (!this.accessibilityInstanceId) {
      this.accessibilityInstanceId = `ent-cc-portability-${++portabilityCenterSequence}`;
    }
    return this.accessibilityInstanceId;
  }

  private modeTabId(mode: CenterMode): string {
    return `${this.accessibilityId()}-tab-${mode}`;
  }

  private modePanelId(mode: CenterMode): string {
    return `${this.accessibilityId()}-panel-${mode}`;
  }

  private renderParent(): HTMLElement {
    return this.panelEl ?? this.contentEl;
  }

  private renderModePicker(): void {
    const tabs = this.contentEl.createDiv({
      cls: "ent-cc-manager-tabs ent-cc-portability-tabs",
      attr: { role: "tablist", "aria-label": "Export or import" },
    });
    const addTab = (mode: CenterMode, label: string): void => {
      const active = this.mode === mode;
      const button = tabs.createEl("button", {
        cls: `ent-cc-manager-tab ${active ? "is-active" : ""}`,
        text: label,
        attr: {
          id: this.modeTabId(mode),
          type: "button",
          role: "tab",
          "aria-selected": String(active),
          "aria-controls": this.modePanelId(mode),
          tabindex: active ? "0" : "-1",
          "data-portability-focus": `mode-${mode}`,
          ...(this.busyAction ? { disabled: "" } : {}),
        },
      });
      button.addEventListener("click", () => {
        if (this.busyAction || this.mode === mode) return;
        this.mode = mode;
        this.rerenderFromControl(`mode-${mode}`);
      });
      button.addEventListener("keydown", (event) => {
        if (this.busyAction) return;
        const index = CENTER_MODES.indexOf(mode);
        const nextIndex = event.key === "Home" ? 0
          : event.key === "End" ? CENTER_MODES.length - 1
            : event.key === "ArrowRight" ? (index + 1) % CENTER_MODES.length
              : event.key === "ArrowLeft" ? (index - 1 + CENTER_MODES.length) % CENTER_MODES.length
                : -1;
        if (nextIndex < 0) return;
        const nextMode = CENTER_MODES[nextIndex];
        if (!nextMode) return;
        event.preventDefault();
        this.mode = nextMode;
        this.rerenderFromControl(`mode-${nextMode}`);
      });
    };
    addTab("export", "Export");
    addTab("import", "Import");
  }

  private renderExport(): void {
    const parent = this.renderParent();
    const compatibilityReadOnly = this.plugin.isDataReadOnly();
    if (compatibilityReadOnly && this.exportSelection.recovery) {
      this.exportSelection = { ...this.exportSelection, recovery: false };
      this.exportRecoveryConfirmed = false;
    }
    parent.createEl("p", {
      text: "Choose exactly what to carry to another vault or device. Markdown note bodies and attachments are never included.",
    });
    if (compatibilityReadOnly) {
      const warning = parent.createDiv({ cls: "ent-cc-manager-diagnostic", attr: { role: "alert" } });
      warning.createEl("strong", { text: "Compatibility read-only salvage" });
      warning.createEl("p", {
        text: "Same-vault recovery is unavailable because this build cannot faithfully interpret the preserved data.json. Keep a copy of that raw file. Other sections may be exported for salvage; newly generated index identities cannot be saved and may differ in a later export.",
      });
    }
    this.renderExportPresets();
    this.renderComponentToggles(this.exportSelection, undefined, (selection) => {
      this.exportSelection = selection;
      if (!selection.recovery) this.exportRecoveryConfirmed = false;
    });

    const selection = normalizePortableSelection(this.exportSelection);
    if (selection.recovery) {
      const warning = parent.createDiv({ cls: "ent-cc-manager-diagnostic ent-cc-portability-path-warning", attr: { role: "alert" } });
      warning.createEl("strong", { text: "Exact vault paths will be included" });
      warning.createEl("p", {
        text: "Same-vault recovery contains exact folder and Markdown filenames from this vault. Treat the JSON as private. The plugin embeds this vault's identity and will reject it in every other vault.",
      });
      const confirmation = new Setting(parent)
        .setName("Confirm private recovery export")
        .setDesc("I understand this export contains exact vault-relative paths and is not a path-free package for sharing.")
        .addToggle((toggle) => {
          toggle.toggleEl.dataset.portabilityFocus = "export-recovery-confirm";
          toggle
            .setValue(this.exportRecoveryConfirmed)
            .setDisabled(Boolean(this.busyAction))
            .onChange((confirmed) => {
              this.exportRecoveryConfirmed = confirmed;
              this.rerenderFromControl("export-recovery-confirm");
            });
        });
      confirmation.settingEl.addClass("ent-cc-portability-toggle");
    }
    if (portableSelectionHasAny(selection)) {
      try {
        // Preview against a clone because allocating stable subject identities is
        // a real plugin-data mutation that should happen only when Export runs.
        const preview = createPortableExport(
          isolatedExportData(this.plugin.data),
          selectionUsesSubjectCatalog(selection) ? this.plugin.getRecords() : [],
          selection,
          new Date().toISOString(),
          this.currentVaultId(),
          this.currentBaseId(),
          this.plugin.data.settings.workspaceName,
        );
        this.renderSummary(preview, selection, "Export preview");
      } catch (error) {
        this.renderError(`The export preview could not be prepared: ${errorMessage(error)}`);
      }
    } else {
      this.renderEmptySummary("Choose at least one section to export.");
    }

    new Setting(parent)
      .addButton((button) => {
        button.buttonEl.dataset.portabilityFocus = "export-cancel";
        button.setButtonText("Cancel").setDisabled(Boolean(this.busyAction)).onClick(() => this.close());
      })
      .addButton((button) => {
        button.buttonEl.dataset.portabilityFocus = "export-submit";
        button
          .setButtonText(this.busyAction === "export" ? "Exporting…" : "Export selected sections")
          .setCta()
          .setDisabled(Boolean(this.busyAction) || !portableSelectionHasAny(selection) || (selection.recovery && !this.exportRecoveryConfirmed))
          .onClick(() => this.run("export", () => this.exportSelected()));
      });
  }

  private renderExportPresets(): void {
    const parent = this.renderParent();
    const compatibilityReadOnly = this.plugin.isDataReadOnly();
    new Setting(parent)
      .setName("Quick selection")
      .setDesc("Portable set is for cross-vault transfer. All + private recovery additionally creates exact-path recovery that is locked to this vault and requires separate confirmation.")
      .addButton((button) => {
        button.buttonEl.dataset.portabilityFocus = "preset-portable";
        button.setButtonText("Portable set").setDisabled(Boolean(this.busyAction)).onClick(() => {
          this.exportSelection = completePortableSelection(this.activeExportLibraries().map((library) => library.id));
          this.exportRecoveryConfirmed = false;
          this.rerenderFromControl("preset-portable");
        });
      })
      .addButton((button) => {
        button.buttonEl.dataset.portabilityFocus = "preset-everything";
        button.setButtonText("All + private recovery").setDisabled(Boolean(this.busyAction) || compatibilityReadOnly).onClick(() => {
          this.exportSelection = {
            ...completePortableSelection(this.activeExportLibraries().map((library) => library.id)),
            recovery: true,
          };
          this.exportRecoveryConfirmed = false;
          this.rerenderFromControl("preset-everything");
        });
      })
      .addButton((button) => {
        button.buttonEl.dataset.portabilityFocus = "preset-clear";
        button.setButtonText("Clear").setDisabled(Boolean(this.busyAction)).onClick(() => {
          this.exportSelection = cloneSelection(EMPTY_PORTABLE_SELECTION);
          this.exportRecoveryConfirmed = false;
          this.rerenderFromControl("preset-clear");
        });
      });
  }

  private renderImport(): void {
    const parent = this.renderParent();
    parent.createEl("p", {
      text: "Choose a command center portable export, older workspace export, or same-vault recovery backup. Import never writes, moves, or deletes Markdown notes.",
    });
    if (this.plugin.isDataReadOnly()) {
      const warning = parent.createDiv({ cls: "ent-cc-manager-diagnostic", attr: { role: "alert" } });
      warning.createEl("strong", { text: "Import unavailable in compatibility read-only mode" });
      warning.createEl("p", {
        text: "This build is preserving an unrecognized, newer, or unreadable data.json and will not overwrite it. Keep a copy of the raw file, then update the plugin or repair its data before importing.",
      });
      new Setting(parent).addButton((button) => {
        button.buttonEl.dataset.portabilityFocus = "import-close";
        button.setButtonText("Close").setDisabled(Boolean(this.busyAction)).onClick(() => this.close());
      });
      return;
    }

    const chooseLabel = this.importValue ? "Choose another JSON…" : "Choose JSON export…";
    new Setting(parent)
      .setName("Import file")
      .setDesc(Platform.isMobile
        ? "Choose a JSON file stored inside this vault. Files larger than 10 MB are rejected."
        : "Choose a JSON file from this device. Files larger than 10 MB are rejected.")
      .addButton((button) => {
        button.buttonEl.dataset.portabilityFocus = "import-file";
        button
          .setButtonText(this.busyAction === "file" ? "Reading JSON…" : chooseLabel)
          .setCta()
          .setDisabled(Boolean(this.busyAction))
          .onClick(() => this.chooseImportFile());
      });

    if (!this.importValue) {
      this.renderEmptySummary("No import file selected.");
      new Setting(parent).addButton((button) => {
        button.buttonEl.dataset.portabilityFocus = "import-close";
        button.setButtonText("Close").setDisabled(Boolean(this.busyAction)).onClick(() => this.close());
      });
      return;
    }

    const rawAvailable = selectionAvailableForExport(this.importValue);
    const sourceWorkspaceMode = this.importValue.components.workspace?.settings.workspaceMode;
    const workspaceBlockReason = rawAvailable.workspace && sourceWorkspaceMode
      && sourceWorkspaceMode !== this.plugin.data.settings.workspaceMode
      ? ` Source preset is ${sourceWorkspaceMode === "ent-clinical" ? "ENT clinical" : "Generic"}; this destination base is ${this.plugin.data.settings.workspaceMode === "ent-clinical" ? "ENT clinical" : "Generic"}. Other portable sections remain available.`
      : "";
    let recoveryCheck: ReturnType<typeof assertPersonalBackupMatchesVault> | null = null;
    let recoveryBlockReason = "";
    if (this.importValue.components.recovery) {
      try {
        recoveryCheck = assertPersonalBackupMatchesVault(
          this.importValue.components.recovery,
          this.currentVaultId(),
          (path) => this.recoveryPathExists(path),
          this.currentBaseId(),
          this.plugin.data.settings.workspaceName,
          this.plugin.data.settings.workspaceMode,
          true,
        );
      } catch (error) {
        recoveryBlockReason = errorMessage(error);
      }
    }
    const available = {
      ...rawAvailable,
      workspace: rawAvailable.workspace && !workspaceBlockReason,
      recovery: rawAvailable.recovery && !recoveryBlockReason,
    };
    this.renderImportSource(this.importValue);
    this.renderComponentToggles(this.importSelection, available, (selection) => {
      this.importSelection = selection;
    }, recoveryBlockReason, workspaceBlockReason);

    const selection = normalizePortableSelection(this.importSelection);
    this.renderSummary(this.importValue, selection, "Selected import");
    if (selection.recovery) {
      const recovery = this.importValue.components.recovery;
      const needsBaseOverride = recoveryCheck?.baseIdentity !== "verified";
      const warning = parent.createDiv({ cls: "ent-cc-manager-diagnostic" });
      const legacyCheck = recoveryCheck?.identity === "legacy-unverified" ? recoveryCheck : null;
      const legacy = legacyCheck !== null;
      warning.createEl("strong", {
        text: legacy
          ? "Legacy recovery selected — vault and base identity unverified"
          : recoveryCheck?.baseIdentity === "verified"
            ? "Same-base recovery selected — identities verified"
            : recoveryCheck?.baseIdentity === "cross-base-override"
              ? "Different knowledge base — explicit override required"
              : "Legacy base identity and preset unverified",
      });
      warning.createEl("p", {
        text: legacyCheck
          ? legacyCheck.referencedPathCount > 0
            ? `This older file has no embedded vault identity. A conservative preflight found ${legacyCheck.existingPathCount} of ${legacyCheck.referencedPathCount} unique referenced paths in this vault, meeting the required at-least-half threshold of ${legacyCheck.requiredPathCount} (50%). This does not prove origin. Restore only if you know ${this.importSourceLabel || "the selected file"} came from this vault.`
            : `This older file has no embedded vault identity and contains no note-path references to preflight. Restore only if you know ${this.importSourceLabel || "the selected file"} came from this vault.`
          : recoveryCheck?.baseIdentity === "verified"
            ? `Recovery is restored by itself, never merged with portable sections. Its embedded vault, knowledge-base, and ${recovery?.sourceWorkspaceMode === "ent-clinical" ? "ENT clinical" : "Generic"} preset identities match the active base.`
            : recoveryCheck?.baseIdentity === "cross-base-override"
              ? `This recovery belongs to “${recovery?.sourceBaseName || "Unknown source"}” (${recovery?.sourceBaseId || "unknown ID"}), but the active destination is “${this.plugin.data.settings.workspaceName}” (${this.currentBaseId()}). The ${recovery?.sourceWorkspaceMode === "ent-clinical" ? "ENT clinical" : "Generic"} preset matches, but restoring across bases replaces the destination base's recovery-managed organization.`
              : `This v1–v6 recovery verifies this vault but has no embedded knowledge-base identity or preset. The plugin cannot prove that it belongs to “${this.plugin.data.settings.workspaceName}” or that its original preset matches.`,
      });
      if (needsBaseOverride) {
        const baseConfirmation = new Setting(parent)
          .setName(recoveryCheck?.baseIdentity === "cross-base-override"
            ? "Confirm restore into a different base"
            : "Confirm base and preset are unverified")
          .setDesc(recoveryCheck?.baseIdentity === "cross-base-override"
            ? `I explicitly choose to restore organization from “${recovery?.sourceBaseName || "Unknown source"}” into “${this.plugin.data.settings.workspaceName}”. The preset matches, but these are different stable knowledge-base identities.`
            : `I accept that this v1–v6 file cannot verify its source knowledge base or preset, and I explicitly choose “${this.plugin.data.settings.workspaceName}” as the destination.`)
          .addToggle((toggle) => {
            toggle.toggleEl.dataset.portabilityFocus = "import-cross-base-confirm";
            toggle
              .setValue(this.crossBaseRecoveryConfirmed)
              .setDisabled(Boolean(this.busyAction))
              .onChange((confirmed) => {
                this.crossBaseRecoveryConfirmed = confirmed;
                this.rerenderFromControl("import-cross-base-confirm");
              });
          });
        baseConfirmation.settingEl.addClass("ent-cc-portability-toggle");
      }
      const confirmation = new Setting(parent)
        .setName("Confirm destructive recovery restore")
        .setDesc(legacy
          ? `I know ${this.importSourceLabel || "this JSON file"} came from this vault despite its missing identity. Meeting the at-least-half (50%) path threshold is not proof. Restore replaces collections, pins, the next list, saved views, index organization, named snapshots, and portable bindings.`
          : `I intend to restore ${this.importSourceLabel || "this JSON file"}. The plugin's vault-identity check passed; this confirmation acknowledges that recovery replaces collections, pins, the next list, saved views, index organization, named snapshots, and portable bindings.`)
        .addToggle((toggle) => {
          toggle.toggleEl.dataset.portabilityFocus = "import-recovery-confirm";
          toggle
            .setValue(this.recoveryConfirmed)
            .setDisabled(Boolean(this.busyAction))
            .onChange((confirmed) => {
              this.recoveryConfirmed = confirmed;
              this.rerenderFromControl("import-recovery-confirm");
            });
        });
      confirmation.settingEl.addClass("ent-cc-portability-toggle");
    } else {
      new Setting(parent)
        .setName("Import behavior")
        .setDesc(this.importMode === "merge"
          ? "Merge adds and updates the selected organization while keeping other local organization."
          : "Replace resets only the selected plugin sections. Notes absent from a replacement index may be hidden from that index, but Markdown files are never deleted or changed.")
        .addDropdown((dropdown) => {
          dropdown.selectEl.dataset.portabilityFocus = "import-behavior";
          dropdown
            .addOption("merge", "Merge with this vault")
            .addOption("replace", "Replace selected sections")
            .setValue(this.importMode)
            .setDisabled(Boolean(this.busyAction))
            .onChange((value) => {
              this.importMode = value === "replace" ? "replace" : "merge";
              this.rerenderFromControl("import-behavior");
            });
        });
    }

    new Setting(parent)
      .addButton((button) => {
        button.buttonEl.dataset.portabilityFocus = "import-cancel";
        button.setButtonText("Cancel").setDisabled(Boolean(this.busyAction)).onClick(() => this.close());
      })
      .addButton((button) => {
        button.buttonEl.dataset.portabilityFocus = "import-submit";
        const busyLabel = selection.recovery ? "Restoring…" : "Importing…";
        button
          .setButtonText(this.busyAction === "import" ? busyLabel : selection.recovery ? "Restore private recovery" : this.importMode === "merge" ? "Import and merge" : "Import and replace")
          .setCta()
          .setDisabled(Boolean(this.busyAction)
            || !portableSelectionHasAny(selection)
            || (selection.recovery && (!this.recoveryConfirmed
              || (recoveryCheck?.baseIdentity !== "verified" && !this.crossBaseRecoveryConfirmed))))
          .onClick(() => this.run("import", () => this.importSelected()));
      });
  }

  private renderComponentToggles(
    selection: PortableExportSelection,
    available: PortableExportSelection | undefined,
    onChange: (selection: PortableExportSelection) => void,
    recoveryBlockReason = "",
    workspaceBlockReason = "",
  ): void {
    const parent = this.renderParent();
    const normalizedSelection = normalizePortableSelection(selection);
    const normalizedAvailable = available ? normalizePortableSelection(available) : undefined;
    parent.createEl("h3", { text: available ? "Sections in this file" : "Sections to export" });
    for (const component of COMPONENTS) {
      const isAvailable = normalizedAvailable?.[component.key] ?? true;
      const unavailableInReadOnly = !available && component.key === "recovery" && this.plugin.isDataReadOnly();
      const unavailableText = available && !isAvailable
        ? component.key === "workspace" && workspaceBlockReason
          ? workspaceBlockReason
          : component.key === "recovery" && recoveryBlockReason
          ? ` ${recoveryBlockReason}`
          : " Not present in this file."
        : "";
      const readOnlyText = unavailableInReadOnly ? " Unavailable in compatibility read-only mode; preserve the raw data.json instead." : "";
      const focusKey = `${available ? "import" : "export"}-component-${component.key}`;
      const setting = new Setting(parent)
        .setName(component.label)
        .setDesc(`${component.description}${unavailableText}${readOnlyText}`)
        .addToggle((toggle) => {
          toggle.toggleEl.dataset.portabilityFocus = focusKey;
          toggle
            .setValue(isAvailable && normalizedSelection[component.key])
            .setDisabled(Boolean(this.busyAction) || !isAvailable || unavailableInReadOnly)
            .onChange((enabled) => {
              let next = cloneSelection(normalizedSelection);
              if (available && component.key === "recovery" && enabled) {
                next = { ...EMPTY_PORTABLE_SELECTION, recovery: true };
                this.importMode = "replace";
                this.recoveryConfirmed = false;
                this.crossBaseRecoveryConfirmed = false;
              } else {
                next[component.key] = enabled;
                if (available && component.key === "recovery" && !enabled) {
                  this.recoveryConfirmed = false;
                  this.crossBaseRecoveryConfirmed = false;
                }
                if (available && enabled && component.key !== "recovery" && next.recovery) {
                  next.recovery = false;
                  this.recoveryConfirmed = false;
                  this.crossBaseRecoveryConfirmed = false;
                }
              }
              if (!available && component.key === "recovery") this.exportRecoveryConfirmed = false;
              onChange(normalizePortableSelection(next));
              this.rerenderFromControl(focusKey);
            });
        });
      setting.settingEl.addClass("ent-cc-portability-toggle");
      if (component.key === "index") {
        this.renderLibraryToggles(normalizedSelection, normalizedAvailable, onChange);
      }
    }
  }

  private renderLibraryToggles(
    selection: PortableExportSelection,
    available: PortableExportSelection | undefined,
    onChange: (selection: PortableExportSelection) => void,
  ): void {
    const parent = this.renderParent();
    const libraries = available ? this.importLibraryDescriptors() : this.activeExportLibraries();
    const hasArchivedLibraries = !available
      && this.plugin.getLibraries(true).some((library) => library.archivedAt !== null);
    if (libraries.length === 0 && !hasArchivedLibraries) return;
    const selectedIds = new Set(normalizePortableSelection(selection).libraryIds);
    const availableIds = available ? new Set(normalizePortableSelection(available).libraryIds) : null;
    const section = parent.createDiv({ cls: "ent-cc-portability-library-section" });
    section.createEl("h4", { text: "Libraries" });
    section.createEl("p", {
      text: available
        ? "Each enabled Library is an authoritative path-free section in this file. Dependency-only Libraries remain visible but cannot be selected for Replace."
        : "Choose Libraries independently. Their stable identity, labels, icon, exact hierarchy, empty state, and subject names are included without note paths or contents.",
    });
    for (const library of libraries) {
      const isAvailable = availableIds?.has(library.id) ?? true;
      const focusKey = `${available ? "import" : "export"}-library-${library.id}`;
      const count = this.librarySubjectCount(library.id, available !== undefined);
      const label = library.sourceKind ? `${library.name} (built-in)` : library.name;
      const unavailableText = portabilityLibraryUnavailableText(Boolean(available), isAvailable);
      const setting = new Setting(section)
        .setName(label)
        .setDesc(`${count} ${count === 1 ? library.singularName : library.name}. Stable ID: ${library.id}.${unavailableText}`)
        .addToggle((toggle) => {
          toggle.toggleEl.dataset.portabilityFocus = focusKey;
          toggle
            .setValue(isAvailable && selectedIds.has(library.id))
            .setDisabled(Boolean(this.busyAction) || !isAvailable)
            .onChange((enabled) => {
              const nextIds = new Set(normalizePortableSelection(selection).libraryIds);
              if (enabled) nextIds.add(library.id);
              else nextIds.delete(library.id);
              let next = selectionWithLibraryIds(selection, [...nextIds]);
              if (available && enabled && next.recovery) {
                next = { ...next, recovery: false };
                this.recoveryConfirmed = false;
                this.crossBaseRecoveryConfirmed = false;
              }
              onChange(next);
              this.rerenderFromControl(focusKey);
            });
        });
      setting.settingEl.addClass("ent-cc-portability-toggle", "ent-cc-portability-library-toggle");
    }
    if (hasArchivedLibraries) {
      section.createEl("p", {
        cls: "ent-cc-portability-library-note",
        text: "Archived libraries are not part of the portable set. Restore one before exporting it, or use confirmed private same-vault recovery to preserve archived state.",
      });
    }
  }

  private activeExportLibraries(): LibraryDefinition[] {
    return this.plugin.getLibraries().map((library) => ({ ...library }));
  }

  private importLibraryDescriptors(): LibraryDescriptor[] {
    const value = this.importValue;
    const index = value?.components.index;
    if (!value || !index) return [];
    const definitions = new Map((index.libraries ?? []).map((library) => [library.id, library]));
    for (const summary of summarizePortableExport(value).libraries) {
      if (definitions.has(summary.id)) continue;
      definitions.set(summary.id, {
        id: summary.id,
        name: summary.name,
        singularName: "Item",
        icon: "library",
        order: definitions.size,
        sourceKind: null,
      });
    }
    return [...definitions.values()]
      .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  }

  private librarySubjectCount(libraryId: string, fromImport: boolean): number {
    if (fromImport) {
      return this.importValue?.components.index?.subjects
        .filter((subject) => subjectLibraryId(subject) === libraryId).length ?? 0;
    }
    return this.plugin.librarySubjectCount(libraryId);
  }

  private renderImportSource(value: PortableExportV1): void {
    const details = this.renderParent().createDiv({ cls: "ent-cc-manager-diagnostic" });
    details.createEl("strong", { text: value.sourceWorkspace || "Command Center export" });
    details.createEl("p", {
      cls: "ent-cc-portability-file-label",
      text: `Selected file: ${this.importSourceLabel || "Filename unavailable"}`,
      attr: { dir: "auto" },
    });
    details.createEl("p", {
      text: value.exportedAt ? `Exported ${value.exportedAt}` : "The source export did not include a date.",
    });
  }

  /** Test fixtures from older schemas may omit the new plugin boundary. */
  private currentVaultId(): string {
    return typeof this.plugin.getVaultId === "function" ? this.plugin.getVaultId() : "";
  }

  private currentBaseId(): string {
    return typeof this.plugin.getActiveKnowledgeBaseId === "function"
      ? this.plugin.getActiveKnowledgeBaseId()
      : this.openedBaseId;
  }

  private recoveryPathExists(path: string): boolean {
    return this.app.vault.getAbstractFileByPath(normalizePath(path)) !== null;
  }

  private renderSummary(
    value: PortableExportV1,
    selection: PortableExportSelection,
    heading: string,
  ): void {
    const normalized = normalizePortableSelection(selection);
    const summary = summarizePortableExport(value, normalized);
    const parts: string[] = [];
    if (normalized.workspace) parts.push("workspace settings");
    if (normalized.index) parts.push(`${summary.groups} groups`, `${summary.indexSubjects} index subjects`);
    for (const library of summary.libraries) {
      if (!normalized.libraryIds.includes(library.id)) continue;
      parts.push(`${library.subjects} ${library.name}`);
    }
    const explicitlyCountedSubjects = (normalized.index ? summary.indexSubjects : 0)
      + summary.libraries
        .filter((library) => normalized.libraryIds.includes(library.id))
        .reduce((total, library) => total + library.subjects, 0);
    if (summary.subjects > explicitlyCountedSubjects) {
      const dependencies = summary.subjects - explicitlyCountedSubjects;
      parts.push(`${dependencies} referenced subject ${dependencies === 1 ? "dependency" : "dependencies"}`);
    }
    if (normalized.collections) parts.push(`${summary.collections} collections`);
    if (normalized.study) parts.push(`${summary.pinned} pinned`, `${summary.next} in Next`);
    if (normalized.savedViews) parts.push(`${summary.views} saved views`);
    if (normalized.recovery && summary.hasRecovery) parts.push("same-vault recovery");
    const box = this.renderParent().createDiv({ cls: "ent-cc-manager-diagnostic ent-cc-portability-summary" });
    box.createEl("strong", { text: heading });
    box.createEl("p", { text: parts.length ? parts.join(" · ") : "No sections selected." });
    if (selectionUsesSubjectCatalog(normalized) && summary.subjects > 0) {
      box.createEl("p", {
        text: "In another vault, subjects that do not match a note remain as placeholders in their selected index or library until you create or link a note.",
      });
    }
    if (normalized.recovery && summary.hasRecovery) {
      box.createEl("p", {
        cls: "ent-cc-portability-path-warning-text",
        text: "Privacy warning: same-vault recovery includes exact vault-relative folder and Markdown filenames.",
      });
    }
    box.createEl("p", { text: "Note bodies and attachments: never included." });
  }

  private renderEmptySummary(message: string): void {
    const box = this.renderParent().createDiv({ cls: "ent-cc-empty ent-cc-portability-summary" });
    box.setText(message);
  }

  private renderError(message: string): void {
    const box = this.renderParent().createDiv({ cls: "ent-cc-manager-diagnostic" });
    box.createEl("strong", { text: "Cannot continue" });
    box.createEl("p", { text: message });
  }

  private async exportSelected(): Promise<void> {
    if (!this.guardOpenedBase()) return;
    const selection = normalizePortableSelection(this.exportSelection);
    if (!portableSelectionHasAny(selection)) throw new Error("Choose at least one section to export.");
    if (selection.recovery && this.plugin.isDataReadOnly()) {
      throw new Error("Same-vault recovery is unavailable in compatibility read-only mode. Preserve the raw data.json instead.");
    }
    if (selection.recovery && !this.exportRecoveryConfirmed) {
      throw new Error("Confirm that same-vault recovery contains exact private vault paths before exporting it.");
    }
    const now = new Date();
    const exportData = this.plugin.data;
    const prepared = preparePortableExport(
      exportData,
      selectionUsesSubjectCatalog(selection) ? this.plugin.getRecords() : [],
      selection,
      now.toISOString(),
      this.currentVaultId(),
      this.currentBaseId(),
      this.plugin.data.settings.workspaceName,
    );
    const previousPortableIndex = cloneJsonValue(exportData.portableIndex);
    let commitStarted = false;
    try {
      // The validated clone already contains the synchronized stable registry;
      // commit it once without repeating the full vault/index pass.
      if (selectionUsesSubjectCatalog(selection) && !this.plugin.isDataReadOnly()) {
        if (!this.guardOpenedBase()) return;
        commitStarted = true;
        exportData.portableIndex = prepared.portableIndex;
        this.plugin.invalidateRecordCache();
        await this.plugin.savePluginData();
        this.dataChanged = true;
        if (!this.guardOpenedBase()) return;
      }
      if (!this.guardOpenedBase()) return;
      const delivery = await deliverJsonExport(
        this.plugin,
        "portable",
        "knowledge-base-command-center-portable",
        prepared.value,
        { contentEl: this.contentEl, serialized: prepared.serialized, date: now },
      );
      if (delivery.medium === "vault") {
        if (!this.guardOpenedBase()) return;
        if (selection.recovery) this.plugin.recordRecoveryExport(now.getTime());
        new Notice(`Saved ${selectionCount(selection)} selected sections inside the vault at ${delivery.file.path}. Note contents were not included.`, 8000);
        this.close();
        return;
      }
      if (selection.recovery) this.plugin.recordRecoveryExport(now.getTime());
      new Notice(`Exported ${selectionCount(selection)} selected sections. Note contents and attachments were not included.`);
      this.close();
    } catch (error) {
      if (!this.guardOpenedBase()) return;
      if (commitStarted) {
        if (this.plugin.data !== exportData) {
          throw new Error(`The export failed (${errorMessage(error)}), but its registry rollback was skipped because the active knowledge-base data reloaded. Reopen the export/import center before retrying.`);
        }
        exportData.portableIndex = previousPortableIndex;
        this.plugin.invalidateRecordCache();
        try {
          await this.plugin.savePluginData();
          this.dataChanged = false;
          if (!this.guardOpenedBase()) return;
        } catch (rollbackError) {
          console.error("Knowledge Base Command Center could not persist the export rollback", rollbackError);
          throw new Error(`The export failed (${errorMessage(error)}) and its registry rollback could not be saved. Restart Obsidian before retrying.`);
        }
      }
      throw error;
    }
  }

  private chooseImportFile(): void {
    if (this.busyAction) return;
    requestJsonImport(this.app, this.plugin, {
      title: "Choose a Command Center export JSON",
      maxBytes: MAX_PORTABLE_PACKAGE_BYTES,
      oversizeMessage: "The selected JSON is larger than the 10 MB import limit.",
      emptyVaultMessage: "No JSON files were found in the vault. Copy an export JSON into the vault, then try again.",
      guard: () => this.guardOpenedBase(),
      run: (task) => this.run("file", task),
      onValue: (value, sourceLabel) => {
        this.setImportValue(parseAnyCommandCenterExport(value), sourceLabel);
      },
    });
  }

  private setImportValue(value: PortableExportV1, sourceLabel: string): void {
    if (!this.guardOpenedBase()) return;
    this.importValue = value;
    this.importSourceLabel = sourceLabel;
    const selection = selectionAvailableForExport(value);
    const sourceWorkspaceMode = value.components.workspace?.settings.workspaceMode;
    this.importSelection = {
      ...selection,
      workspace: selection.workspace && (!sourceWorkspaceMode
        || sourceWorkspaceMode === this.plugin.data.settings.workspaceMode),
      recovery: false,
    };
    this.importMode = "merge";
    this.recoveryConfirmed = false;
    this.crossBaseRecoveryConfirmed = false;
    this.pendingFocusKey = "import-file";
    if (!this.busyAction) this.render();
  }

  private validateWorkspaceComponent(
    value: PortableExportV1,
    selection: PortableExportSelection,
  ): WorkspaceImportValidation {
    const workspace = selection.workspace ? value.components.workspace : undefined;
    if (!workspace) {
      return { defaultTemplateReset: false, libraryTemplateResetIds: [], droppedLibraryProfileIds: [], missingFolderText: "" };
    }
    const settings = workspace.settings;
    const missingFolderText = missingImportedFolderNoticeText(
      settings,
      this.plugin.data.settings.workspaceMode,
      (path) => this.app.vault.getAbstractFileByPath(normalizePath(path)) instanceof TFolder,
    );
    for (const folder of [
      settings.primaryFolder,
      settings.defaultNoteFolder,
      settings.templatesFolder,
      settings.exportsFolder,
    ]) {
      const validation = validateWritableFolderPath(folder, this.app.vault.configDir);
      if (validation) throw new Error(validation);
    }
    const proposalValidation = settings.workspaceMode === "ent-clinical"
      ? validateProposalFolderPath(settings.proposalFolder, this.app.vault.configDir)
      : validateWritableFolderPath(settings.proposalFolder, this.app.vault.configDir);
    if (proposalValidation) throw new Error(proposalValidation);
    if (settings.attachmentStorageMode === "fixed-folder") {
      const attachmentValidation = validateWritableFolderPath(settings.attachmentFolder, this.app.vault.configDir);
      if (attachmentValidation) throw new Error(attachmentValidation);
    }

    let defaultTemplateReset = false;
    if (settings.defaultNewNoteMode === "template") {
      const templatePathError = validateTemplateFilePath(
        settings.defaultTemplatePath,
        settings.templatesFolder,
        this.app.vault.configDir,
      );
      const template = settings.defaultTemplatePath
        ? this.app.vault.getAbstractFileByPath(normalizePath(settings.defaultTemplatePath))
        : null;
      defaultTemplateReset = Boolean(templatePathError)
        || !(template instanceof TFile)
        || template.extension.toLocaleLowerCase() !== "md";
    }
    const effectiveSettings = cloneJsonValue(settings);
    if (defaultTemplateReset) {
      effectiveSettings.defaultNewNoteMode = "empty";
      effectiveSettings.defaultTemplatePath = "";
    }
    const destinationLibraryIds = new Set(
      this.plugin.data.portableIndex.libraries.map((library) => library.id),
    );
    for (const library of value.components.index?.libraries ?? []) destinationLibraryIds.add(library.id);
    const droppedLibraryProfileIds = Object.keys(effectiveSettings.libraryNoteProfiles)
      .filter((libraryId) => !destinationLibraryIds.has(libraryId));
    const libraryTemplateResetIds: string[] = [];
    for (const [libraryId, profile] of Object.entries(effectiveSettings.libraryNoteProfiles)) {
      if (!destinationLibraryIds.has(libraryId)) continue;
      if (profile.folder !== undefined) {
        const cleanedFolder = cleanLibraryNoteProfiles(
          { [libraryId]: { folder: profile.folder } },
          new Set([libraryId]),
        )[libraryId]?.folder;
        if (cleanedFolder === undefined) {
          throw new Error(`Library profile ${libraryId} contains an unsupported folder path.`);
        }
        const validation = validateWritableFolderPath(cleanedFolder, this.app.vault.configDir);
        if (validation) throw new Error(validation);
      }
      if (profile.templatePath) {
        const cleanedTemplate = cleanLibraryNoteProfiles(
          { [libraryId]: { templatePath: profile.templatePath } },
          new Set([libraryId]),
        )[libraryId]?.templatePath;
        const validation = cleanedTemplate === undefined ? "unsupported template path" : validateTemplateFilePath(
          profile.templatePath,
          effectiveSettings.templatesFolder,
          this.app.vault.configDir,
        );
        if (validation) {
          libraryTemplateResetIds.push(libraryId);
          const resetProfile = { ...profile, mode: "empty" as const };
          delete resetProfile.templatePath;
          effectiveSettings.libraryNoteProfiles[libraryId] = resetProfile;
          continue;
        }
      }
      const effective = resolveLibraryNoteProfile(effectiveSettings, libraryId);
      if (effective.mode !== "template") continue;
      const template = effective.templatePath
        ? this.app.vault.getAbstractFileByPath(normalizePath(effective.templatePath))
        : null;
      if (!(template instanceof TFile) || template.extension.toLocaleLowerCase() !== "md") {
        libraryTemplateResetIds.push(libraryId);
      }
    }
    return { defaultTemplateReset, libraryTemplateResetIds, droppedLibraryProfileIds, missingFolderText };
  }

  private async importSelected(): Promise<void> {
    if (!this.guardOpenedBase()) return;
    if (this.plugin.isDataReadOnly()) throw new Error("Import is unavailable in compatibility read-only mode.");
    const value = this.importValue;
    if (!value) throw new Error("Choose an import file first.");
    const selection = normalizePortableSelection(this.importSelection);
    if (!portableSelectionHasAny(selection)) throw new Error("Choose at least one section to import.");
    if (selection.recovery && !this.recoveryConfirmed) throw new Error("Confirm the destructive private recovery restore before continuing.");
    if (selection.recovery && value.components.recovery) {
      const assessment = assertPersonalBackupMatchesVault(
        value.components.recovery,
        this.currentVaultId(),
        (path) => this.recoveryPathExists(path),
        this.currentBaseId(),
        this.plugin.data.settings.workspaceName,
        this.plugin.data.settings.workspaceMode,
        true,
      );
      if (assessment.baseIdentity !== "verified" && !this.crossBaseRecoveryConfirmed) {
        throw new Error("Confirm the different or unverified source knowledge base before continuing.");
      }
      // This check must happen before mutate() creates an Undo snapshot or
      // invokes any apply path. The apply function repeats it defensively.
      assertPersonalBackupMatchesVault(
        value.components.recovery,
        this.currentVaultId(),
        (path) => this.recoveryPathExists(path),
        this.currentBaseId(),
        this.plugin.data.settings.workspaceName,
        this.plugin.data.settings.workspaceMode,
        this.crossBaseRecoveryConfirmed,
      );
    }
    const workspaceValidation = this.validateWorkspaceComponent(value, selection);
    // Reject an incompatible ENT Index package before mutate() creates Undo
    // state or applies any component. applyPortableExport repeats this check
    // defensively for non-UI callers.
    assertPortableImportDestinationCompatible(
      value,
      selection,
      this.plugin.data.settings.workspaceMode,
    );
    let imported = {
      addedSubjects: 0,
      updatedSubjects: 0,
      matchedSubjects: 0,
      unresolvedSubjects: 0,
      importedCollections: 0,
      importedViews: 0,
    };
    await this.plugin.mutate(
      `${this.importMode === "merge" ? "Merge" : "Replace"} Command Center portable export`,
      () => {
        const firstSelection: PortableExportSelection = {
          ...EMPTY_PORTABLE_SELECTION,
          workspace: selection.workspace,
          recovery: selection.recovery,
        };
        if (portableSelectionHasAny(firstSelection)) {
          applyPortableExport(
            this.plugin.data,
            value,
            firstSelection,
            this.importMode,
            this.currentVaultId(),
            (path) => this.recoveryPathExists(path),
            this.currentBaseId(),
            this.plugin.data.settings.workspaceName,
            this.crossBaseRecoveryConfirmed,
          );
          if (workspaceValidation.defaultTemplateReset && firstSelection.workspace) {
            // Keep destination-only template sanitization inside the same
            // undo-protected mutation as the workspace import. The selected
            // package remains immutable and a failed save rolls this back.
            this.plugin.data.settings.defaultNewNoteMode = "empty";
            this.plugin.data.settings.defaultTemplatePath = "";
          }
          if (firstSelection.workspace) {
            for (const libraryId of workspaceValidation.libraryTemplateResetIds) {
              const importedProfile = value.components.workspace?.settings.libraryNoteProfiles[libraryId];
              const profile = this.plugin.data.settings.libraryNoteProfiles[libraryId]
                ?? (importedProfile ? cleanLibraryNoteProfiles(
                  { [libraryId]: importedProfile },
                  new Set([libraryId]),
                )[libraryId] : undefined)
                ?? {};
              const resetProfile = { ...profile, mode: "empty" as const };
              delete resetProfile.templatePath;
              this.plugin.data.settings.libraryNoteProfiles[libraryId] = resetProfile;
            }
          }
          this.plugin.invalidateRecordCache();
        }
        if (selectionUsesSubjectCatalog(selection)) synchronizePortableRegistry(this.plugin.data, this.plugin.getRecords());
        const remainingSelection: PortableExportSelection = {
          ...selection,
          workspace: false,
          recovery: false,
        };
        if (portableSelectionHasAny(remainingSelection)) {
          imported = applyPortableExport(this.plugin.data, value, remainingSelection, this.importMode);
        }
        // Incoming topic identities can match existing resolved identities.
        // Recheck the effective source classification after application but
        // before save; mutate() rolls the complete import back on failure.
        this.plugin.assertClinicalIndexEligibility();
        this.plugin.invalidateRecordCache();
      },
      {
        includeSettings: selection.workspace,
        includePortableIndex: selectionUsesSubjectCatalog(selection)
          || selection.workspace
          || selection.savedViews
          || selection.recovery,
        includeLayoutSnapshots: selection.recovery,
        requireUndo: true,
        normalizeAfterRestore: selection.recovery,
      },
    );
    this.dataChanged = true;
    if (!this.guardOpenedBase()) return;
    const subjectText = selectionUsesSubjectCatalog(selection)
      ? ` ${imported.addedSubjects} added, ${imported.matchedSubjects} matched, and ${imported.unresolvedSubjects} awaiting a note.`
      : "";
    const profileResetText = workspaceValidation.libraryTemplateResetIds.length > 0
      ? ` ${workspaceValidation.libraryTemplateResetIds.length} Library ${workspaceValidation.libraryTemplateResetIds.length === 1 ? "profile was" : "profiles were"} reset to Empty note because its template is unavailable.`
      : "";
    const droppedProfileText = workspaceValidation.droppedLibraryProfileIds.length > 0
      ? ` ${workspaceValidation.droppedLibraryProfileIds.length} Library ${workspaceValidation.droppedLibraryProfileIds.length === 1 ? "profile was" : "profiles were"} omitted because the destination has no matching Library.`
      : "";
    new Notice(`Import complete.${subjectText}${workspaceValidation.defaultTemplateReset ? " The missing source template was reset to Empty note." : ""}${profileResetText}${droppedProfileText}${workspaceValidation.missingFolderText} Markdown notes were not changed.`, 10000);
    this.close();
  }

  private createBaseGuard(): OpenedBaseGuard {
    return createOpenedBaseGuard(this.plugin, {
      message: "The active knowledge base changed or its data was reloaded. Reopen the export/import center before continuing.",
      openedBaseId: this.openedBaseId,
      // A negative sentinel means "never captured", which only prototype-only
      // unit-test fixtures can still be holding.
      openedDataEpoch: this.openedDataEpoch >= 0 ? this.openedDataEpoch : undefined,
      onStale: () => { if (this.centerOpen) this.close(); },
    });
  }

  private guardOpenedBase(): boolean {
    // Prototype-only unit-test fixtures do not run onOpen(); with no captured
    // base id there is nothing they could have gone stale against.
    if (!this.openedBaseId) return true;
    return (this.ownsBase ??= this.createBaseGuard())();
  }

  private setGuardedTimer(action: () => void, delay: number): number {
    return setGuardedTimer({
      contentEl: this.contentEl,
      timers: (this.pendingTimers ??= new Set<number>()),
      proceed: () => this.centerOpen && this.guardOpenedBase(),
      action,
      delay,
    });
  }

  private run(kind: BusyAction, action: () => Promise<void>): void {
    if (this.busyAction || !this.guardOpenedBase()) return;
    this.busyAction = kind;
    this.render();
    void action()
      .catch((error) => {
        if (!this.guardOpenedBase()) return;
        console.error("Knowledge Base Command Center portability action failed", error);
        new Notice(errorMessage(error), 8000);
      })
      .finally(() => {
        this.busyAction = null;
        if (!this.centerOpen || !this.guardOpenedBase()) return;
        this.pendingFocusKey ??= kind === "file" ? "import-file" : `${kind}-submit`;
        this.render();
      });
  }
}
