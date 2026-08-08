import { Modal, Notice, Setting, setIcon } from "obsidian";
import type EntVaultCommandCenterPlugin from "./main";
import { sanitizeFileName, type KnowledgeBaseEntry, type WorkspaceMode } from "./model";
import { ConfirmModal, TextPromptModal } from "./modals";

function reportError(error: unknown): void {
  console.error("Knowledge Base Command Center base action failed", error);
  new Notice(error instanceof Error ? error.message : String(error), 8000);
}

export class CreateKnowledgeBaseModal extends Modal {
  private name = "";
  private mode: WorkspaceMode = "generic";
  private folder = "Knowledge Bases/Research";
  private folderEdited = false;
  private busy = false;
  private error = "";
  private nameInputEl: HTMLInputElement | null = null;
  private nameErrorEl: HTMLElement | null = null;
  private nameCountEl: HTMLElement | null = null;
  private folderInputEl: HTMLInputElement | null = null;
  private scopeWarningEl: HTMLElement | null = null;
  private submitButtonEl: HTMLButtonElement | null = null;

  constructor(
    private readonly plugin: EntVaultCommandCenterPlugin,
    private readonly onCreated?: (entry: KnowledgeBaseEntry) => void,
  ) {
    super(plugin.app);
  }

  onOpen(): void {
    this.modalEl.addClass("ent-cc-knowledge-base-modal");
    this.contentEl.addClass("ent-cc-modal");
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    this.titleEl.setText("New knowledge base");
    this.contentEl.createEl("p", {
      text: "Create an independent index with its own folders, headings, subjects, collections, templates, study state, and history. Existing notes are never moved.",
    });
    this.contentEl.createDiv({
      cls: "ent-cc-base-terminology-note",
      text: "In this plugin, a knowledge base is an independent index profile—not an Obsidian .base file or a saved Workspace layout.",
    });

    new Setting(this.contentEl)
      .setName("Name")
      .setDesc("For example: ENT, research, general medicine, or board review.")
      .addText((text) => {
        this.nameInputEl = text.inputEl;
        text.inputEl.maxLength = 100;
        text.inputEl.dir = "auto";
        text.inputEl.setAttribute("aria-required", "true");
        text
          .setPlaceholder("Research")
          .setValue(this.name)
          .onChange((value) => {
            this.name = value;
            if (!this.folderEdited) {
              this.folder = this.suggestedFolder(value);
              if (this.folderInputEl) this.folderInputEl.value = this.folder;
              this.renderScopeWarning();
            }
            this.error = "";
            this.updateNameFeedback();
          });
      });
    const feedback = this.contentEl.createDiv({ cls: "ent-cc-base-name-feedback", attr: { "aria-live": "polite" } });
    this.nameErrorEl = feedback.createSpan({ cls: "ent-cc-base-name-error" });
    this.nameCountEl = feedback.createSpan({ cls: "ent-cc-base-name-count" });

    new Setting(this.contentEl)
      .setName("Preset")
      .setDesc(this.mode === "ent-clinical"
        ? "Uses the protected ENT proposal and clinical review workflow."
        : "Works with any folder-based collection of Markdown notes.")
      .addDropdown((dropdown) => dropdown
        .addOptions({ generic: "Generic knowledge base", "ent-clinical": "ENT clinical preset" })
        .setValue(this.mode)
        .onChange((value) => {
          this.mode = value as WorkspaceMode;
          this.render();
        }));

    if (this.mode === "generic") {
      new Setting(this.contentEl)
        .setName("Indexed notes folder")
        .setDesc("This is the base's automatic index scope. Use a separate folder for an independent index, or intentionally overlap another base to share notes.")
        .addText((text) => {
          this.folderInputEl = text.inputEl;
          text.setPlaceholder("Knowledge bases/research")
            .setValue(this.folder)
            .onChange((value) => {
            this.folder = value;
            this.folderEdited = true;
            this.renderScopeWarning();
            this.updateNameFeedback();
          });
        });
      this.scopeWarningEl = this.contentEl.createDiv({
        cls: "ent-cc-base-scope-warning is-hidden",
        attr: { role: "status" },
      });
      this.renderScopeWarning();
    } else {
      this.contentEl.createDiv({
        cls: "ent-cc-base-scope-summary",
        text: "ENT preset scope: 03 Clinical Topics, with proposals under 01 Inbox.",
      });
    }

    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").setDisabled(this.busy).onClick(() => this.close()))
      .addButton((button) => {
        this.submitButtonEl = button.buttonEl;
        button.setButtonText("Create and switch").setCta().onClick(() => void this.submit());
      });
    this.updateNameFeedback();
  }

