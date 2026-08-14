import { Menu, Modal, Notice, Setting, TFile, TFolder, setIcon } from "obsidian";
import type EntVaultCommandCenterPlugin from "./main";
import {
  curriculumContainerKey,
  errorMessage,
  INDEX_FOLDER_VAULT_ROOT,
  IndexDiagnostic,
  isSafeObjectKey,
  isPortablePlaceholderPath,
  normalizeSearchText,
  pathIsInIndexFolderSources,
  resetCurriculumVisualPath,
  VaultRecord,
} from "./model";
import { linkedSourceLabel } from "./membership-explanation";
import {
  clearGuardedTimer,
  ConfirmModal,
  createOpenedBaseGuard,
  type OpenedBaseGuard,
  IndexGroupModal,
  modalOwnerWindow,
  setGuardedTimer,
  StringPickerModal,
  TextPromptModal,
} from "./modals";
import { registerPortableGroup, removePortableGroup, renameOrMergePortableGroup } from "./portability";
import { ExportImportCenterModal } from "./portability-modal";
import { TaxonomyHealthModal } from "./taxonomy-health-modal";
import { SyncRecoveryCenterModal } from "./sync-recovery-modal";

export type ManagerTab = "indexed" | "available" | "hidden" | "sources" | "groups" | "diagnostics";

type NoteListTab = Extract<ManagerTab, "indexed" | "available" | "hidden">;

interface ManagerNote {
  path: string;
  title: string;
  meta: string;
}

let nextIndexManagerInstanceId = 0;
const INDEX_MANAGER_PAGE_SIZE = 300;

export class IndexManagerModal extends Modal {
  private readonly instanceId = ++nextIndexManagerInstanceId;
  private tab: ManagerTab = "indexed";
  private query = "";
  private selected = new Set<string>();
  private diagnosticsCache: IndexDiagnostic[] | null = null;
  private searchTimer: number | null = null;
  private selectionCountEl: HTMLElement | null = null;
  private selectionActionsEl: HTMLElement | null = null;
  private selectionButtons: Array<{ el: HTMLButtonElement; enabled: () => boolean }> = [];
  private managerOpen = false;
  private openedBaseId = "";
  private openedDataEpoch = 0;
  private ownsBase: OpenedBaseGuard | null = null;
  private pendingTimers = new Set<number>();
  private visibleRowLimits = { diagnostics: INDEX_MANAGER_PAGE_SIZE, groups: INDEX_MANAGER_PAGE_SIZE };
  /**
   * Vault-derived note lists are memoized for the lifetime of one rendered
   * snapshot. Search re-renders on a 150 ms debounce, and recomputing
   * `availableNotes()` there means a full `getMarkdownFiles()` scan, two
   * filters, and a locale sort on every keystroke.
   */
  private noteListCache = new Map<NoteListTab, ManagerNote[]>();

  constructor(private readonly plugin: EntVaultCommandCenterPlugin, initialTab: ManagerTab = "indexed") {
    super(plugin.app);
    this.tab = initialTab;
  }

  onOpen(): void {
    this.openedBaseId = this.plugin.getActiveKnowledgeBaseId();
    this.openedDataEpoch = this.plugin.getDataEpoch();
    this.ownsBase = this.createBaseGuard();
    this.invalidateNoteLists();
    this.visibleRowLimits = { diagnostics: INDEX_MANAGER_PAGE_SIZE, groups: INDEX_MANAGER_PAGE_SIZE };
    this.managerOpen = true;
    this.modalEl.addClass("ent-cc-index-manager-modal");
    this.contentEl.addClass("ent-cc-modal", "ent-cc-index-manager");
    this.titleEl.setText(`Manage ${this.plugin.data.settings.indexLabel}`);
    this.render();
  }

  onClose(): void {
    this.managerOpen = false;
    const viewWindow = modalOwnerWindow(this.contentEl);
    for (const timer of this.pendingTimers) viewWindow.clearTimeout(timer);
    this.pendingTimers.clear();
    this.searchTimer = null;
    this.selectionCountEl = null;
    this.selectionActionsEl = null;
    this.selectionButtons = [];
    this.invalidateNoteLists();
  }

  private openPortabilityCenter(mode: "export" | "import"): void {
    if (!this.guardOpenedBase()) return;
    new ExportImportCenterModal(this.plugin, mode, (dataChanged) => this.refreshAfterPortability(dataChanged)).open();
  }

  private refreshAfterPortability(dataChanged: boolean): void {
    if (!dataChanged || !this.managerOpen) return;
    if (!this.guardOpenedBase()) return;
    if (this.searchTimer !== null) this.clearTimer(this.searchTimer);
    this.searchTimer = null;
    this.query = "";
    this.selected.clear();
    this.diagnosticsCache = null;
    this.invalidateNoteLists();
    if (this.plugin.isClinicalMode() && this.tab === "available") this.tab = "indexed";
    this.titleEl.setText(`Manage ${this.plugin.data.settings.indexLabel}`);
    this.render();
  }

  /**
   * Drop memoized note lists. Vault files can appear or disappear without any
   * plugin data epoch change, so every deliberate refresh — tab switch,
   * mutation, portability round trip — re-reads the vault; only the search
   * debounce reuses the snapshot it is filtering.
   */
  private invalidateNoteLists(): void {
    this.noteListCache?.clear();
    this.noteListCache ??= new Map<NoteListTab, ManagerNote[]>();
  }

  private noteList(tab: NoteListTab): ManagerNote[] {
    const cached = this.noteListCache?.get(tab);
    if (cached) return cached;
    const computed = tab === "indexed"
      ? this.indexedNotes()
      : tab === "available" ? this.availableNotes() : this.hiddenNotes();
    (this.noteListCache ??= new Map<NoteListTab, ManagerNote[]>()).set(tab, computed);
    return computed;
  }

  private tabElementId(tab: ManagerTab): string {
    return `ent-cc-index-manager-${this.instanceId}-tab-${tab}`;
  }

  private panelElementId(tab: ManagerTab): string {
    return `ent-cc-index-manager-${this.instanceId}-panel-${tab}`;
  }

  private switchTab(tab: ManagerTab, focusTab = false): void {
    this.tab = tab;
    this.query = "";
    this.selected.clear();
    this.render();
    if (focusTab) {
      this.contentEl.querySelector<HTMLElement>(`[data-manager-tab="${tab}"]`)?.focus();
    }
  }

