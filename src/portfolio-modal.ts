import { Modal, Notice, Platform, Setting } from "obsidian";
import type EntVaultCommandCenterPlugin from "./main";
import { calculateModalViewportLayout, localDateStamp, VaultFilePickerModal } from "./modals";
import {
  EMPTY_PORTABLE_SELECTION,
  normalizePortableSelection,
  portableSelectionHasAny,
  type PortableExportSelection,
} from "./portability";
import {
  MAX_PORTFOLIO_BUNDLE_BYTES,
  parsePortfolioExport,
  PORTFOLIO_DIFF_CATEGORIES,
  serializePortfolioExport,
  type PortfolioExportV1,
  type PortfolioImportMapping,
  type PortfolioImportPlan,
  type PortfolioPlanDiff,
} from "./portfolio";

type PortfolioMode = "export" | "import";
type BusyAction = "export" | "file" | "preview" | "apply";
const PORTFOLIO_MODES: readonly PortfolioMode[] = ["export", "import"];
let portfolioModalSequence = 0;

const STATIC_COMPONENTS: ReadonlyArray<{
  key: "workspace" | "index" | "collections" | "study" | "savedViews";
  label: string;
  description: string;
}> = [
  { key: "workspace", label: "Workspace settings", description: "Portable labels, behavior, and destination-checked folder/template settings." },
  { key: "index", label: "Index blueprint", description: "Groups, nested subjects, empty headings, placeholders, and order." },
  { key: "collections", label: "Collections", description: "Collection headings, subheadings, and portable subject membership." },
  { key: "study", label: "Study state", description: "Pins and the Next list." },
  { key: "savedViews", label: "Saved views", description: "Named tabs and literal search queries." },
];

const DIFF_LABELS: Record<keyof PortfolioPlanDiff, string> = {
  basesAdd: "Knowledge bases to add",
  basesReplace: "Knowledge bases with selected components replaced",
  headingsAdd: "Headings to add",
  headingsRename: "Headings to rename",
  headingsRemove: "Headings to remove",
  subjectsAdd: "Subjects to add",
  subjectsMove: "Subjects to move",
  subjectsUnplaced: "Subjects that will be unplaced",
  librariesAdd: "Libraries to add",
  librariesArchive: "Libraries to archive",
  conflicts: "Identity or naming conflicts",
  fallbacks: "Unavailable template or folder fallbacks",
  willNotChange: "Will not change",
};

