import { Menu, Modal, Notice, Platform, Setting, TFile, setIcon } from "obsidian";
import type EntVaultCommandCenterPlugin from "./main";
import {
  cleanLibraryNoteProfiles,
  createWorkspaceConfig,
  curriculumContainerKey,
  IndexDiagnostic,
  isSafeObjectKey,
  isPortablePlaceholderPath,
  normalizeSearchText,
  parseWorkspaceConfig,
  resetCurriculumVisualPath,
  resolveLibraryNoteProfile,
  validateTemplateFilePath,
  validateProposalFolderPath,
  validateWritableFolderPath,
  VaultRecord,
} from "./model";
import { ConfirmModal, IndexGroupModal, StringPickerModal, TextPromptModal, VaultFilePickerModal } from "./modals";
import { registerPortableGroup, removePortableGroup, renameOrMergePortableGroup } from "./portability";
import { ExportImportCenterModal } from "./portability-modal";
import { TaxonomyHealthModal } from "./taxonomy-health-modal";

export type ManagerTab = "indexed" | "available" | "hidden" | "groups" | "diagnostics";

interface ManagerNote {
  path: string;
  title: string;
  meta: string;
}

export class IndexManagerModal extends Modal {
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
  private staleBaseNoticeShown = false;
  private pendingTimers = new Set<number>();

  constructor(private readonly plugin: EntVaultCommandCenterPlugin, initialTab: ManagerTab = "indexed") {
    super(plugin.app);
    this.tab = initialTab;
  }

  onOpen(): void {
    this.openedBaseId = this.plugin.getActiveKnowledgeBaseId();
    this.openedDataEpoch = this.plugin.getDataEpoch();
    this.staleBaseNoticeShown = false;
    this.managerOpen = true;
    this.modalEl.addClass("ent-cc-index-manager-modal");
    this.contentEl.addClass("ent-cc-modal", "ent-cc-index-manager");
    this.titleEl.setText(`Manage ${this.plugin.data.settings.indexLabel}`);
    this.render();
  }

  onClose(): void {
    this.managerOpen = false;
    for (const timer of this.pendingTimers) window.activeWindow.clearTimeout(timer);
    this.pendingTimers.clear();
    this.searchTimer = null;
    this.selectionCountEl = null;
    this.selectionActionsEl = null;
    this.selectionButtons = [];
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
    if (this.plugin.isClinicalMode() && this.tab === "available") this.tab = "indexed";
    this.titleEl.setText(`Manage ${this.plugin.data.settings.indexLabel}`);
    this.render();
  }

  private render(): void {
    if (!this.guardOpenedBase()) return;
    // Do not retain controls detached by contentEl.empty(); selection refreshes
    // must address only the currently rendered toolbar.
    this.selectionCountEl = null;
    this.selectionActionsEl = null;
    this.selectionButtons = [];
    this.contentEl.empty();
    const settings = this.plugin.data.settings;
    const indexed = this.indexedNotes();
    const available = this.availableNotes();
    const hidden = this.hiddenNotes();
    const groups = this.plugin.getIndexGroups();
    const diagnostics = this.tab === "diagnostics"
      ? (this.diagnosticsCache ??= this.plugin.getIndexDiagnostics())
      : (this.diagnosticsCache ?? []);

    const header = this.contentEl.createDiv({ cls: "ent-cc-manager-header" });
    header.createEl("p", { text: `Manage membership, ${settings.groupLabel.toLowerCase()}s, and integrity without moving or rewriting Markdown notes.` });
    const portability = header.createDiv({ cls: "ent-cc-manager-portability" });
    this.actionButton(portability, "download", "Export…", () => this.openPortabilityCenter("export"));
    this.actionButton(portability, "upload", "Import…", () => this.openPortabilityCenter("import"));

    const tabs = this.contentEl.createDiv({ cls: "ent-cc-manager-tabs", attr: { role: "tablist" } });
    const definitions: Array<{ id: ManagerTab; label: string; count: number | string; genericOnly?: boolean }> = [
      { id: "indexed", label: "Indexed", count: indexed.length },
      { id: "available", label: "Available", count: available.length, genericOnly: true },
      { id: "hidden", label: "Hidden", count: hidden.length },
      { id: "groups", label: "Index headings", count: groups.length },
      { id: "diagnostics", label: "Diagnostics", count: this.diagnosticsCache?.length ?? "—" },
    ];
    for (const definition of definitions.filter((item) => !item.genericOnly || !this.plugin.isClinicalMode())) {
      const active = this.tab === definition.id;
      const button = tabs.createEl("button", {
        cls: `ent-cc-manager-tab ${active ? "is-active" : ""}`,
        attr: { role: "tab", "aria-selected": String(active), tabindex: active ? "0" : "-1", "data-manager-tab": definition.id },
      });
      button.createSpan({ text: definition.label });
      button.createSpan({ cls: "ent-cc-manager-tab-count", text: String(definition.count) });
      button.addEventListener("click", () => {
        this.tab = definition.id;
        this.query = "";
        this.selected.clear();
        this.render();
      });
    }
    this.revealActiveTab(tabs);

    if (["indexed", "available", "hidden"].includes(this.tab)) {
      const notes = this.tab === "indexed" ? indexed : this.tab === "available" ? available : hidden;
      this.renderNoteManager(notes, available.length);
    } else if (this.tab === "groups") {
      this.renderGroups(groups);
    } else {
      this.renderDiagnostics(diagnostics);
    }

    new Setting(this.contentEl).addButton((button) => button.setButtonText("Close").onClick(() => this.close())).settingEl.addClass("ent-cc-manager-footer");
  }