  /** Re-read the vault, then paint. Every caller except the search debounce. */
  private render(): void {
    this.invalidateNoteLists();
    // In-modal mutations change diagnostics inputs without bumping the data
    // epoch, so no guard forces a recompute; dropping the cache on every
    // deliberate refresh keeps the Diagnostics tab honest. Recomputation stays
    // lazy: renderSnapshot only rebuilds diagnostics while that tab paints,
    // and the search debounce bypasses this method entirely.
    this.diagnosticsCache = null;
    this.renderSnapshot();
  }

  /** Paint from the memoized lists; used where only the query or selection moved. */
  private renderSnapshot(): void {
    if (!this.guardOpenedBase()) return;
    // Do not retain controls detached by contentEl.empty(); selection refreshes
    // must address only the currently rendered toolbar.
    this.selectionCountEl = null;
    this.selectionActionsEl = null;
    this.selectionButtons = [];
    this.contentEl.empty();
    const settings = this.plugin.data.settings;
    const groups = this.plugin.getIndexGroups();
    const diagnostics = this.tab === "diagnostics"
      ? (this.diagnosticsCache ??= this.plugin.getIndexDiagnostics())
      : (this.diagnosticsCache ?? []);

    const header = this.contentEl.createDiv({ cls: "ent-cc-manager-header" });
    header.createEl("p", { text: `Manage membership, ${settings.groupLabel.toLowerCase()}s, and integrity without moving or rewriting Markdown notes.` });
    const portability = header.createDiv({ cls: "ent-cc-manager-portability" });
    this.actionButton(portability, "download", "Export…", () => this.openPortabilityCenter("export"));
    this.actionButton(portability, "upload", "Import…", () => this.openPortabilityCenter("import"));

    const tabs = this.contentEl.createDiv({
      cls: "ent-cc-manager-tabs",
      attr: { role: "tablist", "aria-label": "Index manager sections" },
    });
    // Inactive note badges stay lazy. Rendering one tab must not enumerate the
    // vault and build all three full note projections merely to show counts.
    const noteCount = (tab: NoteListTab): number | string => this.tab === tab
      ? this.noteList(tab).length
      : this.noteListCache.get(tab)?.length ?? "—";
    const definitions: Array<{ id: ManagerTab; label: string; count: () => number | string; genericOnly?: boolean }> = [
      { id: "indexed", label: "Indexed", count: () => noteCount("indexed") },
      { id: "available", label: "Available", count: () => noteCount("available"), genericOnly: true },
      { id: "hidden", label: "Hidden", count: () => noteCount("hidden") },
      {
        id: "sources",
        label: "Why included",
        count: () => this.tab === "sources" ? this.plugin.getIndexRecords().length : "—",
      },
      { id: "groups", label: "Index headings", count: () => groups.length },
      { id: "diagnostics", label: "Diagnostics", count: () => this.diagnosticsCache?.length ?? "—" },
    ];
    const visibleDefinitions = definitions.filter((item) => !item.genericOnly || !this.plugin.isClinicalMode());
    if (!visibleDefinitions.some((definition) => definition.id === this.tab)) this.tab = "indexed";
    for (const definition of visibleDefinitions) {
      const active = this.tab === definition.id;
      const button = tabs.createEl("button", {
        cls: `ent-cc-manager-tab ${active ? "is-active" : ""}`,
        attr: {
          id: this.tabElementId(definition.id),
          type: "button",
          role: "tab",
          "aria-controls": this.panelElementId(definition.id),
          "aria-selected": String(active),
          tabindex: active ? "0" : "-1",
          "data-manager-tab": definition.id,
        },
      });
      button.createSpan({ text: definition.label });
      button.createSpan({ cls: "ent-cc-manager-tab-count", text: String(definition.count()) });
      button.addEventListener("click", () => this.switchTab(definition.id, true));
      button.addEventListener("keydown", (event) => {
        const index = visibleDefinitions.findIndex((candidate) => candidate.id === definition.id);
        let nextIndex: number | null = null;
        if (event.key === "Home") nextIndex = 0;
        else if (event.key === "End") nextIndex = visibleDefinitions.length - 1;
        else if (event.key === "ArrowRight") nextIndex = (index + 1) % visibleDefinitions.length;
        else if (event.key === "ArrowLeft") nextIndex = (index - 1 + visibleDefinitions.length) % visibleDefinitions.length;
        if (nextIndex === null) return;
        event.preventDefault();
        const next = visibleDefinitions[nextIndex];
        if (next) this.switchTab(next.id, true);
      });
    }
    this.revealActiveTab(tabs);

    const panels = new Map<ManagerTab, HTMLElement>();
    for (const definition of visibleDefinitions) {
      const active = this.tab === definition.id;
      const panel = this.contentEl.createDiv({
        cls: "ent-cc-manager-panel",
        attr: {
          id: this.panelElementId(definition.id),
          role: "tabpanel",
          "aria-labelledby": this.tabElementId(definition.id),
          tabindex: active ? "0" : "-1",
          ...(active ? {} : { hidden: "" }),
        },
      });
      panel.hidden = !active;
      panels.set(definition.id, panel);
    }
    const activePanel = panels.get(this.tab);
    if (!activePanel) return;

    if (this.tab === "indexed" || this.tab === "available" || this.tab === "hidden") {
      this.renderNoteManager(this.noteList(this.tab), () => this.noteList("available").length, activePanel);
    } else if (this.tab === "sources") {
      this.renderSourceSummary(activePanel);
    } else if (this.tab === "groups") {
      this.renderGroups(groups, activePanel);
    } else {
      this.renderDiagnostics(diagnostics, activePanel);
    }

    new Setting(this.contentEl).addButton((button) => button.setButtonText("Close").onClick(() => this.close())).settingEl.addClass("ent-cc-manager-footer");
  }

  private indexedNotes(): ManagerNote[] {
    const directPaths = new Set([
      ...(this.plugin.data.directIndexPaths ?? []),
      ...(this.plugin.data.manualIndexPaths ?? []),
    ]);
    return this.plugin.getIndexRecords().map((record) => ({
      path: record.path,
      title: record.title,
      meta: [
        record.domain,
        directPaths.has(record.path)
          ? "direct membership"
          : pathIsInIndexFolderSources(record.path, this.plugin.data.indexFolderSources ?? [])
            ? "linked folder"
            : this.plugin.isClinicalMode()
              ? "protected clinical source"
              : "portable membership",
        record.path,
      ].join(" · "),
    }));
  }

