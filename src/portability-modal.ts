import { Modal, Notice, Platform, Setting, TFile, normalizePath } from "obsidian";
import type EntVaultCommandCenterPlugin from "./main";
import {
  assertPersonalBackupMatchesVault,
  validateProposalFolderPath,
  validateTemplateFilePath,
  validateWritableFolderPath,
  type PluginData,
  type PortableIndexLocalState,
  type VaultRecord,
} from "./model";
import { VaultFilePickerModal } from "./modals";
import {
  applyPortableExport,
  COMPLETE_PORTABLE_SELECTION,
  createPortableExport,
  EMPTY_PORTABLE_SELECTION,
  MAX_PORTABLE_PACKAGE_BYTES,
  normalizePortableSelection,
  parseAnyCommandCenterExport,
  portableSelectionHasAny,
  PortableExportSelection,
  PortableExportV1,
  PortableImportMode,
  selectionAvailableForExport,
  serializePortableExport,
  summarizePortableExport,
  synchronizePortableRegistry,
} from "./portability";

type CenterMode = "export" | "import";
type ComponentKey = keyof PortableExportSelection;
type BusyAction = "export" | "import" | "file";

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
    portableIndex: structuredClone(data.portableIndex),
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
    key: "procedures",
    label: "Procedures",
    description: "Procedure names and portable identities only. Missing notes become actionable placeholders in a Procedures tab.",
  },
  {
    key: "medications",
    label: "Medications",
    description: "Medication names and portable identities only. Doses, note bodies, and attachments are never included.",
  },
  {
    key: "syndromes",
    label: "Syndromes",
    description: "Syndrome names and portable identities only. Missing notes become actionable placeholders in a Syndromes tab.",
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
  return { ...value };
}

function selectionCount(selection: PortableExportSelection): number {
  return COMPONENTS.filter(({ key }) => selection[key]).length;
}