function cloneSelection(value: PortableExportSelection): PortableExportSelection {
  return normalizePortableSelection({ ...value, libraryIds: [...(value.libraryIds ?? [])] });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class PortfolioTransferModal extends Modal {
  private mode: PortfolioMode = "export";
  private busy: BusyAction | null = null;
  private selectedBaseIds = new Set<string>();
  private exportComponents: Record<(typeof STATIC_COMPONENTS)[number]["key"] | "libraries", boolean> = {
    workspace: true,
    index: true,
    libraries: true,
    collections: true,
    study: true,
    savedViews: true,
  };
  private bundle: PortfolioExportV1 | null = null;
  private sourceLabel = "";
  private enabledSources = new Set<string>();
  private destinationBySource = new Map<string, string>();
  private modeBySource = new Map<string, "merge" | "replace">();
  private selectionBySource = new Map<string, PortableExportSelection>();
  private allowCrossVaultReplace = false;
  private typedConfirmation = "";
  private plan: PortfolioImportPlan | null = null;
  private previewVisible = new Map<keyof PortfolioPlanDiff, number>();
  private panelEl: HTMLElement | null = null;
  private pendingFocusKey: string | null = null;
  private pendingFocusFallbackKey: string | null = null;
  private focusTimer: number | null = null;
  private accessibilityInstanceId = `ent-cc-portfolio-${++portfolioModalSequence}`;
  private viewportWindow: Window | null = null;
  private viewportSyncTimers: number[] = [];

  private readonly syncViewportLayout = (): void => {
    const viewWindow = this.viewportWindow;
    if (!viewWindow) return;
    const viewport = viewWindow.visualViewport;
    const keyboardHeight = Number.parseFloat(
      viewWindow.getComputedStyle(this.modalEl).getPropertyValue("--keyboard-height"),
    );
    const layout = calculateModalViewportLayout(
      viewWindow.innerHeight,
      viewport?.height ?? viewWindow.innerHeight,
      viewport?.offsetTop ?? 0,
      keyboardHeight,
    );
    this.modalEl.style.setProperty("--ent-cc-portfolio-visual-height", `${layout.height}px`);
    this.modalEl.style.setProperty("--ent-cc-portfolio-visual-shift", `${layout.shift}px`);
    this.modalEl.toggleClass("is-virtual-keyboard-open", layout.keyboardOpen);
  };

  private readonly handleViewportFocus = (event: FocusEvent): void => {
    this.scheduleViewportSync();
    const target = event.target as HTMLElement | null;
    const viewWindow = this.viewportWindow;
    if (!viewWindow || !target || typeof target.scrollIntoView !== "function") return;
    this.viewportSyncTimers.push(viewWindow.setTimeout(() => {
      if (this.contentEl.contains(target)) target.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, 80));
  };

  constructor(private readonly plugin: EntVaultCommandCenterPlugin) {
    super(plugin.app);
    for (const entry of plugin.getKnowledgeBases()) this.selectedBaseIds.add(entry.id);
  }

  onOpen(): void {
    this.modalEl.addClass("ent-cc-portfolio-modal");
    this.contentEl.addClass("ent-cc-modal", "ent-cc-portfolio-center");
    this.render();
    this.bindViewportLayout();
  }

  onClose(): void {
    const viewWindow = this.viewportWindow;
    viewWindow?.visualViewport?.removeEventListener("resize", this.syncViewportLayout);
    viewWindow?.visualViewport?.removeEventListener("scroll", this.syncViewportLayout);
    viewWindow?.removeEventListener("resize", this.syncViewportLayout);
    this.contentEl.removeEventListener("focusin", this.handleViewportFocus);
    for (const timer of this.viewportSyncTimers) viewWindow?.clearTimeout(timer);
    this.viewportSyncTimers = [];
    if (this.focusTimer !== null) viewWindow?.clearTimeout(this.focusTimer);
    this.focusTimer = null;
    this.viewportWindow = null;
    this.modalEl.style.removeProperty("--ent-cc-portfolio-visual-height");
    this.modalEl.style.removeProperty("--ent-cc-portfolio-visual-shift");
    this.modalEl.removeClass("is-virtual-keyboard-open");
  }

  private render(): void {
    const scrollTop = this.panelEl?.scrollTop ?? 0;
    this.panelEl = null;
    this.contentEl.empty();
    this.titleEl.setText("Multi-base portfolio transfer");
    this.renderTabs();
    this.renderModePanel();
    this.renderFooter();
    const renderedPanel = this.contentEl.querySelector<HTMLElement>(".ent-cc-portfolio-panel");
    if (renderedPanel) renderedPanel.scrollTop = scrollTop;
    this.contentEl.setAttribute("aria-busy", String(Boolean(this.busy)));
    const close = this.modalEl.querySelector<HTMLButtonElement>(".modal-close-button");
    if (close) {
      close.disabled = Boolean(this.busy);
      close.setAttribute("aria-disabled", String(Boolean(this.busy)));
    }
    this.restorePendingFocus();
  }

  private accessibilityId(): string {
    if (!this.accessibilityInstanceId) this.accessibilityInstanceId = `ent-cc-portfolio-${++portfolioModalSequence}`;
    return this.accessibilityInstanceId;
  }

  private modeTabId(mode: PortfolioMode): string {
    return `${this.accessibilityId()}-tab-${mode}`;
  }

  private modePanelId(mode: PortfolioMode): string {
    return `${this.accessibilityId()}-panel-${mode}`;
  }

  private renderModePanel(): void {
    this.panelEl = this.contentEl.createDiv({
      cls: "ent-cc-portfolio-panel",
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

  private renderParent(): HTMLElement {
    return this.panelEl ?? this.contentEl;
  }

  private renderFooter(): void {
    const footer = this.contentEl.createDiv({ cls: "ent-cc-portfolio-footer" });
    const cancel = footer.createEl("button", {
      cls: "ent-cc-button",
      text: "Cancel",
      attr: {
        type: "button",
        "aria-label": "Cancel and close portfolio transfer",
        "data-portfolio-focus": "close",
        ...(this.busy ? { disabled: "" } : {}),
      },
    });
    cancel.addEventListener("click", () => {
      if (!this.busy) this.close();
    });
  }

  private rerenderFromControl(focusKey: string, fallbackFocusKey = focusKey): void {
    this.pendingFocusKey = focusKey;
    this.pendingFocusFallbackKey = fallbackFocusKey;
    this.render();
  }

  private captureCurrentFocus(): string | null {
    const active = this.contentEl.ownerDocument.activeElement as HTMLElement | null;
    if (!active || typeof active.getAttribute !== "function" || !this.contentEl.contains(active)) return null;
    const focusKey = active.getAttribute("data-portfolio-focus");
    if (!focusKey) return null;
    this.pendingFocusKey = focusKey;
    this.pendingFocusFallbackKey = focusKey;
    return focusKey;
  }

  private restorePendingFocus(): void {
    const focusKey = this.pendingFocusKey;
    const fallbackFocusKey = this.pendingFocusFallbackKey;
    this.pendingFocusKey = null;
    this.pendingFocusFallbackKey = null;
    if (!focusKey) return;
    const viewWindow = this.contentEl.ownerDocument.defaultView;
    if (this.focusTimer !== null) viewWindow?.clearTimeout(this.focusTimer);
    this.focusTimer = null;
    const restore = (): void => {
      this.focusTimer = null;
      const controls = Array.from(this.contentEl.querySelectorAll<HTMLElement>("[data-portfolio-focus]"));
      const target = controls.find((element) => element.getAttribute("data-portfolio-focus") === focusKey)
        ?? controls.find((element) => element.getAttribute("data-portfolio-focus") === fallbackFocusKey);
      target?.focus({ preventScroll: true });
    };
    if (!viewWindow) {
      restore();
      return;
    }
    this.focusTimer = viewWindow.setTimeout(restore, 0);
  }

  private bindViewportLayout(): void {
    const viewWindow = this.contentEl.ownerDocument.defaultView;
    if (!viewWindow) return;
    this.viewportWindow = viewWindow;
    viewWindow.visualViewport?.addEventListener("resize", this.syncViewportLayout);
    viewWindow.visualViewport?.addEventListener("scroll", this.syncViewportLayout);
    viewWindow.addEventListener("resize", this.syncViewportLayout);
    this.contentEl.addEventListener("focusin", this.handleViewportFocus);
    this.scheduleViewportSync();
  }

  private scheduleViewportSync(): void {
    const viewWindow = this.viewportWindow;
    if (!viewWindow) return;
    for (const timer of this.viewportSyncTimers) viewWindow.clearTimeout(timer);
    this.viewportSyncTimers = [0, 60, 180, 420].map((delay) => viewWindow.setTimeout(this.syncViewportLayout, delay));
  }

  private renderTabs(): void {
    const tabs = this.contentEl.createDiv({
      cls: "ent-cc-manager-tabs ent-cc-portfolio-tabs",
      attr: { role: "tablist", "aria-label": "Portfolio export or import" },
    });
    for (const mode of PORTFOLIO_MODES) {
      const active = mode === this.mode;
      const button = tabs.createEl("button", {
        cls: `ent-cc-manager-tab ${active ? "is-active" : ""}`,
        text: mode === "export" ? "Export portfolio" : "Import portfolio",
        attr: {
          id: this.modeTabId(mode),
          type: "button",
          role: "tab",
          "aria-selected": String(active),
          "aria-controls": this.modePanelId(mode),
          tabindex: active ? "0" : "-1",
          "data-portfolio-focus": `mode-${mode}`,
          ...(this.busy ? { disabled: "" } : {}),
        },
      });
      button.addEventListener("click", () => {
        if (this.busy || this.mode === mode) return;
        this.mode = mode;
        this.rerenderFromControl(`mode-${mode}`);
      });
      button.addEventListener("keydown", (event) => {
        if (this.busy) return;
        const index = PORTFOLIO_MODES.indexOf(mode);
        const nextIndex = event.key === "Home" ? 0
          : event.key === "End" ? PORTFOLIO_MODES.length - 1
            : event.key === "ArrowRight" ? (index + 1) % PORTFOLIO_MODES.length
              : event.key === "ArrowLeft" ? (index - 1 + PORTFOLIO_MODES.length) % PORTFOLIO_MODES.length
                : -1;
        if (nextIndex < 0) return;
        const nextMode = PORTFOLIO_MODES[nextIndex];
        if (!nextMode) return;
        event.preventDefault();
        this.mode = nextMode;
        this.rerenderFromControl(`mode-${nextMode}`);
      });
    }
  }

  private renderExport(): void {
    const parent = this.renderParent();
    parent.createEl("p", {
      text: "Bundle selected knowledge bases as independent, ordinary portable packages. Note bodies, attachments, and exact note paths are excluded.",
    });
    parent.createEl("h3", { text: "Knowledge bases" });
    for (const entry of this.plugin.getKnowledgeBases()) {
      const baseSetting = new Setting(parent)
        .setName(entry.data.settings.workspaceName)
        .setDesc(entry.data.settings.workspaceMode === "ent-clinical" ? "ENT clinical preset" : "Generic preset")
        .addToggle((toggle) => toggle
          .setValue(this.selectedBaseIds.has(entry.id))
          .setDisabled(Boolean(this.busy))
          .onChange((enabled) => {
            if (enabled) this.selectedBaseIds.add(entry.id);
            else this.selectedBaseIds.delete(entry.id);
          }));
      baseSetting.nameEl.setAttribute("dir", "auto");
    }
    parent.createEl("h3", { text: "Components in each selected base" });
    for (const component of STATIC_COMPONENTS) {
      new Setting(parent)
        .setName(component.label)
        .setDesc(component.description)
        .addToggle((toggle) => toggle
          .setValue(this.exportComponents[component.key])
          .setDisabled(Boolean(this.busy))
          .onChange((enabled) => { this.exportComponents[component.key] = enabled; }));
    }
    new Setting(parent)
      .setName("Libraries")
      .setDesc("Every active library in each selected base, including empty libraries and empty headings.")
      .addToggle((toggle) => toggle
        .setValue(this.exportComponents.libraries)
        .setDisabled(Boolean(this.busy))
        .onChange((enabled) => { this.exportComponents.libraries = enabled; }));
    const actions = new Setting(parent).setName("Create portfolio JSON");
    actions.setDesc(`${this.selectedBaseIds.size} knowledge base${this.selectedBaseIds.size === 1 ? "" : "s"} selected. The aggregate import limit is 50 bases and 32 MB.`);
    actions.addButton((button) => button
      .setCta()
      .setButtonText(this.busy === "export" ? "Exporting…" : "Export portfolio")
      .setDisabled(Boolean(this.busy))
      .onClick(() => this.run("export", () => this.exportPortfolio())));
    const submit = actions.controlEl.querySelector<HTMLButtonElement>("button");
    submit?.setAttribute("data-portfolio-focus", "export-submit");
  }

  private exportSelectionForBase(baseId: string): PortableExportSelection {
    const entry = this.plugin.getKnowledgeBases().find((candidate) => candidate.id === baseId);
    return normalizePortableSelection({
      ...EMPTY_PORTABLE_SELECTION,
      workspace: this.exportComponents.workspace,
      index: this.exportComponents.index,
      libraryIds: this.exportComponents.libraries
        ? entry?.data.portableIndex.libraries.filter((library) => library.archivedAt === null).map((library) => library.id) ?? []
        : [],
      collections: this.exportComponents.collections,
      study: this.exportComponents.study,
      savedViews: this.exportComponents.savedViews,
      recovery: false,
    });
  }

  private async exportPortfolio(): Promise<void> {
    const baseIds = [...this.selectedBaseIds];
    if (baseIds.length === 0) throw new Error("Choose at least one knowledge base.");
    const requests = baseIds.map((baseId) => ({
      baseId,
      selection: this.exportSelectionForBase(baseId),
      completeLibrarySet: this.exportComponents.libraries,
    }));
    if (requests.some((request) => !portableSelectionHasAny(request.selection))) {
      throw new Error("Choose at least one component for the portfolio.");
    }
    const now = new Date();
    const bundle = this.plugin.createPortfolioExport(requests, now.toISOString());
    const serialized = serializePortfolioExport(bundle);
    if (Platform.isMobile) {
      const file = await this.plugin.writePortableJson("portfolio", bundle);
      new Notice(`Saved the ${bundle.manifest.baseCount}-base portfolio at ${file.path}. Note bodies and attachments were not included.`, 9000);
      this.close();
      return;
    }
    const viewWindow = this.contentEl.ownerDocument.defaultView ?? window;
    const url = viewWindow.URL.createObjectURL(new Blob([serialized], { type: "application/json" }));
    const link = createEl("a");
    link.href = url;
    link.download = `knowledge-base-command-center-portfolio-${localDateStamp(now)}.json`;
    link.click();
    viewWindow.setTimeout(() => viewWindow.URL.revokeObjectURL(url), 1000);
    new Notice(`Exported ${bundle.manifest.baseCount} independent portable packages. Note bodies and attachments were not included.`);
    this.close();
  }

  private renderImport(): void {
    const parent = this.renderParent();
    parent.createEl("p", {
      text: "Choose a portfolio, map each source to a new or existing destination, select components, then build the exact dry-run plan before applying anything.",
    });
    const fileSetting = new Setting(parent)
      .setName("Portfolio JSON")
      .setDesc(this.bundle ? `${this.sourceLabel || "Selected file"} · ${this.bundle.manifest.baseCount} source bases` : "No portfolio selected.")
      .addButton((button) => button
        .setButtonText(this.busy === "file" ? "Reading…" : "Choose file")
        .setDisabled(Boolean(this.busy))
        .onClick(() => this.chooseFile()));
    fileSetting.controlEl.querySelector("button")?.setAttribute("data-portfolio-focus", "import-file");
    if (!this.bundle) return;
    const crossVault = this.bundle.sourceVaultId !== this.plugin.getVaultId();
    const destinationEntries = this.plugin.getKnowledgeBases();
    parent.createEl("h3", { text: "Source → destination mapping" });
    for (const manifest of this.bundle.manifest.entries) {
      const enabled = this.enabledSources.has(manifest.sourceBaseId);
      const card = parent.createDiv({ cls: "ent-cc-portfolio-map-card" });
      const sourceSetting = new Setting(card)
        .setName(manifest.sourceBaseName)
        .setDesc(`${manifest.sourceWorkspaceMode === "ent-clinical" ? "ENT clinical" : "Generic"} · ${manifest.subjects} subjects · ${manifest.packageBytes.toLocaleString()} bytes`)
        .addToggle((toggle) => {
          toggle.toggleEl.setAttribute("data-portfolio-focus", `source-${manifest.sourceBaseId}`);
          toggle.setValue(enabled)
            .setDisabled(Boolean(this.busy))
            .onChange((next) => {
              if (next) this.enabledSources.add(manifest.sourceBaseId);
              else this.enabledSources.delete(manifest.sourceBaseId);
              this.invalidatePlan();
              this.rerenderFromControl(`source-${manifest.sourceBaseId}`);
            });
        });
      sourceSetting.nameEl.setAttribute("dir", "auto");
      if (!enabled) continue;
      const destination = this.destinationBySource.get(manifest.sourceBaseId) ?? "new";
      new Setting(card)
        .setName("Destination")
        .setDesc("Create a new base or choose one matching the source preset.")
        .addDropdown((dropdown) => {
          dropdown.addOption("new", `Create new: ${manifest.sourceBaseName}`);
          for (const entry of destinationEntries.filter((candidate) => candidate.data.settings.workspaceMode === manifest.sourceWorkspaceMode)) {
            dropdown.addOption(entry.id, `Existing: ${entry.data.settings.workspaceName}`);
          }
          dropdown.setValue(destination).setDisabled(Boolean(this.busy)).onChange((value) => {
            this.destinationBySource.set(manifest.sourceBaseId, value);
            this.invalidatePlan();
            this.rerenderFromControl(`destination-${manifest.sourceBaseId}`);
          });
          dropdown.selectEl.setAttribute("data-portfolio-focus", `destination-${manifest.sourceBaseId}`);
          dropdown.selectEl.setAttribute("dir", "auto");
        });
      if (destination !== "new") {
        new Setting(card)
          .setName("Per-base mode")
          .setDesc("Merge keeps unselected/local organization. Replace resets only selected components.")
          .addDropdown((dropdown) => {
            dropdown.selectEl.setAttribute("data-portfolio-focus", `mapping-mode-${manifest.sourceBaseId}`);
            dropdown.addOption("merge", "Merge")
              .addOption("replace", "Replace selected components")
              .setValue(this.modeBySource.get(manifest.sourceBaseId) ?? "merge")
              .setDisabled(Boolean(this.busy))
              .onChange((value) => {
                this.modeBySource.set(manifest.sourceBaseId, value === "replace" ? "replace" : "merge");
                this.invalidatePlan();
                this.rerenderFromControl(`mapping-mode-${manifest.sourceBaseId}`);
              });
          });
      }
      this.renderImportComponents(card, manifest.sourceBaseId, manifest.selection);
    }
    if (crossVault && this.hasExistingReplace()) {
      const warning = parent.createDiv({ cls: "ent-cc-manager-diagnostic", attr: { role: "alert" } });
      warning.createEl("strong", { text: "Cross-vault replacement gate" });
      warning.createEl("p", { text: "Portable merge and new-base import are allowed across vaults. Replacing selected components in an existing base requires this separate acknowledgement." });
      new Setting(warning)
        .setName("Allow cross-vault replace")
        .addToggle((toggle) => {
          toggle.toggleEl.setAttribute("data-portfolio-focus", "cross-vault-ack");
          toggle.setValue(this.allowCrossVaultReplace)
            .setDisabled(Boolean(this.busy))
            .onChange((enabled) => {
              this.allowCrossVaultReplace = enabled;
              this.invalidatePlan();
              this.rerenderFromControl("cross-vault-ack");
            });
        });
    }
    const previewSetting = new Setting(parent)
      .setName("Exact dry-run plan")
      .setDesc("The resulting post-state is computed once. Apply commits this exact plan; it does not rerun import matching.")
      .addButton((button) => button
        .setCta()
        .setButtonText(this.busy === "preview" ? "Planning…" : "Build exact preview")
        .setDisabled(Boolean(this.busy) || this.enabledSources.size === 0)
        .onClick(() => this.run("preview", () => this.buildPreview())));
    previewSetting.controlEl.querySelector("button")?.setAttribute("data-portfolio-focus", "build-preview");
    if (this.plan) this.renderPlan(this.plan);
  }

  private renderImportComponents(parent: HTMLElement, sourceBaseId: string, available: PortableExportSelection): void {
    const details = parent.createEl("details", { cls: "ent-cc-portfolio-components" });
    details.createEl("summary", { text: "Components from this source" });
    const selected = cloneSelection(this.selectionBySource.get(sourceBaseId) ?? available);
    for (const component of STATIC_COMPONENTS) {
      const isAvailable = normalizePortableSelection(available)[component.key];
      if (!isAvailable) continue;
      new Setting(details)
        .setName(component.label)
        .addToggle((toggle) => toggle
          .setValue(normalizePortableSelection(selected)[component.key])
          .setDisabled(Boolean(this.busy))
          .onChange((enabled) => {
            const current = cloneSelection(this.selectionBySource.get(sourceBaseId) ?? available);
            this.selectionBySource.set(sourceBaseId, cloneSelection({ ...current, [component.key]: enabled }));
            this.invalidatePlan();
          }));
    }
    const availableLibraries = normalizePortableSelection(available).libraryIds;
    if (availableLibraries.length > 0) {
      const definitions = new Map(this.bundle?.packages.find((item) => item.sourceBaseId === sourceBaseId)?.package.components.index?.libraries
        ?.map((library) => [library.id, library.name]) ?? []);
      for (const libraryId of availableLibraries) {
        new Setting(details)
          .setName(`Library: ${definitions.get(libraryId) ?? libraryId}`)
          .addToggle((toggle) => toggle
            .setValue(normalizePortableSelection(selected).libraryIds.includes(libraryId))
            .setDisabled(Boolean(this.busy))
            .onChange((enabled) => {
              const current = cloneSelection(this.selectionBySource.get(sourceBaseId) ?? available);
              const ids = new Set(normalizePortableSelection(current).libraryIds);
              if (enabled) ids.add(libraryId);
              else ids.delete(libraryId);
              this.selectionBySource.set(sourceBaseId, cloneSelection({
                ...current,
                libraryIds: [...ids],
                procedures: false,
                medications: false,
                syndromes: false,
              }));
              this.invalidatePlan();
            }));
      }
    }
  }

  private mappings(): PortfolioImportMapping[] {
    if (!this.bundle) return [];
    return this.bundle.manifest.entries
      .filter((manifest) => this.enabledSources.has(manifest.sourceBaseId))
      .map((manifest) => {
        const destination = this.destinationBySource.get(manifest.sourceBaseId) ?? "new";
        return {
          sourceBaseId: manifest.sourceBaseId,
          destination: destination === "new"
            ? { kind: "new" as const, name: manifest.sourceBaseName }
            : { kind: "existing" as const, baseId: destination },
          mode: destination === "new" ? "merge" as const : this.modeBySource.get(manifest.sourceBaseId) ?? "merge",
          selection: cloneSelection(this.selectionBySource.get(manifest.sourceBaseId) ?? manifest.selection),
        };
      });
  }

  private hasExistingReplace(): boolean {
    return this.mappings().some((mapping) => mapping.destination.kind === "existing" && mapping.mode === "replace");
  }

  private buildPreview(): void {
    if (!this.bundle) throw new Error("Choose a portfolio first.");
    this.plan = this.plugin.createPortfolioImportPlan(this.bundle, this.mappings(), this.allowCrossVaultReplace);
    this.previewVisible.clear();
    this.typedConfirmation = "";
    this.render();
  }

  private renderPlan(plan: PortfolioImportPlan): void {
    const previewItemCount = PORTFOLIO_DIFF_CATEGORIES.reduce(
      (total, category) => total + plan.diff[category].length,
      0,
    );
    this.renderParent().createDiv({
      cls: "ent-cc-portfolio-preview-status",
      text: `Exact preview ready. ${plan.operations.length} mapped source${plan.operations.length === 1 ? "" : "s"}; ${previewItemCount} summarized change item${previewItemCount === 1 ? "" : "s"}.`,
      attr: { role: "status", "aria-live": "polite", "aria-atomic": "true" },
    });
    // Keep the rich, potentially 50-row-per-section preview outside the live
    // region. Screen readers receive the concise status above once, then can
    // browse the headings and lists at their own pace.
    const preview = this.renderParent().createDiv({ cls: "ent-cc-portfolio-preview" });
    preview.createEl("h3", { text: "Exact change preview" });
    preview.createEl("p", {
      text: `${plan.operations.length} mapped source${plan.operations.length === 1 ? "" : "s"}. ${plan.recoveryPackages.length} Replace recovery export${plan.recoveryPackages.length === 1 ? "" : "s"} will be written before the atomic store mutation.`,
    });
    for (const category of PORTFOLIO_DIFF_CATEGORIES) {
      const items = plan.diff[category];
      const sectionFocusKey = `diff-section-${category}`;
      const section = preview.createEl("section", {
        cls: "ent-cc-portfolio-diff-section",
        attr: { tabindex: "-1", "data-portfolio-focus": sectionFocusKey },
      });
      section.createEl("h4", { text: `${DIFF_LABELS[category]} (${items.length})` });
      if (items.length === 0) {
        section.createEl("p", { text: "None." });
        continue;
      }
      const visible = Math.min(items.length, this.previewVisible.get(category) ?? 50);
      const list = section.createEl("ul");
      for (const item of items.slice(0, visible)) list.createEl("li", { text: item, attr: { dir: "auto" } });
      if (visible < items.length) {
        const more = section.createEl("button", {
          text: `Show ${Math.min(50, items.length - visible)} more of ${items.length}`,
          attr: {
            type: "button",
            "data-portfolio-focus": `diff-more-${category}`,
            ...(this.busy ? { disabled: "" } : {}),
          },
        });
        more.addEventListener("click", () => {
          this.previewVisible.set(category, visible + 50);
          this.rerenderFromControl(`diff-more-${category}`, sectionFocusKey);
        });
      }
    }
    if (plan.confirmationPhrase) {
      new Setting(preview)
        .setName("Typed replace confirmation")
        .setDesc(`Type ${plan.confirmationPhrase} exactly. Automatic same-vault recovery packages are mandatory and cannot be skipped.`)
        .addText((text) => {
          text.setPlaceholder(plan.confirmationPhrase)
            .setValue(this.typedConfirmation)
            .setDisabled(Boolean(this.busy))
            .onChange((value) => {
              this.typedConfirmation = value;
              const apply = preview.querySelector<HTMLButtonElement>("[data-portfolio-apply]");
              if (apply) apply.disabled = value !== plan.confirmationPhrase || Boolean(this.busy);
            });
          text.inputEl.setAttribute("autocomplete", "off");
          text.inputEl.setAttribute("autocapitalize", "characters");
          text.inputEl.setAttribute("data-portfolio-focus", "typed-confirmation");
        });
    }
    new Setting(preview)
      .setName("Apply this exact plan")
      .setDesc("Stale base, store, or sync generations abort before mutation. A save failure rolls the complete store transaction back.")
      .addButton((button) => {
        button.buttonEl.setAttribute("data-portfolio-apply", "true");
        button.buttonEl.setAttribute("data-portfolio-focus", "apply-plan");
        button.setCta()
          .setButtonText(this.busy === "apply" ? "Applying…" : "Apply exact plan")
          .setDisabled(Boolean(this.busy) || Boolean(plan.confirmationPhrase && this.typedConfirmation !== plan.confirmationPhrase))
          .onClick(() => this.run("apply", () => this.applyPlan()));
      });
  }

  private async applyPlan(): Promise<void> {
    const plan = this.plan;
    if (!plan) throw new Error("Build the exact preview again before applying.");
    const recoveryPaths = await this.plugin.applyPortfolioImportPlan(plan, this.typedConfirmation);
    const recoveryText = recoveryPaths.length > 0
      ? ` Recovery exports were saved first at ${recoveryPaths.join(", ")}.`
      : "";
    new Notice(`Portfolio import complete.${recoveryText} Markdown notes and attachments were not changed.`, 12000);
    this.close();
  }

  private chooseFile(): void {
    if (this.busy) return;
    if (Platform.isMobile) {
      const files = this.plugin.getPortableJsonFiles();
      if (files.length === 0) {
        new Notice("No JSON files were found in the vault. Copy a portfolio JSON into the vault, then try again.");
        return;
      }
      new VaultFilePickerModal(this.app, files, "Choose a Command Center portfolio JSON", (file) => {
        this.run("file", async () => this.setBundle(parsePortfolioExport(await this.plugin.readPortfolioJson(file)), file.path));
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
        if (file.size > MAX_PORTFOLIO_BUNDLE_BYTES) throw new Error("The selected portfolio is larger than the 32 MB import limit.");
        this.setBundle(parsePortfolioExport(JSON.parse(await file.text()) as unknown), file.name);
      });
    });
    input.click();
  }

  private setBundle(bundle: PortfolioExportV1, label: string): void {
    this.bundle = bundle;
    this.sourceLabel = label;
    this.enabledSources = new Set(bundle.manifest.entries.map((entry) => entry.sourceBaseId));
    this.destinationBySource.clear();
    this.modeBySource.clear();
    this.selectionBySource.clear();
    for (const manifest of bundle.manifest.entries) {
      const sameId = this.plugin.getKnowledgeBases().find((entry) => entry.id === manifest.sourceBaseId
        && entry.data.settings.workspaceMode === manifest.sourceWorkspaceMode);
      this.destinationBySource.set(manifest.sourceBaseId, sameId?.id ?? "new");
      this.modeBySource.set(manifest.sourceBaseId, "merge");
      this.selectionBySource.set(manifest.sourceBaseId, cloneSelection(manifest.selection));
    }
    this.allowCrossVaultReplace = false;
    this.invalidatePlan();
    this.render();
  }

  private invalidatePlan(): void {
    this.plan = null;
    this.typedConfirmation = "";
    this.previewVisible.clear();
  }

  private run(action: BusyAction, callback: () => void | Promise<void>): void {
    if (this.busy) return;
    const actionFocusKey = this.captureCurrentFocus();
    this.busy = action;
    this.render();
    void Promise.resolve()
      .then(callback)
      .catch((error) => new Notice(errorMessage(error), 10000))
      .finally(() => {
        this.busy = null;
        if (this.contentEl.isConnected) {
          if (actionFocusKey) {
            this.pendingFocusKey = actionFocusKey;
            this.pendingFocusFallbackKey = actionFocusKey;
          }
          this.render();
        }
      });
  }
}