  private availableNotes(): ManagerNote[] {
    if (this.plugin.isClinicalMode()) return [];
    const hidden = new Set(this.plugin.data.excludedIndexPaths);
    const libraryPaths = new Set(this.plugin.getRecords()
      .filter((record) => Boolean(record.libraryId))
      .map((record) => record.path));
    const vaultNotes = this.plugin.getIndexCandidateFiles()
      .filter((file) => !hidden.has(file.path) && !libraryPaths.has(file.path))
      .map((file) => ({
        path: file.path,
        title: file.basename,
        meta: pathIsInIndexFolderSources(file.path, this.plugin.data.indexFolderSources ?? [])
          ? `linked-folder member · add direct membership · ${file.path}`
          : file.path,
      }));
    const portablePlaceholders = this.plugin.getRecords()
      .filter((record) => record.role === "placeholder"
        && record.portableIndexed === false
        && !record.libraryId
        && isPortablePlaceholderPath(record.path)
        && !hidden.has(record.path))
      .map((record) => ({
        path: record.path,
        title: record.title,
        meta: `${record.domain} · imported subject without a note`,
      }));
    return [...portablePlaceholders, ...vaultNotes];
  }

  private hiddenNotes(): ManagerNote[] {
    const excluded = new Set(this.plugin.data.excludedIndexPaths);
    const records = this.plugin.getRecords();
    const libraryPaths = new Set(records
      .filter((record) => Boolean(record.libraryId))
      .map((record) => record.path));
    const hidden = this.plugin.data.excludedIndexPaths.filter((path) => !libraryPaths.has(path)).map((path) => {
      const file = this.app.vault.getAbstractFileByPath(path);
      const fallbackTitle = file instanceof TFile ? file.basename : path.split("/").pop()?.replace(/\.md$/, "") || path;
      return {
        path,
        title: this.plugin.data.displayNameByPath[path] || fallbackTitle,
        meta: file instanceof TFile ? path : `${path} · missing`,
      };
    });
    if (!this.plugin.isClinicalMode()) return hidden;
    const placeholders = records
      .filter((record) => record.role === "placeholder"
        && record.portableIndexed === false
        && !record.libraryId
        && isPortablePlaceholderPath(record.path)
        && !excluded.has(record.path))
      .map((record) => ({
        path: record.path,
        title: record.title,
        meta: `${record.domain} · imported subject removed from this knowledge base`,
      }));
    return [...hidden, ...placeholders];
  }

  private renderSourceSummary(parent: HTMLElement): void {
    const records = this.plugin.getRecords();
    const indexed = this.plugin.getIndexRecords();
    const direct = new Set([
      ...(this.plugin.data.directIndexPaths ?? []),
      ...(this.plugin.data.manualIndexPaths ?? []),
    ]);
    const realDirect = indexed.filter((record) => !record.isPlaceholder && direct.has(record.path));
    const placeholders = indexed.filter((record) => record.isPlaceholder || isPortablePlaceholderPath(record.path));
    const protectedCount = this.plugin.isClinicalMode()
      ? indexed.filter((record) => !record.isPlaceholder && !direct.has(record.path)).length
      : 0;

    const rule = parent.createDiv({ cls: "ent-cc-manager-diagnostic" });
    rule.createEl("strong", { text: "Index membership is explicit" });
    rule.createEl("p", {
      text: this.plugin.isClinicalMode()
        ? `A note appears through the protected clinical source, direct membership, or an imported placeholder. Storage folders do not grant membership.`
        : `A note appears only through direct membership, one of the exact linked folders below, or an imported placeholder. Its storage folder alone does not grant membership.`,
    });

    const totals = parent.createDiv({ cls: "ent-cc-manager-list ent-cc-manager-sources" });
    const addSummary = (title: string, count: number, detail: string): void => {
      const row = totals.createDiv({ cls: "ent-cc-manager-note" });
      const text = row.createDiv({ cls: "ent-cc-manager-note-text" });
      text.createDiv({ cls: "ent-cc-manager-note-title", text: title });
      text.createDiv({ cls: "ent-cc-picker-meta", text: `${count} · ${detail}` });
    };
    addSummary("Direct memberships", realDirect.length, "Kept until you explicitly remove them, even after unlinking a folder.");
    addSummary("Imported placeholders", placeholders.length, "Blueprint subjects with no linked Markdown note yet.");
    if (this.plugin.isClinicalMode()) {
      addSummary("Protected clinical source", protectedCount, "Derived from the ENT clinical safety model, not from linked folders.");
    }
    addSummary("Hidden overrides", this.plugin.data.excludedIndexPaths.length, "Explicit exclusions from this knowledge base; Markdown files remain untouched.");

    const heading = parent.createEl("h3", { text: "Linked index folders" });
    heading.addClass("ent-cc-manager-section-title");
    if (this.plugin.data.indexFolderSources.length === 0) {
      parent.createDiv({ cls: "ent-cc-empty", text: "No folder supplies Index membership. Moving or creating a note in a storage folder will not add it." });
    }
    for (const source of this.plugin.data.indexFolderSources) {
      const members = records.filter((record) => !record.isPlaceholder
        && pathIsInIndexFolderSources(record.path, [source]));
      const folderAvailable = source.path === INDEX_FOLDER_VAULT_ROOT
        || this.app.vault.getAbstractFileByPath(source.path) instanceof TFolder;
      const row = parent.createDiv({ cls: "ent-cc-manager-diagnostic ent-cc-manager-source" });
      row.createEl("strong", { text: linkedSourceLabel(source), attr: { dir: "auto" } });
      row.createEl("p", {
        text: `${source.origin === "legacy-primary-folder" ? "Inherited during upgrade" : "Linked deliberately"} · ${members.length} current Markdown ${members.length === 1 ? "note" : "notes"} below this source · ${folderAvailable ? "folder available" : "folder unavailable on this device"}.`,
      });
      if (source.origin === "legacy-primary-folder") {
        const review = row.createEl("button", {
          cls: "ent-cc-button",
          text: "Review inherited link…",
          type: "button",
        });
        review.disabled = this.plugin.isDataReadOnly();
        review.addEventListener("click", () => {
          if (!this.guardOpenedBase()) return;
          this.plugin.openLegacyIndexReview(source.id);
        });
      }
    }

    const storage = parent.createDiv({ cls: "ent-cc-manager-diagnostic" });
    storage.createEl("strong", { text: "Storage and creation folders (location only)" });
    storage.createEl("p", {
      text: [
        `Grouping root: ${this.plugin.data.settings.primaryFolder || "Vault root"}`,
        `New-note folder: ${this.plugin.data.settings.defaultNoteFolder || "Vault root"}`,
        `Inbox: ${this.plugin.data.settings.proposalFolder || "Not configured"}`,
      ].join(" · "),
      attr: { dir: "auto" },
    });
    storage.createEl("p", { text: "These paths choose where notes are stored or grouped. They do not add a note unless the same path is deliberately linked above." });
  }

