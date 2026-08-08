import { Modal, Notice, Platform, Setting, TFile, setIcon } from "obsidian";
import type EntVaultCommandCenterPlugin from "./main";
import {
  createWorkspaceConfig,
  curriculumContainerKey,
  IndexDiagnostic,
  parseWorkspaceConfig,
  pathIsInsideFolder,
  resetCurriculumVisualPath,
  validateProposalFolderPath,
  validateWritableFolderPath,
} from "./model";
import { ConfirmModal, IndexGroupModal, StringPickerModal, TextPromptModal, VaultFilePickerModal } from "./modals";

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

  constructor(private readonly plugin: EntVaultCommandCenterPlugin, initialTab: ManagerTab = "indexed") {
    super(plugin.app);
    this.tab = initialTab;
  }

  onOpen(): void {
    this.modalEl.addClass("ent-cc-index-manager-modal");
    this.contentEl.addClass("ent-cc-modal", "ent-cc-index-manager");
    this.titleEl.setText(`Manage ${this.plugin.data.settings.indexLabel}`);
    this.render();
  }

  onClose(): void {
    if (this.searchTimer !== null) window.activeWindow.clearTimeout(this.searchTimer);
    this.searchTimer = null;
    this.selectionCountEl = null;
    this.selectionActionsEl = null;
    this.selectionButtons = [];
  }

  private render(): void {
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
    this.actionButton(portability, "download", "Export workspace", () => this.run(() => this.exportWorkspace()));
    this.actionButton(portability, "upload", "Import workspace…", () => this.importWorkspace());

    const tabs = this.contentEl.createDiv({ cls: "ent-cc-manager-tabs", attr: { role: "tablist" } });
    const definitions: Array<{ id: ManagerTab; label: string; count: number | string; genericOnly?: boolean }> = [
      { id: "indexed", label: "Indexed", count: indexed.length },
      { id: "available", label: "Available", count: available.length, genericOnly: true },
      { id: "hidden", label: "Hidden", count: hidden.length, genericOnly: true },
      { id: "groups", label: settings.groupLabel, count: groups.length },
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
    return this.plugin.getIndexRecords().map((record) => ({
      path: record.path,
      title: record.title,
      meta: [record.domain, this.plugin.data.manualIndexPaths.includes(record.path) ? "manual membership" : "folder index", record.path].join(" · "),
    }));
  }

  private availableNotes(): ManagerNote[] {
    if (this.plugin.isClinicalMode()) return [];
    const hidden = new Set(this.plugin.data.excludedIndexPaths);
    return this.plugin.getIndexCandidateFiles().filter((file) => !hidden.has(file.path)).map((file) => ({ path: file.path, title: file.basename, meta: file.path }));
  }

  private hiddenNotes(): ManagerNote[] {
    if (this.plugin.isClinicalMode()) return [];
    return this.plugin.data.excludedIndexPaths.map((path) => {
      const file = this.app.vault.getAbstractFileByPath(path);
      return { path, title: file instanceof TFile ? file.basename : path.split("/").pop()?.replace(/\.md$/, "") || path, meta: file instanceof TFile ? path : `${path} · missing` };
    });
  }

  private renderNoteManager(notes: ManagerNote[], availableCount: number): void {
    const toolbar = this.contentEl.createDiv({ cls: "ent-cc-manager-toolbar" });
    const search = toolbar.createEl("input", { type: "search", placeholder: "Search note title or path…", attr: { "aria-label": "Search index manager notes" } });
    search.value = this.query;
    search.addEventListener("input", () => {
      const cursor = search.selectionStart ?? search.value.length;
      this.query = search.value;
      if (this.searchTimer !== null) window.activeWindow.clearTimeout(this.searchTimer);
      this.searchTimer = window.activeWindow.setTimeout(() => {
        this.searchTimer = null;
        this.render();
        window.activeWindow.setTimeout(() => {
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
      if (!this.plugin.isClinicalMode()) this.selectionButtons.push({ el: this.actionButton(actions, "list-minus", "Remove from index…", () => this.removeSelectedFromIndex(), this.selected.size === 0, true), enabled: () => this.selected.size > 0 });
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
    this.selectionCountEl?.setText(`${this.selected.size} selected`);
    this.selectionActionsEl?.toggleClass("is-idle", this.selected.size === 0);
    for (const button of this.selectionButtons) button.el.disabled = !button.enabled();
  }

  private revealActiveTab(tablist: HTMLElement): void {
    window.activeWindow.setTimeout(() => {
      const active = tablist.querySelector<HTMLElement>('[aria-selected="true"]');
      active?.scrollIntoView({ block: "nearest", inline: "center" });
    }, 0);
  }

  private filterNotes(notes: ManagerNote[]): ManagerNote[] {
    const query = this.query.trim().toLowerCase();
    return (query ? notes.filter((note) => `${note.title} ${note.meta}`.toLowerCase().includes(query)) : notes)
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
    const paths = [...this.selected];
    if (paths.length === 0) return;
    const first = this.plugin.getRecord(paths[0] ?? "");
    new IndexGroupModal(this.app, {
      title: `${mode === "move" ? "Move" : mode === "restore" ? "Restore" : "Add"} ${paths.length} note${paths.length === 1 ? "" : "s"}`,
      groupLabel: this.plugin.data.settings.groupLabel,
      initialValue: first?.domain || this.plugin.getIndexGroups()[0] || "Ungrouped",
      existingGroups: this.plugin.getIndexGroups(),
      submitLabel: mode === "move" ? "Move visually" : mode === "restore" ? "Restore to index" : "Add to index",
      onSubmit: async (group) => {
        await this.plugin.mutate(`${mode} ${paths.length} index note${paths.length === 1 ? "" : "s"}`, () => {
          if (!this.plugin.data.indexGroupOrder.includes(group)) this.plugin.data.indexGroupOrder.push(group);
          for (const path of paths) {
            if (mode !== "move") {
              this.plugin.data.excludedIndexPaths = this.plugin.data.excludedIndexPaths.filter((candidate) => candidate !== path);
              if (!pathIsInsideFolder(path, this.plugin.data.settings.primaryFolder) && !this.plugin.data.manualIndexPaths.includes(path)) this.plugin.data.manualIndexPaths.push(path);
            }
            this.plugin.data.indexGroupByPath[path] = group;
            resetCurriculumVisualPath(this.plugin.data.curriculumVisual, path);
          }
        });
        this.selected.clear();
        this.tab = "indexed";
        this.render();
        new Notice(`${paths.length} note${paths.length === 1 ? "" : "s"} updated. Markdown files were not moved.`);
      },
    }).open();
  }

  private removeSelectedFromIndex(): void {
    const paths = [...this.selected];
    if (paths.length === 0 || this.plugin.isClinicalMode()) return;
    new ConfirmModal(this.app, "Remove selected notes from index?", `${paths.length} membership${paths.length === 1 ? "" : "s"} will be removed. Markdown notes and collection memberships remain untouched.`, "Remove from index", async () => {
      await this.plugin.mutate(`Remove ${paths.length} notes from index`, () => {
        for (const path of paths) {
          this.plugin.data.manualIndexPaths = this.plugin.data.manualIndexPaths.filter((candidate) => candidate !== path);
          if (pathIsInsideFolder(path, this.plugin.data.settings.primaryFolder) && !this.plugin.data.excludedIndexPaths.includes(path)) this.plugin.data.excludedIndexPaths.push(path);
          delete this.plugin.data.indexGroupByPath[path];
          resetCurriculumVisualPath(this.plugin.data.curriculumVisual, path);
        }
      });
      this.selected.clear();
      this.render();
      new Notice("Index memberships removed. No Markdown note was deleted or moved.");
    }).open();
  }

  private renderGroups(groups: string[]): void {
    const canEdit = this.plugin.canVisuallyMoveAcrossGroups();
    const toolbar = this.contentEl.createDiv({ cls: "ent-cc-manager-toolbar" });
    toolbar.createEl("p", { text: canEdit ? "Group changes are visual-only and do not rewrite note properties or folders." : "Cross-domain visual changes are disabled by the ENT clinical safeguard in Settings." });
    this.actionButton(toolbar, "folder-plus", `New ${this.plugin.data.settings.groupLabel.toLowerCase()}`, () => this.createGroup(), !canEdit);
    const counts = new Map<string, number>();
    for (const record of this.plugin.getIndexRecords()) counts.set(record.domain, (counts.get(record.domain) ?? 0) + 1);
    const list = this.contentEl.createDiv({ cls: "ent-cc-manager-list ent-cc-manager-groups" });
    groups.forEach((group, index) => {
      const row = list.createDiv({ cls: "ent-cc-manager-group" });
      const text = row.createDiv({ cls: "ent-cc-manager-note-text" });
      text.createDiv({ cls: "ent-cc-manager-note-title", text: group });
      text.createDiv({ cls: "ent-cc-picker-meta", text: `${counts.get(group) ?? 0} indexed ${this.plugin.data.settings.itemPlural}` });
      this.iconAction(row, "arrow-up", `Move ${group} up`, () => this.reorderGroup(group, -1), !canEdit || index === 0);
      this.iconAction(row, "arrow-down", `Move ${group} down`, () => this.reorderGroup(group, 1), !canEdit || index === groups.length - 1);
      this.iconAction(row, "pencil", `Rename ${group}`, () => this.renameGroup(group), !canEdit);
      this.iconAction(row, "combine", `Merge ${group}`, () => this.mergeGroup(group), !canEdit || groups.length < 2);
      if ((counts.get(group) ?? 0) === 0) this.iconAction(row, "trash-2", `Remove empty ${group}`, () => this.removeEmptyGroup(group), !canEdit, true);
    });
    if (groups.length === 0) list.createDiv({ cls: "ent-cc-empty", text: `No ${this.plugin.data.settings.groupLabel.toLowerCase()}s yet.` });
  }

  private createGroup(): void {
    new TextPromptModal(this.app, {
      title: `Create ${this.plugin.data.settings.groupLabel.toLowerCase()}`,
      placeholder: `${this.plugin.data.settings.groupLabel} name`,
      onSubmit: async (group) => {
        if (this.plugin.getIndexGroups().some((candidate) => candidate.toLowerCase() === group.toLowerCase())) throw new Error(`${group} already exists.`);
        await this.plugin.mutate(`Create visual group “${group}”`, () => this.plugin.data.indexGroupOrder.push(group));
        this.render();
      },
    }).open();
  }

  private reorderGroup(group: string, direction: -1 | 1): void {
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
      });
      this.render();
    });
  }

  private renameGroup(group: string): void {
    new TextPromptModal(this.app, {
      title: `Rename “${group}”`, placeholder: `${this.plugin.data.settings.groupLabel} name`, initialValue: group,
      onSubmit: async (next) => {
        if (next !== group && this.plugin.getIndexGroups().some((candidate) => candidate.toLowerCase() === next.toLowerCase())) throw new Error(`${next} already exists. Use Merge instead.`);
        const members = this.plugin.getIndexRecords().filter((record) => record.domain === group);
        await this.plugin.mutate(`Rename visual group “${group}”`, () => {
          members.forEach((record) => { this.plugin.data.indexGroupByPath[record.path] = next; });
          this.transferRootOrder(group, next, false);
          this.plugin.data.indexGroupOrder = this.plugin.getIndexGroups().map((candidate) => candidate === group ? next : candidate).filter((candidate, index, all) => all.indexOf(candidate) === index);
        });
        this.render();
      },
    }).open();
  }

  private mergeGroup(source: string): void {
    const targets = this.plugin.getIndexGroups().filter((group) => group !== source);
    new StringPickerModal(this.app, targets, `Merge “${source}” into…`, `Search ${this.plugin.data.settings.groupLabel.toLowerCase()}s…`, (target) => {
      new ConfirmModal(this.app, "Merge visual groups?", `All indexed notes in “${source}” will appear in “${target}”. Note folders and properties will not change.`, "Merge groups", async () => {
        const members = this.plugin.getIndexRecords().filter((record) => record.domain === source);
        await this.plugin.mutate(`Merge visual group “${source}” into “${target}”`, () => {
          members.forEach((record) => { this.plugin.data.indexGroupByPath[record.path] = target; });
          this.transferRootOrder(source, target, true);
          this.plugin.data.indexGroupOrder = this.plugin.getIndexGroups().filter((group) => group !== source);
        });
        this.render();
      }).open();
    }).open();
  }

  private removeEmptyGroup(group: string): void {
    this.run(async () => {
      await this.plugin.mutate(`Remove empty visual group “${group}”`, () => {
        this.plugin.data.indexGroupOrder = this.plugin.data.indexGroupOrder.filter((candidate) => candidate !== group);
        delete this.plugin.data.curriculumVisual.orderByContainer[curriculumContainerKey(group, null)];
      });
      this.render();
    });
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
    const repairableKinds = new Set<IndexDiagnostic["kind"]>(["missing-note", "duplicate-membership", "orphaned-group", "invalid-visual-parent"]);
    const repairable = diagnostics.some((item) => repairableKinds.has(item.kind));
    this.actionButton(toolbar, "wrench", "Repair safe issues", () => {
      this.run(async () => {
        await this.plugin.repairIndexOrganization();
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

  private run(action: () => Promise<unknown>): void {
    void action().catch((error) => new Notice(error instanceof Error ? error.message : String(error)));
  }

  private async exportWorkspace(): Promise<void> {
    const now = new Date();
    const config = createWorkspaceConfig(this.plugin.data, now.toISOString());
    if (Platform.isMobile) {
      await this.plugin.writePortableJson("workspace", config);
      new Notice("Workspace configuration saved inside the vault for mobile sharing. Note contents were not included.");
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
    if (Platform.isMobile) {
      const files = this.plugin.getPortableJsonFiles();
      if (files.length === 0) {
        new Notice("No JSON files were found in the vault. Copy a workspace JSON into the vault, then try again.");
        return;
      }
      new VaultFilePickerModal(this.app, files, "Choose a workspace configuration JSON", (file) => {
        this.confirmWorkspaceImport(this.plugin.readPortableJson(file));
      }).open();
      return;
    }
    const input = createEl("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      void file.text().then((raw) => {
        this.confirmWorkspaceImport(Promise.resolve(JSON.parse(raw) as unknown));
      }).catch((error) => new Notice(error instanceof Error ? error.message : String(error)));
    });
    input.click();
  }

  private confirmWorkspaceImport(input: Promise<unknown>): void {
    void input.then((value) => {
      const config = parseWorkspaceConfig(value);
      for (const folder of [config.settings.primaryFolder, config.settings.defaultNoteFolder, config.settings.templatesFolder]) {
        const error = validateWritableFolderPath(folder, this.app.vault.configDir);
        if (error) throw new Error(error);
      }
      const inboxError = config.settings.workspaceMode === "ent-clinical"
        ? validateProposalFolderPath(config.settings.proposalFolder, this.app.vault.configDir)
        : validateWritableFolderPath(config.settings.proposalFolder, this.app.vault.configDir);
      if (inboxError) throw new Error(inboxError);
      const configuredTemplate = config.settings.defaultTemplatePath ? this.app.vault.getAbstractFileByPath(config.settings.defaultTemplatePath) : null;
      const templateReset = config.settings.defaultNewNoteMode === "template" && !(configuredTemplate instanceof TFile);
      if (templateReset) {
        config.settings.defaultNewNoteMode = "empty";
        config.settings.defaultTemplatePath = "";
      }
      new ConfirmModal(this.app, "Import workspace configuration?", `Replace the current labels, folders, metadata mappings, behavior settings, and group order with the configuration from ${config.exportedAt || "an unknown date"}? Note contents and note-specific memberships will not change.${templateReset ? " The configured template is unavailable in this vault, so new notes will default to Empty." : ""}`, "Import workspace", async () => {
        this.plugin.assertDataWritable();
        this.plugin.data.settings = config.settings;
        this.plugin.data.indexGroupOrder = config.indexGroupOrder;
        this.plugin.invalidateRecordCache();
        await this.plugin.savePluginData();
        await this.plugin.refreshViews();
        this.diagnosticsCache = null;
        this.titleEl.setText(`Manage ${this.plugin.data.settings.indexLabel}`);
        if (this.plugin.isClinicalMode() && ["available", "hidden"].includes(this.tab)) this.tab = "indexed";
        this.render();
        new Notice("Workspace configuration imported. Markdown notes were not changed.");
      }).open();
    }).catch((error) => new Notice(error instanceof Error ? error.message : String(error)));
  }

  private actionButton(parent: HTMLElement, icon: string, label: string, action: () => void, disabled = false, warning = false): HTMLButtonElement {
    const button = parent.createEl("button", { cls: `ent-cc-button ${warning ? "ent-cc-warning-button" : ""}`.trim(), attr: { type: "button" } });
    setIcon(button.createSpan(), icon);
    button.createSpan({ text: label });
    button.disabled = disabled;
    button.addEventListener("click", action);
    return button;
  }

  private iconAction(parent: HTMLElement, icon: string, label: string, action: () => void, disabled = false, warning = false): HTMLButtonElement {
    const button = parent.createEl("button", { cls: `ent-cc-icon-button ${warning ? "ent-cc-warning-button" : ""}`.trim(), attr: { type: "button", "aria-label": label, title: label } });
    setIcon(button, icon);
    button.disabled = disabled;
    button.addEventListener("click", action);
    return button;
  }
}