  private updateNameFeedback(): void {
    this.nameErrorEl?.setText(this.error);
    this.nameCountEl?.setText(`${this.name.length}/100`);
    this.nameInputEl?.setAttribute("aria-invalid", String(Boolean(this.error)));
    if (this.submitButtonEl) this.submitButtonEl.disabled = this.busy
      || !this.name.trim()
      || (this.mode === "generic" && !this.folder.trim());
  }

  private suggestedFolder(name: string): string {
    const segment = sanitizeFileName(name).slice(0, 80) || "Research";
    return `Knowledge Bases/${segment}`;
  }

  private renderScopeWarning(): void {
    const warning = this.scopeWarningEl;
    if (!warning || this.mode !== "generic") return;
    const folder = this.folder.trim().replace(/^\/+|\/+$/g, "");
    if (!folder) {
      warning.setText("Choose a folder for this base's automatic index. You can still add notes from other folders manually.");
      warning.removeClass("is-hidden");
      return;
    }
    const overlap = this.plugin.getKnowledgeBases().find((entry) => {
      const existing = entry.data.settings.primaryFolder.trim().replace(/^\/+|\/+$/g, "");
      return !existing || folder === existing || folder.startsWith(`${existing}/`) || existing.startsWith(`${folder}/`);
    });
    if (!overlap) {
      warning.setText("");
      warning.addClass("is-hidden");
      return;
    }
    warning.setText(`This scope overlaps “${overlap.data.settings.workspaceName}” (${overlap.data.settings.primaryFolder || "Vault root"}). Shared notes are allowed, but choose a separate folder if you want an empty independent index.`);
    warning.removeClass("is-hidden");
  }

  private async submit(): Promise<void> {
    if (this.busy) return;
    if (!this.name.trim()) {
      this.error = "Enter a name for this knowledge base.";
      this.updateNameFeedback();
      this.nameInputEl?.focus();
      return;
    }
    if (this.mode === "generic" && !this.folder.trim()) {
      this.error = "Choose an indexed notes folder so this base has an explicit scope.";
      this.updateNameFeedback();
      return;
    }
    this.busy = true;
    this.render();
    try {
      const entry = await this.plugin.createKnowledgeBase(this.name, this.mode, this.folder);
      this.close();
      this.onCreated?.(entry);
      new Notice(`Created and opened “${entry.data.settings.workspaceName}”.`);
    } catch (error) {
      this.busy = false;
      this.error = error instanceof Error ? error.message : String(error);
      this.render();
      console.error("Knowledge Base Command Center could not create the base", error);
      window.setTimeout(() => this.nameInputEl?.focus(), 0);
    }
  }
}

class DeleteArchivedKnowledgeBaseModal extends Modal {
  private readonly entryId: string;
  private readonly entryName: string;
  private readonly expectedUpdatedAt: number;
  private readonly openedBaseId: string;
  private readonly openedDataEpoch: number;
  private confirmation = "";
  private busy = false;
  private confirmButtonEl: HTMLButtonElement | null = null;
  private errorEl: HTMLElement | null = null;

  constructor(
    private readonly plugin: EntVaultCommandCenterPlugin,
    entry: KnowledgeBaseEntry,
    private readonly onDeleted: () => void,
  ) {
    super(plugin.app);
    this.entryId = entry.id;
    this.entryName = entry.data.settings.workspaceName;
    this.expectedUpdatedAt = entry.updatedAt;
    this.openedBaseId = plugin.getActiveKnowledgeBaseId();
    this.openedDataEpoch = plugin.getDataEpoch();
  }