  private renderNoteManager(notes: ManagerNote[], availableCount: () => number, parent = this.contentEl): void {
    const toolbar = parent.createDiv({ cls: "ent-cc-manager-toolbar" });
    const search = toolbar.createEl("input", { type: "search", placeholder: "Search note title or path…", attr: { "aria-label": "Search index manager notes" } });
    search.value = this.query;
    search.addEventListener("input", () => {
      const cursor = search.selectionStart ?? search.value.length;
      if (search.value !== this.query) {
        // A new query shows a different set of rows; keeping hidden notes
        // selected would let a bulk action reach notes the user cannot see.
        this.selected.clear();
        this.refreshSelectionState();
      }
      this.query = search.value;
      if (this.searchTimer !== null) this.clearTimer(this.searchTimer);
      this.searchTimer = this.setGuardedTimer(() => {
        this.searchTimer = null;
        // Filtering the memoized snapshot: a keystroke must never trigger the
        // full vault scan that building the candidate list requires.
        this.renderSnapshot();
        this.setGuardedTimer(() => {
          const next = this.contentEl.querySelector<HTMLInputElement>('.ent-cc-manager-toolbar input[type="search"]');
          next?.focus();
          next?.setSelectionRange(cursor, cursor);
        }, 0);
      }, 150);
    });
    const filtered = this.filterNotes(notes);
    // One predicate owns both the label and the action: a selection that also
    // holds notes hidden by the filter must never be labelled "Clear selection".
    const selectionCoversMatches = filtered.length > 0
      && this.selected.size === filtered.length
      && filtered.every((note) => this.selected.has(note.path));
    this.actionButton(toolbar, "list-checks", selectionCoversMatches ? "Clear selection" : "Select matches", () => {
      if (selectionCoversMatches) this.selected.clear();
      else filtered.forEach((note) => this.selected.add(note.path));
      this.renderSnapshot();
    }, filtered.length === 0);

    const actions = parent.createDiv({ cls: `ent-cc-manager-bulk-actions ${this.selected.size === 0 ? "is-idle" : ""} ${filtered.length === 0 ? "is-empty-list" : ""}` });
    this.selectionActionsEl = actions;
    this.selectionCountEl = actions.createSpan({ text: `${this.selected.size} selected`, cls: "ent-cc-muted", attr: { role: "status", "aria-live": "polite" } });
    this.selectionButtons = [];
    if (this.tab === "indexed") {
      this.selectionButtons.push({ el: this.actionButton(actions, "folder-input", `Move to ${this.plugin.data.settings.groupLabel.toLowerCase()}…`, () => this.chooseGroupForSelection("move"), this.selected.size === 0 || !this.plugin.canVisuallyMoveAcrossGroups()), enabled: () => this.selected.size > 0 && this.plugin.canVisuallyMoveAcrossGroups() });
      this.selectionButtons.push({ el: this.actionButton(actions, "list-minus", "Remove from index…", () => this.removeSelectedFromIndex(), this.selected.size === 0, true), enabled: () => this.selected.size > 0 });
    } else if (this.tab === "available") {
      this.selectionButtons.push({ el: this.actionButton(actions, "list-plus", "Add selected…", () => this.chooseGroupForSelection("add"), this.selected.size === 0), enabled: () => this.selected.size > 0 });
    } else {
      this.selectionButtons.push({ el: this.actionButton(actions, "rotate-ccw", "Restore selected…", () => this.chooseGroupForSelection("restore"), this.selected.size === 0), enabled: () => this.selected.size > 0 });
    }

    const list = parent.createDiv({ cls: "ent-cc-manager-list" });
    const visible = filtered.slice(0, INDEX_MANAGER_PAGE_SIZE);
    for (const note of visible) this.renderNoteRow(list, note);
    if (filtered.length > visible.length) list.createDiv({ cls: "ent-cc-manager-limit", text: `Showing the first ${visible.length} matches. Narrow the search to reach the remaining ${filtered.length - visible.length}.` });
    if (filtered.length === 0) {
      const available = !this.query && this.tab === "indexed" && !this.plugin.isClinicalMode() ? availableCount() : 0;
      if (available > 0) {
        const empty = list.createDiv({ cls: "ent-cc-empty ent-cc-empty-action" });
        setIcon(empty.createSpan(), "list-plus");
        empty.createEl("strong", { text: `Start your ${this.plugin.data.settings.indexLabel.toLowerCase()}` });
        empty.createEl("p", { text: `${available} existing note${available === 1 ? " is" : "s are"} available to add. Their files will not be moved or rewritten.` });
        const browse = empty.createEl("button", { cls: "ent-cc-button ent-cc-add-button", text: `Browse ${available} available` });
        browse.addEventListener("click", () => this.switchTab("available", true));
      } else {
        list.createDiv({ cls: "ent-cc-empty", text: this.query ? "No notes match this search." : "Nothing in this section." });
      }
    }
  }

  /** Updates only the controls that depend on the selection, preserving focus. */
  private refreshSelectionState(): void {
    if (!this.guardOpenedBase()) return;
    this.selectionCountEl?.setText(`${this.selected.size} selected`);
    this.selectionActionsEl?.toggleClass("is-idle", this.selected.size === 0);
    for (const button of this.selectionButtons) button.el.disabled = !button.enabled();
  }

  private revealActiveTab(tablist: HTMLElement): void {
    this.setGuardedTimer(() => {
      const active = tablist.querySelector<HTMLElement>('[aria-selected="true"]');
      active?.scrollIntoView({ block: "nearest", inline: "center" });
    }, 0);
  }