function selectionUsesSubjectCatalog(selection: PortableExportSelection): boolean {
  return selection.index
    || selection.procedures
    || selection.medications
    || selection.syndromes
    || selection.collections
    || selection.study;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ExportImportCenterModal extends Modal {
  private mode: CenterMode;
  private exportSelection = cloneSelection(COMPLETE_PORTABLE_SELECTION);
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
  private openedBaseId = "";
  private openedDataEpoch = -1;
  private staleBaseNoticeShown = false;
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
  }

  onOpen(): void {
    this.openedBaseId = this.plugin.getActiveKnowledgeBaseId();
    this.openedDataEpoch = this.plugin.getDataEpoch();
    this.staleBaseNoticeShown = false;
    this.centerOpen = true;
    this.modalEl.addClass("ent-cc-portability-modal");
    this.contentEl.addClass("ent-cc-modal", "ent-cc-portability-center");
    this.modalEl.addEventListener("keydown", this.blockCloseWhileBusy, true);
    this.render();
  }

  onClose(): void {
    this.centerOpen = false;
    for (const timer of this.pendingTimers) {
      const viewWindow = this.contentEl.ownerDocument.defaultView ?? window;
      viewWindow.clearTimeout(timer);
    }
    this.pendingTimers.clear();
    this.modalEl.removeEventListener("keydown", this.blockCloseWhileBusy, true);
    if (this.completionNotified) return;
    this.completionNotified = true;
    this.onComplete?.(this.dataChanged);
  }

  private render(): void {
    if (!this.guardOpenedBase()) return;
    const scrollTop = this.contentEl.scrollTop;
    this.contentEl.empty();
    this.titleEl.setText("Export / import center");
    this.renderModePicker();
    if (this.mode === "export") this.renderExport();
    else this.renderImport();
    this.contentEl.scrollTop = scrollTop;
    this.updateBusyPresentation();
    this.restorePendingFocus();
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
          type: "button",
          role: "tab",
          "aria-selected": String(active),
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
    };
    addTab("export", "Export");
    addTab("import", "Import");
  }

  private renderExport(): void {
    const compatibilityReadOnly = this.plugin.isDataReadOnly();
    if (compatibilityReadOnly && this.exportSelection.recovery) {
      this.exportSelection = { ...this.exportSelection, recovery: false };
      this.exportRecoveryConfirmed = false;
    }
    this.contentEl.createEl("p", {
      text: "Choose exactly what to carry to another vault or device. Markdown note bodies and attachments are never included.",
    });
    if (compatibilityReadOnly) {
      const warning = this.contentEl.createDiv({ cls: "ent-cc-manager-diagnostic", attr: { role: "alert" } });
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
      const warning = this.contentEl.createDiv({ cls: "ent-cc-manager-diagnostic ent-cc-portability-path-warning", attr: { role: "alert" } });
      warning.createEl("strong", { text: "Exact vault paths will be included" });
      warning.createEl("p", {
        text: "Same-vault recovery contains exact folder and Markdown filenames from this vault. Treat the JSON as private. The plugin embeds this vault's identity and will reject it in every other vault.",
      });
      const confirmation = new Setting(this.contentEl)
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

    new Setting(this.contentEl)
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
    const compatibilityReadOnly = this.plugin.isDataReadOnly();
    new Setting(this.contentEl)
      .setName("Quick selection")
      .setDesc("Portable set is for cross-vault transfer. All + private recovery additionally creates exact-path recovery that is locked to this vault and requires separate confirmation.")
      .addButton((button) => {
        button.buttonEl.dataset.portabilityFocus = "preset-portable";
        button.setButtonText("Portable set").setDisabled(Boolean(this.busyAction)).onClick(() => {
          this.exportSelection = cloneSelection(COMPLETE_PORTABLE_SELECTION);
          this.exportRecoveryConfirmed = false;
          this.rerenderFromControl("preset-portable");
        });
      })
      .addButton((button) => {
        button.buttonEl.dataset.portabilityFocus = "preset-everything";
        button.setButtonText("All + private recovery").setDisabled(Boolean(this.busyAction) || compatibilityReadOnly).onClick(() => {
          this.exportSelection = {
            workspace: true,
            index: true,
            procedures: true,
            medications: true,
            syndromes: true,
            collections: true,
            study: true,
            savedViews: true,
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
    this.contentEl.createEl("p", {
      text: "Choose a command center portable export, older workspace export, or same-vault recovery backup. Import never writes, moves, or deletes Markdown notes.",
    });
    if (this.plugin.isDataReadOnly()) {
      const warning = this.contentEl.createDiv({ cls: "ent-cc-manager-diagnostic", attr: { role: "alert" } });
      warning.createEl("strong", { text: "Import unavailable in compatibility read-only mode" });
      warning.createEl("p", {
        text: "This build is preserving an unrecognized, newer, or unreadable data.json and will not overwrite it. Keep a copy of the raw file, then update the plugin or repair its data before importing.",
      });
      new Setting(this.contentEl).addButton((button) => {
        button.buttonEl.dataset.portabilityFocus = "import-close";
        button.setButtonText("Close").setDisabled(Boolean(this.busyAction)).onClick(() => this.close());
      });
      return;
    }

    const chooseLabel = this.importValue ? "Choose another JSON…" : "Choose JSON export…";
    new Setting(this.contentEl)
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
      new Setting(this.contentEl).addButton((button) => {
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
      const warning = this.contentEl.createDiv({ cls: "ent-cc-manager-diagnostic" });
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
        const baseConfirmation = new Setting(this.contentEl)
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
      const confirmation = new Setting(this.contentEl)
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
      new Setting(this.contentEl)
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

    new Setting(this.contentEl)
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
    this.contentEl.createEl("h3", { text: available ? "Sections in this file" : "Sections to export" });
    for (const component of COMPONENTS) {
      const isAvailable = available?.[component.key] ?? true;
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
      const setting = new Setting(this.contentEl)
        .setName(component.label)
        .setDesc(`${component.description}${unavailableText}${readOnlyText}`)
        .addToggle((toggle) => {
          toggle.toggleEl.dataset.portabilityFocus = focusKey;
          toggle
            .setValue(isAvailable && selection[component.key])
            .setDisabled(Boolean(this.busyAction) || !isAvailable || unavailableInReadOnly)
            .onChange((enabled) => {
              let next = cloneSelection(selection);
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
    }
  }

  private renderImportSource(value: PortableExportV1): void {
    const details = this.contentEl.createDiv({ cls: "ent-cc-manager-diagnostic" });
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
    const summary = summarizePortableExport(value, selection);
    const parts: string[] = [];
    if (selection.workspace) parts.push("workspace settings");
    if (selection.index) parts.push(`${summary.groups} groups`, `${summary.indexSubjects} index subjects`);
    if (selection.procedures) parts.push(`${summary.procedures} procedures`);
    if (selection.medications) parts.push(`${summary.medications} medications`);
    if (selection.syndromes) parts.push(`${summary.syndromes} syndromes`);
    const explicitlyCountedSubjects = (selection.index ? summary.indexSubjects : 0)
      + (selection.procedures ? summary.procedures : 0)
      + (selection.medications ? summary.medications : 0)
      + (selection.syndromes ? summary.syndromes : 0);
    if (summary.subjects > explicitlyCountedSubjects) {
      const dependencies = summary.subjects - explicitlyCountedSubjects;
      parts.push(`${dependencies} referenced subject ${dependencies === 1 ? "dependency" : "dependencies"}`);
    }
    if (selection.collections) parts.push(`${summary.collections} collections`);
    if (selection.study) parts.push(`${summary.pinned} pinned`, `${summary.next} in Next`);
    if (selection.savedViews) parts.push(`${summary.views} saved views`);
    if (selection.recovery && summary.hasRecovery) parts.push("same-vault recovery");
    const box = this.contentEl.createDiv({ cls: "ent-cc-manager-diagnostic ent-cc-portability-summary" });
    box.createEl("strong", { text: heading });
    box.createEl("p", { text: parts.length ? parts.join(" · ") : "No sections selected." });
    if (selectionUsesSubjectCatalog(selection) && summary.subjects > 0) {
      box.createEl("p", {
        text: "In another vault, subjects that do not match a note remain as placeholders in their selected index or library until you create or link a note.",
      });
    }
    if (selection.recovery && summary.hasRecovery) {
      box.createEl("p", {
        cls: "ent-cc-portability-path-warning-text",
        text: "Privacy warning: same-vault recovery includes exact vault-relative folder and Markdown filenames.",
      });
    }
    box.createEl("p", { text: "Note bodies and attachments: never included." });
  }

  private renderEmptySummary(message: string): void {
    const box = this.contentEl.createDiv({ cls: "ent-cc-empty ent-cc-portability-summary" });
    box.setText(message);
  }

  private renderError(message: string): void {
    const box = this.contentEl.createDiv({ cls: "ent-cc-manager-diagnostic" });
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
    const previousPortableIndex = structuredClone(exportData.portableIndex);
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
      if (Platform.isMobile) {
        const file = await this.plugin.writePortableJson("portable", prepared.value);
        if (!this.guardOpenedBase()) return;
        new Notice(`Saved ${selectionCount(selection)} selected sections inside the vault at ${file.path}. Note contents were not included.`, 8000);
        this.close();
        return;
      }

      const viewWindow = this.contentEl.ownerDocument.defaultView ?? window;
      if (!this.guardOpenedBase()) return;
      const url = viewWindow.URL.createObjectURL(new Blob([prepared.serialized], { type: "application/json" }));
      const link = createEl("a");
      link.href = url;
      link.download = `knowledge-base-command-center-portable-${now.toISOString().slice(0, 10)}.json`;
      link.click();
      viewWindow.setTimeout(() => viewWindow.URL.revokeObjectURL(url), 1000);
      new Notice(`Exported ${selectionCount(selection)} selected sections. Note contents and attachments were not included.`);
      this.close();
    } catch (error) {
      if (!this.ownsOpenedBase()) {
        this.guardOpenedBase();
        return;
      }
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
    if (this.busyAction || !this.guardOpenedBase()) return;
    if (Platform.isMobile) {
      const files = this.plugin.getPortableJsonFiles();
      if (files.length === 0) {
        new Notice("No JSON files were found in the vault. Copy an export JSON into the vault, then try again.");
        return;
      }
      new VaultFilePickerModal(this.app, files, "Choose a Command Center export JSON", (file) => {
        if (!this.guardOpenedBase()) return;
        this.run("file", () => this.loadImportValue(this.plugin.readPortableJson(file), file.path));
      }).open();
      return;
    }

    const input = createEl("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", () => {
      if (!this.guardOpenedBase()) return;
      const file = input.files?.[0];
      if (!file) return;
      this.run("file", async () => {
        if (file.size > MAX_PORTABLE_PACKAGE_BYTES) throw new Error("The selected JSON is larger than the 10 MB import limit.");
        const parsed = JSON.parse(await file.text()) as unknown;
        if (!this.guardOpenedBase()) return;
        this.setImportValue(parseAnyCommandCenterExport(parsed), file.name);
      });
    });
    input.click();
  }

  private async loadImportValue(value: Promise<unknown>, sourceLabel: string): Promise<void> {
    const parsed = parseAnyCommandCenterExport(await value);
    if (!this.guardOpenedBase()) return;
    this.setImportValue(parsed, sourceLabel);
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

  private validateWorkspaceComponent(value: PortableExportV1, selection: PortableExportSelection): boolean {
    const workspace = selection.workspace ? value.components.workspace : undefined;
    if (!workspace) return false;
    const settings = workspace.settings;
    for (const folder of [settings.primaryFolder, settings.defaultNoteFolder, settings.templatesFolder]) {
      const validation = validateWritableFolderPath(folder, this.app.vault.configDir);
      if (validation) throw new Error(validation);
    }
    const proposalValidation = settings.workspaceMode === "ent-clinical"
      ? validateProposalFolderPath(settings.proposalFolder, this.app.vault.configDir)
      : validateWritableFolderPath(settings.proposalFolder, this.app.vault.configDir);
    if (proposalValidation) throw new Error(proposalValidation);

    if (settings.defaultNewNoteMode !== "template") return false;
    const templatePathError = validateTemplateFilePath(
      settings.defaultTemplatePath,
      settings.templatesFolder,
      this.app.vault.configDir,
    );
    const template = settings.defaultTemplatePath
      ? this.app.vault.getAbstractFileByPath(normalizePath(settings.defaultTemplatePath))
      : null;
    if (!templatePathError && template instanceof TFile && template.extension.toLocaleLowerCase() === "md") return false;
    return true;
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
    const templateReset = this.validateWorkspaceComponent(value, selection);
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
          if (templateReset && firstSelection.workspace) {
            // Keep destination-only template sanitization inside the same
            // undo-protected mutation as the workspace import. The selected
            // package remains immutable and a failed save rolls this back.
            this.plugin.data.settings.defaultNewNoteMode = "empty";
            this.plugin.data.settings.defaultTemplatePath = "";
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
        this.plugin.invalidateRecordCache();
      },
      {
        includeSettings: selection.workspace,
        includePortableIndex: selectionUsesSubjectCatalog(selection) || selection.recovery,
        includeLayoutSnapshots: selection.recovery,
        requireUndo: true,
      },
    );
    this.dataChanged = true;
    if (!this.guardOpenedBase()) return;
    const subjectText = selectionUsesSubjectCatalog(selection)
      ? ` ${imported.addedSubjects} added, ${imported.matchedSubjects} matched, and ${imported.unresolvedSubjects} awaiting a note.`
      : "";
    new Notice(`Import complete.${subjectText}${templateReset ? " The missing source template was reset to Empty note." : ""} Markdown notes were not changed.`, 10000);
    this.close();
  }

  private ownsOpenedBase(): boolean {
    // Prototype-only unit-test fixtures do not run onOpen(); real modal
    // instances always capture a non-empty ID and non-negative epoch before
    // their first render.
    const ownsBase = !this.openedBaseId || this.plugin.getActiveKnowledgeBaseId() === this.openedBaseId;
    const ownsEpoch = typeof this.openedDataEpoch !== "number"
      || this.openedDataEpoch < 0
      || this.plugin.getDataEpoch() === this.openedDataEpoch;
    return ownsBase && ownsEpoch;
  }

  private guardOpenedBase(): boolean {
    if (this.ownsOpenedBase()) return true;
    const showNotice = !this.staleBaseNoticeShown;
    this.staleBaseNoticeShown = true;
    if (this.centerOpen) this.close();
    if (showNotice) {
      new Notice("The active knowledge base changed or its data was reloaded. Reopen the export/import center before continuing.", 8000);
    }
    return false;
  }

  private setGuardedTimer(action: () => void, delay: number): number {
    const viewWindow = this.contentEl.ownerDocument.defaultView ?? window;
    let timer = 0;
    let firedSynchronously = false;
    timer = viewWindow.setTimeout(() => {
      firedSynchronously = true;
      this.pendingTimers?.delete(timer);
      if (!this.centerOpen || !this.guardOpenedBase()) return;
      action();
    }, delay);
    if (!firedSynchronously) (this.pendingTimers ??= new Set<number>()).add(timer);
    return timer;
  }

  private run(kind: BusyAction, action: () => Promise<void>): void {
    if (this.busyAction || !this.guardOpenedBase()) return;
    this.busyAction = kind;
    this.render();
    void action()
      .catch((error) => {
        if (!this.ownsOpenedBase()) {
          this.guardOpenedBase();
          return;
        }
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

export function openExportImportCenter(
  plugin: EntVaultCommandCenterPlugin,
  initialMode: CenterMode = "export",
  onComplete?: (dataChanged: boolean) => void,
): ExportImportCenterModal {
  const modal = new ExportImportCenterModal(plugin, initialMode, onComplete);
  modal.open();
  return modal;
}