  private indexedNotes(): ManagerNote[] {
    const manualPaths = new Set(this.plugin.data.manualIndexPaths);
    return this.plugin.getIndexRecords().map((record) => ({
      path: record.path,
      title: record.title,
      meta: [record.domain, manualPaths.has(record.path) ? "manual membership" : "folder index", record.path].join(" · "),
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
      .map((file) => ({ path: file.path, title: file.basename, meta: file.path }));
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

  private renderNoteManager(notes: ManagerNote[], availableCount: number): void {
    const toolbar = this.contentEl.createDiv({ cls: "ent-cc-manager-toolbar" });
    const search = toolbar.createEl("input", { type: "search", placeholder: "Search note title or path…", attr: { "aria-label": "Search index manager notes" } });
    search.value = this.query;
    search.addEventListener("input", () => {
      const cursor = search.selectionStart ?? search.value.length;
      this.query = search.value;
      if (this.searchTimer !== null) this.clearTimer(this.searchTimer);
      this.searchTimer = this.setGuardedTimer(() => {
        this.searchTimer = null;
        this.render();
        this.setGuardedTimer(() => {
          const next = this.contentEl.querySelector<HTMLInputElement>('.ent-cc-manager-toolbar input[type="search"]');
          next?.focus();
          next?.setSelectionRange(cursor, cursor);
        }, 0);
      }, 150);
    });
    const filtered = this.filterNotes(notes);
    this.actionButton(toolbar, "list-checks", this.selected.size === filtered.length && filtered.length > 0 ? "Clear selection" : "Select matches", () => {
      if (this.selected.size === filtered.length && filtered.every((note) => this.selected.has(note.path))) this.selected.clear();
      else filtered.forEach((note) => this.selected.add(note.path));
      this.render();
    }, filtered.length === 0);

    const actions = this.contentEl.createDiv({ cls: `ent-cc-manager-bulk-actions ${this.selected.size === 0 ? "is-idle" : ""} ${filtered.length === 0 ? "is-empty-list" : ""}` });
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

    const list = this.contentEl.createDiv({ cls: "ent-cc-manager-list" });
    const visible = filtered.slice(0, 300);
    for (const note of visible) this.renderNoteRow(list, note);
    if (filtered.length > visible.length) list.createDiv({ cls: "ent-cc-manager-limit", text: `Showing the first ${visible.length} matches. Narrow the search to reach the remaining ${filtered.length - visible.length}.` });
    if (filtered.length === 0) {
      if (!this.query && this.tab === "indexed" && !this.plugin.isClinicalMode() && availableCount > 0) {
        const empty = list.createDiv({ cls: "ent-cc-empty ent-cc-empty-action" });
        setIcon(empty.createSpan(), "list-plus");
        empty.createEl("strong", { text: `Start your ${this.plugin.data.settings.indexLabel.toLowerCase()}` });
        empty.createEl("p", { text: `${availableCount} existing note${availableCount === 1 ? " is" : "s are"} available to add. Their files will not be moved or rewritten.` });
        const browse = empty.createEl("button", { cls: "ent-cc-button ent-cc-add-button", text: `Browse ${availableCount} available` });
        browse.addEventListener("click", () => {
          this.tab = "available";
          this.selected.clear();
          this.render();
        });
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

  private renderGroups(groups: string[]): void {
    const canMove = this.plugin.canVisuallyMoveAcrossGroups();
    const readOnly = this.plugin.isDataReadOnly();
    const toolbar = this.contentEl.createDiv({ cls: "ent-cc-manager-toolbar" });
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
    const list = this.contentEl.createDiv({ cls: "ent-cc-manager-list ent-cc-manager-groups" });
    groups.forEach((group, index) => {
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

  private renderDiagnostics(diagnostics: IndexDiagnostic[]): void {
    const toolbar = this.contentEl.createDiv({ cls: "ent-cc-manager-toolbar" });
    toolbar.createEl("p", { text: diagnostics.length === 0 ? "No index-organization problems detected." : `${diagnostics.length} issue${diagnostics.length === 1 ? "" : "s"} detected. Safe repair removes only stale or duplicate plugin references; configured parent properties are never rewritten.` });
    this.actionButton(toolbar, "scan-search", "Open taxonomy health…", () => {
      if (!this.guardOpenedBase()) return;
      new TaxonomyHealthModal(this.plugin).open();
    });
    const repairableKinds = new Set<IndexDiagnostic["kind"]>(["missing-note", "duplicate-membership", "orphaned-group", "invalid-visual-parent"]);
    const repairable = diagnostics.some((item) => repairableKinds.has(item.kind));
    this.actionButton(toolbar, "wrench", "Repair safe issues", () => {
      this.run(async () => {
        await this.plugin.repairIndexOrganization();
        if (!this.guardOpenedBase()) return;
        this.diagnosticsCache = null;
        this.render();
        new Notice("Safe plugin-state repairs completed. Note metadata was not changed.");
      });
    }, !repairable);
    const list = this.contentEl.createDiv({ cls: "ent-cc-manager-list" });
    for (const diagnostic of diagnostics) {
      const row = list.createDiv({ cls: "ent-cc-manager-diagnostic" });
      const icon = row.createSpan({ cls: "ent-cc-manager-diagnostic-icon" });
      setIcon(icon, diagnostic.kind === "broken-parent" ? "link-2-off" : diagnostic.kind === "missing-note" ? "file-question" : "triangle-alert");
      const text = row.createDiv({ cls: "ent-cc-manager-note-text" });
      text.createDiv({ cls: "ent-cc-manager-note-title", text: diagnostic.title });
      text.createDiv({ cls: "ent-cc-picker-meta", text: `${diagnostic.detail}${diagnostic.path ? ` · ${diagnostic.path}` : ""}` });
      const file = diagnostic.path ? this.app.vault.getAbstractFileByPath(diagnostic.path) : null;
      if (file instanceof TFile) this.iconAction(row, "external-link", `Open ${file.basename}`, () => this.run(() => this.plugin.openFile(file)));
    }
    if (diagnostics.length === 0) list.createDiv({ cls: "ent-cc-empty", text: "Index organization is healthy." });
  }

  private ownsOpenedBase(): boolean {
    // Prototype-only unit-test fixtures do not run onOpen(); real modal
    // instances always capture a non-empty ID before their first render.
    const currentEpoch = typeof this.plugin.getDataEpoch === "function" ? this.plugin.getDataEpoch() : 0;
    return !this.openedBaseId || (this.plugin.getActiveKnowledgeBaseId() === this.openedBaseId
      && currentEpoch === (this.openedDataEpoch ?? 0));
  }

  private guardOpenedBase(): boolean {
    if (this.ownsOpenedBase()) return true;
    const showNotice = !this.staleBaseNoticeShown;
    this.staleBaseNoticeShown = true;
    if (this.managerOpen) this.close();
    if (showNotice) {
      new Notice("The active knowledge base changed. Reopen the index manager before making more changes.", 8000);
    }
    return false;
  }

  private setGuardedTimer(action: () => void, delay: number): number {
    let timer = 0;
    let firedSynchronously = false;
    timer = window.activeWindow.setTimeout(() => {
      firedSynchronously = true;
      this.pendingTimers?.delete(timer);
      if (!this.managerOpen || !this.guardOpenedBase()) return;
      action();
    }, delay);
    if (!firedSynchronously) (this.pendingTimers ??= new Set<number>()).add(timer);
    return timer;
  }

  private clearTimer(timer: number): void {
    window.activeWindow.clearTimeout(timer);
    this.pendingTimers?.delete(timer);
  }

  private run(action: () => Promise<unknown>): void {
    if (!this.guardOpenedBase()) return;
    void action().catch((error) => {
      if (!this.ownsOpenedBase()) {
        this.guardOpenedBase();
        return;
      }
      new Notice(error instanceof Error ? error.message : String(error));
    });
  }

  private async exportWorkspace(): Promise<void> {
    if (!this.guardOpenedBase()) return;
    const now = new Date();
    const config = createWorkspaceConfig(this.plugin.data, now.toISOString());
    if (Platform.isMobile) {
      await this.plugin.writePortableJson("workspace", config);
      if (!this.guardOpenedBase()) return;
      new Notice("Workspace saved in the export folder inside the vault. No note contents included.");
      return;
    }
    const viewWindow = this.contentEl.ownerDocument.defaultView ?? window;
    const url = viewWindow.URL.createObjectURL(new Blob([JSON.stringify(config, null, 2)], { type: "application/json" }));
    const link = createEl("a");
    link.href = url;
    link.download = `knowledge-command-center-workspace-${now.toISOString().slice(0, 10)}.json`;
    link.click();
    viewWindow.setTimeout(() => viewWindow.URL.revokeObjectURL(url), 1000);
    new Notice("Workspace configuration exported without note contents or note-specific memberships.");
  }

  private importWorkspace(): void {
    if (!this.guardOpenedBase()) return;
    if (Platform.isMobile) {
      const files = this.plugin.getPortableJsonFiles();
      if (files.length === 0) {
        new Notice("No JSON files were found in the vault. Copy a workspace JSON into the vault, then try again.");
        return;
      }
      new VaultFilePickerModal(this.app, files, "Choose a workspace configuration JSON", (file) => {
        if (!this.guardOpenedBase()) return;
        this.confirmWorkspaceImport(this.plugin.readPortableJson(file));
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
      void file.text().then((raw) => {
        if (!this.guardOpenedBase()) return;
        this.confirmWorkspaceImport(Promise.resolve(JSON.parse(raw) as unknown));
      }).catch((error) => {
        if (!this.ownsOpenedBase()) {
          this.guardOpenedBase();
          return;
        }
        new Notice(error instanceof Error ? error.message : String(error));
      });
    });
    input.click();
  }

  private confirmWorkspaceImport(input: Promise<unknown>): void {
    if (!this.guardOpenedBase()) return;
    void input.then((value) => {
      if (!this.guardOpenedBase()) return;
      const config = parseWorkspaceConfig(value);
      const destinationSettings = this.plugin.data.settings;
      if (config.settings.workspaceMode !== destinationSettings.workspaceMode) {
        throw new Error(`This configuration uses the ${config.settings.workspaceMode === "ent-clinical" ? "ENT clinical" : "Generic"} preset. Create or switch to a matching knowledge base before importing Workspace settings.`);
      }
      const importedSettings = {
        ...config.settings,
        workspaceName: destinationSettings.workspaceName,
        workspaceMode: destinationSettings.workspaceMode,
        ...(destinationSettings.workspaceMode === "ent-clinical"
          ? { primaryFolder: destinationSettings.primaryFolder }
          : {}),
      };
      const importedProfileCount = Object.keys(importedSettings.libraryNoteProfiles).length;
      const destinationLibraryIds = new Set(this.plugin.getLibraries(true).map((library) => library.id));
      importedSettings.libraryNoteProfiles = Object.fromEntries(
        Object.entries(importedSettings.libraryNoteProfiles)
          .filter(([libraryId]) => destinationLibraryIds.has(libraryId))
          .map(([libraryId, profile]) => [libraryId, { ...profile }]),
      );
      const droppedProfileCount = importedProfileCount - Object.keys(importedSettings.libraryNoteProfiles).length;
      for (const folder of [importedSettings.primaryFolder, importedSettings.defaultNoteFolder, importedSettings.templatesFolder]) {
        const error = validateWritableFolderPath(folder, this.app.vault.configDir);
        if (error) throw new Error(error);
      }
      const inboxError = importedSettings.workspaceMode === "ent-clinical"
        ? validateProposalFolderPath(importedSettings.proposalFolder, this.app.vault.configDir)
        : validateWritableFolderPath(importedSettings.proposalFolder, this.app.vault.configDir);
      if (inboxError) throw new Error(inboxError);
      const configuredTemplate = importedSettings.defaultTemplatePath ? this.app.vault.getAbstractFileByPath(importedSettings.defaultTemplatePath) : null;
      const templateReset = importedSettings.defaultNewNoteMode === "template" && !(configuredTemplate instanceof TFile);
      if (templateReset) {
        importedSettings.defaultNewNoteMode = "empty";
        importedSettings.defaultTemplatePath = "";
      }
      let profileTemplateResetCount = 0;
      for (const [libraryId, profile] of Object.entries(importedSettings.libraryNoteProfiles)) {
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
            importedSettings.templatesFolder,
            this.app.vault.configDir,
          );
          if (validation) {
            const resetProfile = { ...profile, mode: "empty" as const };
            delete resetProfile.templatePath;
            importedSettings.libraryNoteProfiles[libraryId] = resetProfile;
            profileTemplateResetCount += 1;
            continue;
          }
        }
        const effective = resolveLibraryNoteProfile(importedSettings, libraryId);
        if (effective.mode !== "template") continue;
        const template = effective.templatePath
          ? this.app.vault.getAbstractFileByPath(effective.templatePath)
          : null;
        if (template instanceof TFile && template.extension.toLowerCase() === "md") continue;
        const resetProfile = { ...profile, mode: "empty" as const };
        delete resetProfile.templatePath;
        importedSettings.libraryNoteProfiles[libraryId] = resetProfile;
        profileTemplateResetCount += 1;
      }
      importedSettings.libraryNoteProfiles = cleanLibraryNoteProfiles(
        importedSettings.libraryNoteProfiles,
        destinationLibraryIds,
      );
      const profileResetNotice = profileTemplateResetCount > 0
        ? ` ${profileTemplateResetCount} Library ${profileTemplateResetCount === 1 ? "profile" : "profiles"} referenced unavailable templates and will use Empty note instead.`
        : "";
      const droppedProfileNotice = droppedProfileCount > 0
        ? ` ${droppedProfileCount} Library ${droppedProfileCount === 1 ? "profile" : "profiles"} did not match a destination Library and will be omitted.`
        : "";
      new ConfirmModal(this.app, "Import workspace configuration?", `Replace the current labels, compatible folders, metadata mappings, behavior settings, and group order with the configuration from ${config.exportedAt || "an unknown date"}? The destination base name, preset, and protected ENT scope will stay unchanged. Note contents and note-specific memberships will not change.${templateReset ? " The configured template is unavailable in this vault, so new notes will default to Empty." : ""}${profileResetNotice}${droppedProfileNotice}`, "Import workspace", async () => {
        if (!this.guardOpenedBase()) return;
        await this.plugin.mutate("Import workspace configuration", () => {
          this.plugin.data.settings = importedSettings;
          this.plugin.data.indexGroupOrder = config.indexGroupOrder;
          this.plugin.invalidateRecordCache();
        }, { includeSettings: true, requireUndo: true });
        if (!this.guardOpenedBase()) return;
        this.diagnosticsCache = null;
        this.titleEl.setText(`Manage ${this.plugin.data.settings.indexLabel}`);
        if (this.plugin.isClinicalMode() && this.tab === "available") this.tab = "indexed";
        this.render();
        new Notice(`Workspace configuration imported.${profileResetNotice}${droppedProfileNotice} Markdown notes were not changed.`);
      }).open();
    }).catch((error) => {
      if (!this.ownsOpenedBase()) {
        this.guardOpenedBase();
        return;
      }
      new Notice(error instanceof Error ? error.message : String(error));
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
