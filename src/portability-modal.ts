import { Modal, Notice, Platform, Setting, TFile, normalizePath } from "obsidian";
import type EntVaultCommandCenterPlugin from "./main";
import {
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
): PreparedPortableExport {
  const preparedData = isolatedExportData(data);
  const value = createPortableExport(preparedData, records, selection, exportedAt);
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
    description: "Knowledge-base name, labels, configured folder and template paths, metadata mappings, behavior, and group order.",
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
    description: "A recovery snapshot that may contain vault-relative note paths. Use it only to restore the same vault.",
  },
];

function cloneSelection(value: PortableExportSelection): PortableExportSelection {
  return { ...value };
}

function selectionCount(selection: PortableExportSelection): number {
  return COMPONENTS.filter(({ key }) => selection[key]).length;
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
  private exportRecoveryConfirmed = false;
  private busyAction: BusyAction | null = null;
  private centerOpen = false;
  private dataChanged = false;
  private completionNotified = false;
  private pendingFocusKey: string | null = null;

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
    this.centerOpen = true;
    this.modalEl.addClass("ent-cc-portability-modal");
    this.contentEl.addClass("ent-cc-modal", "ent-cc-portability-center");
    this.modalEl.addEventListener("keydown", this.blockCloseWhileBusy, true);
    this.render();
  }

  onClose(): void {
    this.centerOpen = false;
    this.modalEl.removeEventListener("keydown", this.blockCloseWhileBusy, true);
    if (this.completionNotified) return;
    this.completionNotified = true;
    this.onComplete?.(this.dataChanged);
  }

  private render(): void {
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
    const viewWindow = this.contentEl.ownerDocument.defaultView ?? window;
    viewWindow.setTimeout(() => {
      if (!this.centerOpen) return;
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
        text: "Same-vault recovery contains exact folder and Markdown filenames from this vault. Treat the JSON as private and restore it only to this same vault.",
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
          selection.index ? this.plugin.getRecords() : [],
          selection,
          new Date().toISOString(),
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
      .setDesc("Portable set excludes private recovery paths. Everything adds same-vault recovery and requires a separate exact-path confirmation before export.")
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
        button.setButtonText("Everything").setDisabled(Boolean(this.busyAction) || compatibilityReadOnly).onClick(() => {
          this.exportSelection = {
            workspace: true,
            index: true,
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

    const available = selectionAvailableForExport(this.importValue);
    this.renderImportSource(this.importValue);
    this.renderComponentToggles(this.importSelection, available, (selection) => {
      this.importSelection = selection;
    });

    const selection = normalizePortableSelection(this.importSelection);
    this.renderSummary(this.importValue, selection, "Selected import");
    if (selection.recovery) {
      const warning = this.contentEl.createDiv({ cls: "ent-cc-manager-diagnostic" });
      warning.createEl("strong", { text: "Same-vault recovery selected" });
      warning.createEl("p", {
        text: `Recovery is restored by itself, never merged with portable sections. It contains vault-relative paths and replaces recovery-managed organization. Verify ${this.importSourceLabel || "the selected file"} came from this same vault.`,
      });
      const confirmation = new Setting(this.contentEl)
        .setName("Confirm same-vault restore")
        .setDesc(`I verified ${this.importSourceLabel || "this JSON file"} is the intended same-vault backup. Restore replaces collections, pins, the next list, saved views, index organization, named snapshots, and portable bindings with exact-path recovery data.`)
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
          .setButtonText(this.busyAction === "import" ? busyLabel : selection.recovery ? "Restore same-vault recovery" : this.importMode === "merge" ? "Import and merge" : "Import and replace")
          .setCta()
          .setDisabled(Boolean(this.busyAction) || !portableSelectionHasAny(selection) || (selection.recovery && !this.recoveryConfirmed))
          .onClick(() => this.run("import", () => this.importSelected()));
      });
  }

  private renderComponentToggles(
    selection: PortableExportSelection,
    available: PortableExportSelection | undefined,
    onChange: (selection: PortableExportSelection) => void,
  ): void {
    this.contentEl.createEl("h3", { text: available ? "Sections in this file" : "Sections to export" });
    for (const component of COMPONENTS) {
      const dependencyLock = component.key === "index" && (selection.collections || selection.study);
      const isAvailable = available?.[component.key] ?? true;
      const unavailableInReadOnly = !available && component.key === "recovery" && this.plugin.isDataReadOnly();
      const unavailableText = available && !isAvailable ? " Not present in this file." : "";
      const readOnlyText = unavailableInReadOnly ? " Unavailable in compatibility read-only mode; preserve the raw data.json instead." : "";
      const dependencyText = dependencyLock ? " Required by Collections or Study state." : "";
      const focusKey = `${available ? "import" : "export"}-component-${component.key}`;
      const setting = new Setting(this.contentEl)
        .setName(component.label)
        .setDesc(`${component.description}${unavailableText}${readOnlyText}${dependencyText}`)
        .addToggle((toggle) => {
          toggle.toggleEl.dataset.portabilityFocus = focusKey;
          toggle
            .setValue(isAvailable && selection[component.key])
            .setDisabled(Boolean(this.busyAction) || !isAvailable || dependencyLock || unavailableInReadOnly)
            .onChange((enabled) => {
              let next = cloneSelection(selection);
              if (available && component.key === "recovery" && enabled) {
                next = { ...EMPTY_PORTABLE_SELECTION, recovery: true };
                this.importMode = "replace";
                this.recoveryConfirmed = false;
              } else {
                next[component.key] = enabled;
                if (available && enabled && component.key !== "recovery" && next.recovery) {
                  next.recovery = false;
                  this.recoveryConfirmed = false;
                }
              }
              if (!available && component.key === "recovery") this.exportRecoveryConfirmed = false;
              if ((component.key === "collections" || component.key === "study") && enabled) next.index = true;
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

  private renderSummary(
    value: PortableExportV1,
    selection: PortableExportSelection,
    heading: string,
  ): void {
    const summary = summarizePortableExport(value);
    const parts: string[] = [];
    if (selection.workspace) parts.push("workspace settings");
    if (selection.index) parts.push(`${summary.groups} groups`, `${summary.subjects} subjects`);
    if (selection.collections) parts.push(`${summary.collections} collections`);
    if (selection.study) parts.push(`${summary.pinned} pinned`, `${summary.next} in Next`);
    if (selection.savedViews) parts.push(`${summary.views} saved views`);
    if (selection.recovery && summary.hasRecovery) parts.push("same-vault recovery");
    const box = this.contentEl.createDiv({ cls: "ent-cc-manager-diagnostic ent-cc-portability-summary" });
    box.createEl("strong", { text: heading });
    box.createEl("p", { text: parts.length ? parts.join(" · ") : "No sections selected." });
    if (selection.index && summary.subjects > 0) {
      box.createEl("p", {
        text: "In another vault, subjects that do not match a note remain in the index as placeholders until you create or link a note.",
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
    const selection = normalizePortableSelection(this.exportSelection);
    if (!portableSelectionHasAny(selection)) throw new Error("Choose at least one section to export.");
    if (selection.recovery && this.plugin.isDataReadOnly()) {
      throw new Error("Same-vault recovery is unavailable in compatibility read-only mode. Preserve the raw data.json instead.");
    }
    if (selection.recovery && !this.exportRecoveryConfirmed) {
      throw new Error("Confirm that same-vault recovery contains exact private vault paths before exporting it.");
    }
    const now = new Date();
    const prepared = preparePortableExport(
      this.plugin.data,
      selection.index ? this.plugin.getRecords() : [],
      selection,
      now.toISOString(),
    );
    const previousPortableIndex = structuredClone(this.plugin.data.portableIndex);
    let commitStarted = false;
    try {
      // The validated clone already contains the synchronized stable registry;
      // commit it once without repeating the full vault/index pass.
      if (selection.index && !this.plugin.isDataReadOnly()) {
        commitStarted = true;
        this.plugin.data.portableIndex = prepared.portableIndex;
        this.plugin.invalidateRecordCache();
        await this.plugin.savePluginData();
      }
      if (Platform.isMobile) {
        const file = await this.plugin.writePortableJson("portable", prepared.value);
        this.dataChanged ||= commitStarted;
        new Notice(`Saved ${selectionCount(selection)} selected sections inside the vault at ${file.path}. Note contents were not included.`, 8000);
        this.close();
        return;
      }

      const viewWindow = this.contentEl.ownerDocument.defaultView ?? window;
      const url = viewWindow.URL.createObjectURL(new Blob([prepared.serialized], { type: "application/json" }));
      const link = createEl("a");
      link.href = url;
      link.download = `knowledge-base-command-center-portable-${now.toISOString().slice(0, 10)}.json`;
      link.click();
      viewWindow.setTimeout(() => viewWindow.URL.revokeObjectURL(url), 1000);
      this.dataChanged ||= commitStarted;
      new Notice(`Exported ${selectionCount(selection)} selected sections. Note contents and attachments were not included.`);
      this.close();
    } catch (error) {
      if (commitStarted) {
        this.plugin.data.portableIndex = previousPortableIndex;
        this.plugin.invalidateRecordCache();
        try {
          await this.plugin.savePluginData();
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
    if (Platform.isMobile) {
      const files = this.plugin.getPortableJsonFiles();
      if (files.length === 0) {
        new Notice("No JSON files were found in the vault. Copy an export JSON into the vault, then try again.");
        return;
      }
      new VaultFilePickerModal(this.app, files, "Choose a Command Center export JSON", (file) => {
        this.run("file", () => this.loadImportValue(this.plugin.readPortableJson(file), file.path));
      }).open();
      return;
    }

    const input = createEl("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      this.run("file", async () => {
        if (file.size > MAX_PORTABLE_PACKAGE_BYTES) throw new Error("The selected JSON is larger than the 10 MB import limit.");
        const parsed = JSON.parse(await file.text()) as unknown;
        this.setImportValue(parseAnyCommandCenterExport(parsed), file.name);
      });
    });
    input.click();
  }

  private async loadImportValue(value: Promise<unknown>, sourceLabel: string): Promise<void> {
    this.setImportValue(parseAnyCommandCenterExport(await value), sourceLabel);
  }

  private setImportValue(value: PortableExportV1, sourceLabel: string): void {
    this.importValue = value;
    this.importSourceLabel = sourceLabel;
    this.importSelection = { ...selectionAvailableForExport(value), recovery: false };
    this.importMode = "merge";
    this.recoveryConfirmed = false;
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
    if (this.plugin.isDataReadOnly()) throw new Error("Import is unavailable in compatibility read-only mode.");
    const value = this.importValue;
    if (!value) throw new Error("Choose an import file first.");
    const selection = normalizePortableSelection(this.importSelection);
    if (!portableSelectionHasAny(selection)) throw new Error("Choose at least one section to import.");
    if (selection.recovery && !this.recoveryConfirmed) throw new Error("Confirm that this is a same-vault recovery restore before continuing.");
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
          applyPortableExport(this.plugin.data, value, firstSelection, this.importMode);
          if (templateReset && firstSelection.workspace) {
            // Keep destination-only template sanitization inside the same
            // undo-protected mutation as the workspace import. The selected
            // package remains immutable and a failed save rolls this back.
            this.plugin.data.settings.defaultNewNoteMode = "empty";
            this.plugin.data.settings.defaultTemplatePath = "";
          }
          this.plugin.invalidateRecordCache();
        }
        if (selection.index) synchronizePortableRegistry(this.plugin.data, this.plugin.getRecords());
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
        includePortableIndex: selection.index || selection.recovery,
        includeLayoutSnapshots: selection.recovery,
        requireUndo: true,
      },
    );
    this.dataChanged = true;
    const subjectText = selection.index
      ? ` ${imported.addedSubjects} added, ${imported.matchedSubjects} matched, and ${imported.unresolvedSubjects} awaiting a note.`
      : "";
    new Notice(`Import complete.${subjectText}${templateReset ? " The missing source template was reset to Empty note." : ""} Markdown notes were not changed.`, 10000);
    this.close();
  }

  private run(kind: BusyAction, action: () => Promise<void>): void {
    if (this.busyAction) return;
    this.busyAction = kind;
    this.render();
    void action()
      .catch((error) => {
        console.error("Knowledge Base Command Center portability action failed", error);
        new Notice(errorMessage(error), 8000);
      })
      .finally(() => {
        this.busyAction = null;
        if (!this.centerOpen) return;
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