  onOpen(): void {
    this.modalEl.addClass("ent-cc-knowledge-base-modal", "ent-cc-destructive-base-modal");
    this.contentEl.addClass("ent-cc-modal");
    this.titleEl.setText("Permanently delete archived base?");
    this.contentEl.createEl("p", {
      text: `This permanently removes “${this.entryName}” and all of its plugin-owned headings, memberships, collections, pins, views, settings, snapshots, and Undo history. It cannot be restored from the plugin afterward.`,
    });
    this.contentEl.createDiv({
      cls: "ent-cc-base-delete-warning",
      text: "Recommended first: restore this base, switch to it, and export Same-vault recovery. Keep that private exact-path JSON securely, then archive the base again.",
    });
    this.contentEl.createDiv({
      cls: "ent-cc-base-delete-safety",
      text: "Markdown notes and attachments are outside this deletion. No vault file will be deleted, moved, renamed, or edited.",
    });
    new Setting(this.contentEl)
      .setName("Type the knowledge-base name to confirm")
      .setDesc(this.entryName)
      .addText((text) => {
        text.inputEl.maxLength = 100;
        text.inputEl.dir = "auto";
        text.inputEl.autocomplete = "off";
        text.inputEl.spellcheck = false;
        text.inputEl.setAttribute("aria-required", "true");
        text.setPlaceholder(this.entryName).onChange((value) => {
          this.confirmation = value;
          this.updateConfirmationState();
        });
      });
    this.errorEl = this.contentEl.createDiv({
      cls: "ent-cc-base-name-error",
      attr: { role: "alert", "aria-live": "assertive" },
    });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => {
        this.confirmButtonEl = button.buttonEl;
        button.setButtonText("Permanently delete base").setDestructive().onClick(() => void this.submit());
      });
    this.updateConfirmationState();
  }

  private updateConfirmationState(): void {
    const matches = this.confirmation.normalize("NFC") === this.entryName.normalize("NFC");
    if (this.confirmButtonEl) this.confirmButtonEl.disabled = this.busy || !matches;
  }

  private async submit(): Promise<void> {
    if (this.busy || this.confirmation.normalize("NFC") !== this.entryName.normalize("NFC")) return;
    if (this.plugin.getActiveKnowledgeBaseId() !== this.openedBaseId || this.plugin.getDataEpoch() !== this.openedDataEpoch) {
      new Notice("Knowledge-base data changed while this confirmation was open. Nothing was deleted; review the archived base again.", 8000);
      this.close();
      return;
    }
    this.busy = true;
    this.errorEl?.setText("");
    this.updateConfirmationState();
    try {
      await this.plugin.deleteArchivedKnowledgeBase(this.entryId, this.expectedUpdatedAt);
      this.close();
      try {
        this.onDeleted();
      } catch (error) {
        console.error("Knowledge Base Command Center deleted the archived base but could not refresh the manager", error);
      }
      new Notice(`Permanently deleted plugin organization for “${this.entryName}”. Markdown notes were not changed.`, 8000);
    } catch (error) {
      this.busy = false;
      this.errorEl?.setText(error instanceof Error ? error.message : String(error));
      this.updateConfirmationState();
      console.error("Knowledge Base Command Center could not permanently delete the archived base", error);
    }
  }
}

export class ManageKnowledgeBasesModal extends Modal {
  constructor(private readonly plugin: EntVaultCommandCenterPlugin) {
    super(plugin.app);
  }

  onOpen(): void {
    this.modalEl.addClass("ent-cc-knowledge-base-modal");
    this.contentEl.addClass("ent-cc-modal", "ent-cc-knowledge-base-manager");
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    this.titleEl.setText("Manage knowledge bases");
    this.contentEl.createEl("p", {
      text: "Each knowledge base has independent plugin organization. The same Markdown note may belong to more than one base, and archiving a base never deletes a note.",
    });
    this.contentEl.createDiv({
      cls: "ent-cc-base-terminology-note",
      text: "These are plugin index profiles—not Obsidian .base files or saved Workspace layouts.",
    });

    const toolbar = this.contentEl.createDiv({ cls: "ent-cc-base-manager-toolbar" });
    const create = toolbar.createEl("button", { cls: "ent-cc-button ent-cc-add-button", type: "button" });
    setIcon(create.createSpan(), "plus");
    create.createSpan({ text: "New knowledge base" });
    create.addEventListener("click", () => {
      this.close();
      new CreateKnowledgeBaseModal(this.plugin).open();
    });

    const available = this.plugin.getKnowledgeBases();
    const archived = this.plugin.getKnowledgeBases(true).filter((entry) => entry.archivedAt !== null);
    const list = this.contentEl.createDiv({ cls: "ent-cc-base-manager-list" });
    for (const entry of available) this.renderEntry(list, entry, false, available.length);

    if (archived.length > 0) {
      this.contentEl.createEl("h3", { text: "Archived" });
      const archivedList = this.contentEl.createDiv({ cls: "ent-cc-base-manager-list" });
      for (const entry of archived) this.renderEntry(archivedList, entry, true, available.length);
    }

    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Close").onClick(() => this.close()));
  }