  private filterNotes(notes: ManagerNote[]): ManagerNote[] {
    const query = normalizeSearchText(this.query.trim());
    return (query ? notes.filter((note) => normalizeSearchText(`${note.title} ${note.meta}`).includes(query)) : notes)
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  private renderNoteRow(parent: HTMLElement, note: ManagerNote): void {
    const row = parent.createDiv({ cls: "ent-cc-manager-note" });
    const selector = row.createEl("label", { cls: "ent-cc-manager-note-select" });
    const checkbox = selector.createEl("input", { type: "checkbox" });
    checkbox.checked = this.selected.has(note.path);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) this.selected.add(note.path); else this.selected.delete(note.path);
      // Re-rendering here would destroy the checkbox that has focus, making
      // keyboard multi-selection impossible.
      this.refreshSelectionState();
    });
    const text = selector.createDiv({ cls: "ent-cc-manager-note-text" });
    text.createDiv({ cls: "ent-cc-manager-note-title", text: note.title });
    text.createDiv({ cls: "ent-cc-picker-meta", text: note.meta });
    const file = this.app.vault.getAbstractFileByPath(note.path);
    if (file instanceof TFile) {
      const open = row.createEl("button", { cls: "ent-cc-icon-button", attr: { "aria-label": `Open ${note.title}`, title: `Open ${note.title}`, type: "button" } });
      setIcon(open, "external-link");
      open.addEventListener("click", (event) => { event.preventDefault(); this.run(() => this.plugin.openFile(file)); });
    }
  }

  private chooseGroupForSelection(mode: "add" | "restore" | "move"): void {
    if (!this.guardOpenedBase()) return;
    const paths = [...this.selected];
    if (paths.length === 0) return;
    if (mode === "restore" && !this.plugin.canVisuallyMoveAcrossGroups()) {
      this.run(async () => {
        await this.plugin.restoreRecordsToIndex(paths, `Restore ${paths.length} notes to this knowledge base`);
        if (!this.guardOpenedBase()) return;
        this.selected.clear();
        this.tab = "indexed";
        this.render();
        new Notice(`${paths.length} ${paths.length === 1 ? "subject was" : "subjects were"} restored to the protected source placement. No Markdown file was changed.`);
      });
      return;
    }
    const first = this.plugin.getRecord(paths[0] ?? "");
    new IndexGroupModal(this.app, {
      title: `${mode === "move" ? "Move" : mode === "restore" ? "Restore" : "Add"} ${paths.length} note${paths.length === 1 ? "" : "s"}`,
      groupLabel: this.plugin.data.settings.groupLabel,
      initialValue: first?.domain || this.plugin.getIndexGroups()[0] || "Ungrouped",
      existingGroups: this.plugin.getIndexGroups(),
      submitLabel: mode === "move" ? "Move visually" : mode === "restore" ? "Restore to index" : "Add to index",
      onSubmit: async (group) => {
        if (!this.guardOpenedBase()) return;
        if (mode !== "move") {
          // The plugin API preflights the whole selection against protected ENT
          // source classification before mutating any membership. Routing this
          // branch through it prevents visual group selection from becoming a
          // back door into the clinical Index.
          await this.plugin.restoreRecordsToIndex(
            paths,
            `${mode === "add" ? "Add" : "Restore"} ${paths.length} index note${paths.length === 1 ? "" : "s"}`,
            group,
          );
        } else {
          await this.plugin.mutate(`${mode} ${paths.length} index note${paths.length === 1 ? "" : "s"}`, () => {
            if (!this.plugin.data.indexGroupOrder.includes(group)) this.plugin.data.indexGroupOrder.push(group);
            for (const path of paths) {
              this.plugin.data.indexGroupByPath[path] = group;
              resetCurriculumVisualPath(this.plugin.data.curriculumVisual, path);
            }
          });
        }
        if (!this.guardOpenedBase()) return;
        this.selected.clear();
        this.tab = "indexed";
        this.render();
        new Notice(`${paths.length} note${paths.length === 1 ? "" : "s"} updated. Markdown files were not moved.`);
      },
    }).open();
  }

  private removeSelectedFromIndex(): void {
    if (!this.guardOpenedBase()) return;
    const paths = [...this.selected];
    if (paths.length === 0) return;
    new ConfirmModal(this.app, "Remove selected notes from index?", `${paths.length} membership${paths.length === 1 ? "" : "s"} will be removed. Markdown notes and collection memberships remain untouched.`, "Remove from index", async () => {
      if (!this.guardOpenedBase()) return;
      await this.plugin.removeRecordsFromIndex(paths, `Remove ${paths.length} notes from this knowledge base`);
      if (!this.guardOpenedBase()) return;
      this.selected.clear();
      this.render();
      new Notice("Index memberships removed. No Markdown note was deleted or moved.");
    }).open();
  }

  private renderGroups(groups: string[], parent = this.contentEl): void {
    const canMove = this.plugin.canVisuallyMoveAcrossGroups();
    const readOnly = this.plugin.isDataReadOnly();
    const toolbar = parent.createDiv({ cls: "ent-cc-manager-toolbar" });
    toolbar.createEl("p", { text: canMove
      ? "Group changes are visual-only and do not rewrite note properties or folders."
      : "Display labels and base membership remain editable. Cross-domain movement, group creation, merging, and reordering are disabled by the ENT clinical safeguard." });
    this.actionButton(toolbar, "folder-plus", `New ${this.plugin.data.settings.groupLabel.toLowerCase()}`, () => this.createGroup(), readOnly || !canMove);
    const membersByGroup = new Map<string, VaultRecord[]>();
    for (const record of this.plugin.getIndexRecords()) {
      const members = membersByGroup.get(record.domain) ?? [];
      members.push(record);
      membersByGroup.set(record.domain, members);
    }
    const list = parent.createDiv({ cls: "ent-cc-manager-list ent-cc-manager-groups" });
    const visibleGroups = groups.slice(0, this.visibleRowLimits?.groups ?? INDEX_MANAGER_PAGE_SIZE);
    visibleGroups.forEach((group, index) => {
      const members = membersByGroup.get(group) ?? [];
      const row = list.createDiv({ cls: "ent-cc-manager-group" });
      const text = row.createDiv({ cls: "ent-cc-manager-note-text" });
      text.createDiv({ cls: "ent-cc-manager-note-title", text: group });
      text.createDiv({ cls: "ent-cc-picker-meta", text: `${members.length} indexed ${this.plugin.data.settings.itemPlural}` });
      const actions = row.createEl("button", {
        cls: "ent-cc-button ent-cc-manager-group-actions",
        type: "button",
        attr: { "aria-label": `Actions for index heading ${group}`, title: `Actions for ${group}` },
      });
      setIcon(actions.createSpan(), "ellipsis");
      actions.createSpan({ text: "Actions…" });
      actions.disabled = readOnly;
      actions.addEventListener("click", (event) => this.showGroupActions(event, group, members, index, groups, canMove));
    });
    this.renderShowMore(list, "groups", visibleGroups.length, groups.length);
    if (groups.length === 0) list.createDiv({ cls: "ent-cc-empty", text: `No ${this.plugin.data.settings.groupLabel.toLowerCase()}s yet.` });
  }

  private showGroupActions(
    event: MouseEvent,
    group: string,
    members: VaultRecord[],
    index: number,
    groups: string[],
    canMove: boolean,
  ): void {
    if (!this.guardOpenedBase()) return;
    const menu = new Menu();
    menu.addItem((item) => item
      .setTitle("Move heading up")
      .setIcon("arrow-up")
      .setDisabled(!canMove || index === 0)
      .onClick(() => this.reorderGroup(group, -1)));
    menu.addItem((item) => item
      .setTitle("Move heading down")
      .setIcon("arrow-down")
      .setDisabled(!canMove || index === groups.length - 1)
      .onClick(() => this.reorderGroup(group, 1)));
    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle("Rename in this index…")
      .setIcon("pencil")
      .onClick(() => this.renameGroup(group)));
    menu.addItem((item) => item
      .setTitle("Merge into another heading…")
      .setIcon("combine")
      .setDisabled(!canMove || groups.length < 2)
      .onClick(() => this.mergeGroup(group)));
    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle(members.length > 0 ? "Remove heading and subjects from this base…" : "Remove heading from this base…")
      .setIcon("trash-2")
      .onClick(() => this.removeGroup(group, members)));
    menu.showAtMouseEvent(event);
  }

  private createGroup(): void {
    if (!this.guardOpenedBase()) return;
    new TextPromptModal(this.app, {
      title: `Create ${this.plugin.data.settings.groupLabel.toLowerCase()}`,
      placeholder: `${this.plugin.data.settings.groupLabel} name`,
      onSubmit: async (group) => {
        if (!this.guardOpenedBase()) return;
        if (this.plugin.getIndexGroups().some((candidate) => candidate.toLowerCase() === group.toLowerCase())) throw new Error(`${group} already exists.`);
        await this.plugin.mutate(`Create visual group “${group}”`, () => {
          this.plugin.data.indexGroupOrder.push(group);
          registerPortableGroup(this.plugin.data, group);
        }, { includePortableIndex: true, requireUndo: true });
        if (!this.guardOpenedBase()) return;
        this.render();
      },
    }).open();
  }

  private reorderGroup(group: string, direction: -1 | 1): void {
    if (!this.guardOpenedBase()) return;
    const groups = this.plugin.getIndexGroups();
    const from = groups.indexOf(group);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= groups.length) return;
    this.run(async () => {
      await this.plugin.mutate(`Reorder visual group “${group}”`, () => {
        const order = [...groups];
        const [moved] = order.splice(from, 1);
        if (moved) order.splice(to, 0, moved);
        this.plugin.data.indexGroupOrder = order;
      }, { requireUndo: true });
      if (!this.guardOpenedBase()) return;
      this.render();
    });
  }

  /** Resolve the configured/portable source groups represented by one display label. */
  private sourceGroupsForDisplayGroup(group: string, members: VaultRecord[]): string[] {
    const aliases = this.plugin.data.indexGroupAliases;
    const sources = new Set(Object.entries(aliases)
      .filter(([, display]) => display === group)
      .map(([source]) => source));
    const portableGroups = new Map(this.plugin.data.portableIndex.groups.map((item) => [item.id, item.title]));
    for (const record of members) {
      // An explicit visual placement owns its label directly; renaming the
      // source group would unexpectedly affect unrelated records.
      if (this.plugin.data.indexGroupByPath[record.path]) continue;
      const file = this.app.vault.getAbstractFileByPath(record.path);
      const subject = record.portableId ? this.plugin.getPortableSubject(record.portableId) : null;
      const source = file instanceof TFile
        ? this.plugin.suggestedIndexGroup(file)
        : subject ? portableGroups.get(subject.groupId) ?? "" : "";
      if (source && (aliases[source] || source) === group) sources.add(source);
    }
    if (sources.size === 0) sources.add(group);
    return [...sources];
  }

  private renameGroup(group: string): void {
    if (!this.guardOpenedBase()) return;
    new TextPromptModal(this.app, {
      title: `Rename “${group}”`, placeholder: `${this.plugin.data.settings.groupLabel} name`, initialValue: group,
      onSubmit: async (next) => {
        if (!this.guardOpenedBase()) return;
        if (next !== group && this.plugin.getIndexGroups().some((candidate) => candidate !== group && candidate.toLowerCase() === next.toLowerCase())) throw new Error(`${next} already exists. Use Merge instead.`);
        const members = this.plugin.getIndexRecords().filter((record) => record.domain === group);
        const sourceGroups = this.sourceGroupsForDisplayGroup(group, members);
        const unsafeSourceGroups = new Set(sourceGroups.filter((source) => !isSafeObjectKey(source)));
        const groupOrder = this.plugin.getIndexGroups();
        await this.plugin.mutate(`Rename visual group “${group}”`, () => {
          for (const [path, display] of Object.entries(this.plugin.data.indexGroupByPath)) {
            if (display === group) this.plugin.data.indexGroupByPath[path] = next;
          }
          for (const source of sourceGroups) {
            if (unsafeSourceGroups.has(source)) continue;
            if (source === next) delete this.plugin.data.indexGroupAliases[source];
            else this.plugin.data.indexGroupAliases[source] = next;
          }
          if (unsafeSourceGroups.size > 0) {
            // Reserved JavaScript object keys cannot safely be persisted in an
            // alias map. Materialize the same visual result per member instead.
            for (const record of members) this.plugin.data.indexGroupByPath[record.path] = next;
          }
          this.transferRootOrder(group, next, false);
          const collapsed = this.plugin.data.collapsed.curriculumDomains;
          this.plugin.data.collapsed.curriculumDomains = [...new Set(
            collapsed.map((candidate) => candidate === group ? next : candidate),
          )];
          this.plugin.data.indexGroupOrder = [...new Set(groupOrder.map((candidate) => candidate === group ? next : candidate))];
          for (const source of new Set([group, ...sourceGroups])) renameOrMergePortableGroup(this.plugin.data, source, next);
          this.plugin.invalidateRecordCache();
        }, { includePortableIndex: true, requireUndo: true });
        if (!this.guardOpenedBase()) return;
        this.render();
      },
    }).open();
  }

  private mergeGroup(source: string): void {
    if (!this.guardOpenedBase()) return;
    const targets = this.plugin.getIndexGroups().filter((group) => group !== source);
    new StringPickerModal(this.app, targets, `Merge “${source}” into…`, `Search ${this.plugin.data.settings.groupLabel.toLowerCase()}s…`, (target) => {
      if (!this.guardOpenedBase()) return;
      new ConfirmModal(this.app, "Merge visual groups?", `All indexed notes in “${source}” will appear in “${target}”. Note folders and properties will not change.`, "Merge groups", async () => {
        if (!this.guardOpenedBase()) return;
        const members = this.plugin.getIndexRecords().filter((record) => record.domain === source);
        const sourceGroups = this.sourceGroupsForDisplayGroup(source, members);
        const unsafeSourceGroups = new Set(sourceGroups.filter((group) => !isSafeObjectKey(group)));
        const groupOrder = this.plugin.getIndexGroups();
        await this.plugin.mutate(`Merge visual group “${source}” into “${target}”`, () => {
          members.forEach((record) => { this.plugin.data.indexGroupByPath[record.path] = target; });
          for (const group of sourceGroups) {
            if (unsafeSourceGroups.has(group)) continue;
            if (group === target) delete this.plugin.data.indexGroupAliases[group];
            else this.plugin.data.indexGroupAliases[group] = target;
          }
          if (unsafeSourceGroups.size > 0) {
            // Reserved object keys cannot be stored safely as persistent source
            // aliases. Existing members retain the merged label per path.
            for (const record of members) this.plugin.data.indexGroupByPath[record.path] = target;
          }
          this.transferRootOrder(source, target, true);
          const collapsed = this.plugin.data.collapsed.curriculumDomains;
          this.plugin.data.collapsed.curriculumDomains = [
            ...collapsed.filter((candidate) => candidate !== source && candidate !== target),
            ...(collapsed.includes(source) || collapsed.includes(target) ? [target] : []),
          ];
          this.plugin.data.indexGroupOrder = groupOrder.filter((group) => group !== source);
          for (const group of new Set([source, ...sourceGroups])) renameOrMergePortableGroup(this.plugin.data, group, target);
          this.plugin.invalidateRecordCache();
        }, { includePortableIndex: true, requireUndo: true });
        if (!this.guardOpenedBase()) return;
        this.render();
      }).open();
    }).open();
  }

  private removeGroup(group: string, members: VaultRecord[]): void {
    if (!this.guardOpenedBase()) return;
    const paths = [...new Set(members.map((record) => record.path))];
    const count = paths.length;
    const noun = count === 1 ? this.plugin.data.settings.itemSingular : this.plugin.data.settings.itemPlural;
    const message = count === 0
      ? `“${group}” will be removed from this knowledge base. No Markdown note, property, or folder will be changed.`
      : `“${group}” and its ${count} indexed ${noun} will be removed from this knowledge base. The subjects can be restored from Available or Hidden. Markdown notes, properties, folders, and collection memberships will remain untouched.`;
    new ConfirmModal(this.app, `Remove “${group}” from this knowledge base?`, message, "Remove group", async () => {
      if (!this.guardOpenedBase()) return;
      const sourceGroups = this.sourceGroupsForDisplayGroup(group, members);
      await this.plugin.mutate(`Remove visual group “${group}” from this knowledge base`, () => {
        this.plugin.removeRecordsFromIndexState(paths);
        for (const [path, display] of Object.entries(this.plugin.data.indexGroupByPath)) {
          if (display === group) delete this.plugin.data.indexGroupByPath[path];
        }
        for (const [source, display] of Object.entries(this.plugin.data.indexGroupAliases)) {
          if (display === group) delete this.plugin.data.indexGroupAliases[source];
        }
        this.plugin.data.indexGroupOrder = this.plugin.data.indexGroupOrder.filter((candidate) => candidate !== group);
        delete this.plugin.data.curriculumVisual.orderByContainer[curriculumContainerKey(group, null)];
        for (const source of new Set([group, ...sourceGroups])) removePortableGroup(this.plugin.data, source);
        this.plugin.invalidateRecordCache();
      }, { includePortableIndex: true, requireUndo: true });
      if (!this.guardOpenedBase()) return;
      this.render();
      new Notice(count === 0
        ? `Removed “${group}” from this knowledge base. No Markdown note was changed.`
        : `Removed “${group}” and ${count} ${noun} from this knowledge base. Their Markdown notes were not changed.`);
    }).open();
  }

  private transferRootOrder(source: string, target: string, merge: boolean): void {
    const state = this.plugin.data.curriculumVisual.orderByContainer;
    const sourceKey = curriculumContainerKey(source, null);
    const targetKey = curriculumContainerKey(target, null);
    const sourcePaths = state[sourceKey] ?? [];
    const targetPaths = merge ? state[targetKey] ?? [] : [];
    const combined = [...new Set([...targetPaths, ...sourcePaths])];
    if (combined.length > 0) state[targetKey] = combined;
    else delete state[targetKey];
    if (sourceKey !== targetKey) delete state[sourceKey];
  }

  private renderDiagnostics(diagnostics: IndexDiagnostic[], parent = this.contentEl): void {
    const toolbar = parent.createDiv({ cls: "ent-cc-manager-toolbar" });
    toolbar.createEl("p", { text: diagnostics.length === 0 ? "No index-organization problems detected." : `${diagnostics.length} issue${diagnostics.length === 1 ? "" : "s"} detected. Safe repair removes only stale or duplicate plugin references; configured parent properties are never rewritten.` });
    this.actionButton(toolbar, "scan-search", "Open taxonomy health…", () => {
      if (!this.guardOpenedBase()) return;
      new TaxonomyHealthModal(this.plugin).open();
    });
    this.actionButton(toolbar, "shield-check", "Sync & Recovery Center…", () => {
      if (this.guardOpenedBase()) new SyncRecoveryCenterModal(this.plugin).open();
    });
    const repairableKinds = new Set<IndexDiagnostic["kind"]>(["missing-note", "duplicate-membership", "orphaned-group", "invalid-visual-parent"]);
    const repairable = diagnostics.some((item) => repairableKinds.has(item.kind));
    this.actionButton(toolbar, "wrench", "Repair safe issues", () => {
      const preview = this.plugin.previewIndexRepair();
      const repair = (): void => {
        this.run(async () => {
          await this.plugin.repairIndexOrganization(preview);
          if (!this.guardOpenedBase()) return;
          this.render();
          new Notice("Safe plugin-state repairs completed. Note metadata was not changed.");
        });
      };
      // Registrations for notes missing from THIS device may belong to notes
      // that simply have not synced yet; dropping them silently would erase
      // manual index memberships, collection memberships, and pins on every
      // device. Repair those only after an explicit confirmation.
      const { prunedPaths } = preview;
      if (prunedPaths.length === 0) {
        repair();
        return;
      }
      const shown = prunedPaths.slice(0, 8);
      const remainder = prunedPaths.length - shown.length;
      const listed = shown.join(", ") + (remainder > 0 ? `, …and ${remainder} more` : "");
      new ConfirmModal(
        this.app,
        "Remove registrations for missing notes?",
        `${prunedPaths.length === 1
          ? "1 registered note is missing on this device"
          : `${prunedPaths.length} registered notes are missing on this device`}: ${listed}. If these notes simply have not synced yet, cancel and wait for Sync to deliver them first — repairing now removes their index memberships, collection memberships, and pins, and that removal syncs to every device. Markdown notes are never changed.`,
        "Repair and remove",
        () => { repair(); },
      ).open();
    }, !repairable);
    const list = parent.createDiv({ cls: "ent-cc-manager-list" });
    const visibleDiagnostics = diagnostics.slice(0, this.visibleRowLimits?.diagnostics ?? INDEX_MANAGER_PAGE_SIZE);
    for (const diagnostic of visibleDiagnostics) {
      const row = list.createDiv({ cls: "ent-cc-manager-diagnostic" });
      const icon = row.createSpan({ cls: "ent-cc-manager-diagnostic-icon" });
      setIcon(icon, diagnostic.kind === "broken-parent" ? "link-2-off" : diagnostic.kind === "missing-note" ? "file-question" : "triangle-alert");
      const text = row.createDiv({ cls: "ent-cc-manager-note-text" });
      text.createDiv({ cls: "ent-cc-manager-note-title", text: diagnostic.title });
      text.createDiv({ cls: "ent-cc-picker-meta", text: `${diagnostic.detail}${diagnostic.path ? ` · ${diagnostic.path}` : ""}` });
      const file = diagnostic.path ? this.app.vault.getAbstractFileByPath(diagnostic.path) : null;
      if (file instanceof TFile) this.iconAction(row, "external-link", `Open ${file.basename}`, () => this.run(() => this.plugin.openFile(file)));
    }
    this.renderShowMore(list, "diagnostics", visibleDiagnostics.length, diagnostics.length);
    if (diagnostics.length === 0) list.createDiv({ cls: "ent-cc-empty", text: "Index organization is healthy." });
  }

  private renderShowMore(
    parent: HTMLElement,
    tab: "groups" | "diagnostics",
    shown: number,
    total: number,
  ): void {
    if (shown >= total) return;
    const remaining = total - shown;
    const limit = parent.createDiv({ cls: "ent-cc-manager-limit" });
    limit.createSpan({ text: `Showing ${shown} of ${total}.` });
    const button = limit.createEl("button", {
      cls: "ent-cc-button",
      text: `Show ${Math.min(INDEX_MANAGER_PAGE_SIZE, remaining)} more`,
      attr: { type: "button" },
    });
    button.addEventListener("click", () => {
      this.visibleRowLimits ??= { diagnostics: INDEX_MANAGER_PAGE_SIZE, groups: INDEX_MANAGER_PAGE_SIZE };
      this.visibleRowLimits[tab] = Math.min(total, this.visibleRowLimits[tab] + INDEX_MANAGER_PAGE_SIZE);
      this.renderSnapshot();
    });
  }

  private createBaseGuard(): OpenedBaseGuard {
    return createOpenedBaseGuard(this.plugin, {
      message: "The active knowledge base changed. Reopen the index manager before making more changes.",
      openedBaseId: this.openedBaseId,
      openedDataEpoch: this.openedDataEpoch ?? 0,
      onStale: () => { if (this.managerOpen) this.close(); },
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
      proceed: () => this.managerOpen && this.guardOpenedBase(),
      action,
      delay,
    });
  }

  private clearTimer(timer: number): void {
    clearGuardedTimer(this.contentEl, this.pendingTimers, timer);
  }

  private run(action: () => Promise<unknown>): void {
    if (!this.guardOpenedBase()) return;
    void action().catch((error) => {
      if (!this.guardOpenedBase()) return;
      new Notice(errorMessage(error));
    });
  }

  private actionButton(parent: HTMLElement, icon: string, label: string, action: () => void, disabled = false, warning = false): HTMLButtonElement {
    const button = parent.createEl("button", { cls: `ent-cc-button ${warning ? "ent-cc-warning-button" : ""}`.trim(), attr: { type: "button" } });
    setIcon(button.createSpan(), icon);
    button.createSpan({ text: label });
    button.disabled = disabled;
    button.addEventListener("click", () => {
      if (this.guardOpenedBase()) action();
    });
    return button;
  }

  private iconAction(parent: HTMLElement, icon: string, label: string, action: () => void, disabled = false, warning = false): HTMLButtonElement {
    const button = parent.createEl("button", { cls: `ent-cc-icon-button ${warning ? "ent-cc-warning-button" : ""}`.trim(), attr: { type: "button", "aria-label": label, title: label } });
    setIcon(button, icon);
    button.disabled = disabled;
    button.addEventListener("click", () => {
      if (this.guardOpenedBase()) action();
    });
    return button;
  }
}