  private renderEntry(parent: HTMLElement, entry: KnowledgeBaseEntry, archived: boolean, availableCount: number): void {
    const active = entry.id === this.plugin.getActiveKnowledgeBaseId();
    const row = parent.createDiv({ cls: `ent-cc-base-manager-row ${active ? "is-active" : ""}` });
    const text = row.createDiv({ cls: "ent-cc-base-manager-text" });
    const title = text.createDiv({ cls: "ent-cc-base-manager-title" });
    title.createSpan({ text: entry.data.settings.workspaceName });
    if (active) title.createSpan({ cls: "ent-cc-base-active-badge", text: "Current" });
    const activeIndexCount = active ? this.plugin.getIndexRecords().length : null;
    text.createDiv({
      cls: "ent-cc-picker-meta",
      text: [
        entry.data.settings.workspaceMode === "ent-clinical" ? "ENT clinical" : "Generic",
        entry.data.settings.primaryFolder || "Vault root",
        activeIndexCount === null
          ? `${entry.data.portableIndex.subjects.filter((subject) => subject.indexed).length} portable identities`
          : `${activeIndexCount} index entries`,
        `${entry.data.collections.length} collections`,
      ].join(" · "),
    });
    const actions = row.createDiv({ cls: "ent-cc-base-manager-actions" });
    if (archived) {
      this.actionButton(actions, "archive-restore", "Restore", () => void this.run(async () => {
        await this.plugin.restoreKnowledgeBase(entry.id);
        this.render();
      }));
      const remove = this.actionButton(actions, "trash-2", "Delete permanently", () => {
        new DeleteArchivedKnowledgeBaseModal(this.plugin, entry, () => this.render()).open();
      });
      remove.addClass("mod-warning");
      return;
    }
    if (!active) this.actionButton(actions, "check", "Switch", () => void this.run(async () => {
      await this.plugin.switchKnowledgeBase(entry.id);
      this.close();
    }));
    this.actionButton(actions, "pencil", "Rename", () => {
      new TextPromptModal(this.app, {
        title: "Rename knowledge base",
        placeholder: "Knowledge-base name",
        initialValue: entry.data.settings.workspaceName,
        onSubmit: async (name) => {
          await this.plugin.renameKnowledgeBase(entry.id, name);
          this.render();
        },
      }).open();
    });
    this.actionButton(actions, "copy", "Duplicate", () => {
      new TextPromptModal(this.app, {
        title: `Duplicate “${entry.data.settings.workspaceName}”`,
        placeholder: "Duplicate name",
        initialValue: `${entry.data.settings.workspaceName} copy`,
        submitLabel: "Duplicate and switch",
        onSubmit: async (name) => {
          const duplicate = await this.plugin.duplicateKnowledgeBase(entry.id, name);
          this.close();
          new Notice(`Created and opened “${duplicate.data.settings.workspaceName}”.`);
        },
      }).open();
    });
    const archive = this.actionButton(actions, "archive", "Archive", () => {
      const subjects = active
        ? this.plugin.getIndexRecords().length
        : entry.data.portableIndex.subjects.filter((subject) => subject.indexed).length;
      const countLabel = active ? "index entries" : "portable identities";
      const fallback = active
        ? this.plugin.getKnowledgeBases().find((candidate) => candidate.id !== entry.id)?.data.settings.workspaceName
        : "";
      new ConfirmModal(
        this.app,
        "Archive knowledge base?",
        `“${entry.data.settings.workspaceName}” will leave the switcher but remain fully restorable.${fallback ? ` The Command Center will switch to “${fallback}”.` : ""} Its ${subjects} ${countLabel}, collections, pins, views, and history stay in plugin data. No Markdown note will be deleted, moved, or changed.`,
        "Archive base",
        async () => {
          await this.plugin.archiveKnowledgeBase(entry.id);
          if (active) this.close(); else this.render();
        },
      ).open();
    }, availableCount <= 1);
    if (availableCount <= 1) archive.title = "At least one knowledge base must remain available.";
  }

  private actionButton(parent: HTMLElement, icon: string, label: string, action: () => void, disabled = false): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: "ent-cc-button ent-cc-base-manager-action",
      type: "button",
      attr: { "aria-label": label, title: label },
    });
    setIcon(button.createSpan(), icon);
    button.createSpan({ text: label });
    button.disabled = disabled;
    button.addEventListener("click", action);
    return button;
  }

  private async run(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      reportError(error);
    }
  }
}
