import { App, FuzzyMatch, FuzzySuggestModal, Modal, Notice, Setting, TFile, setIcon } from "obsidian";
import {
  canonicalPath,
  DOMAIN_DEFINITIONS,
  expectedParentCurriculumId,
  GenericNoteFormValue,
  genericNotePath,
  isExtensionCurriculumId,
  LayoutHeading,
  NewNoteMode,
  pathIsInsideFolder,
  proposalPath,
  TOPIC_KINDS,
  TopicFormValue,
  PluginSettings,
  VaultRecord,
} from "./model";

function reportAsyncError(error: unknown): void {
  console.error("ENT Command Center action failed", error);
  new Notice(error instanceof Error ? error.message : String(error));
}

export class TextPromptModal extends Modal {
  constructor(
    app: App,
    private readonly options: {
      title: string;
      placeholder: string;
      initialValue?: string;
      submitLabel?: string;
      onSubmit: (value: string) => void | Promise<void>;
    },
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.addClass("ent-cc-modal");
    this.titleEl.setText(this.options.title);
    let value = this.options.initialValue ?? "";
    let input: HTMLInputElement | null = null;
    new Setting(this.contentEl).addText((control) => {
      control.setPlaceholder(this.options.placeholder).setValue(value).onChange((next) => { value = next; });
      input = control.inputEl;
      control.inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void this.submit(value);
        }
      });
    });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setButtonText(this.options.submitLabel ?? "Save").setCta().onClick(() => void this.submit(value)));
    window.activeWindow.setTimeout(() => input?.focus(), 40);
  }

  private async submit(raw: string): Promise<void> {
    const value = raw.trim();
    if (!value) {
      new Notice("Enter a name first.");
      return;
    }
    try {
      await this.options.onSubmit(value);
      this.close();
    } catch (error) {
      reportAsyncError(error);
    }
  }
}

export class ConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly titleText: string,
    private readonly message: string,
    private readonly confirmLabel: string,
    private readonly onConfirm: () => void | Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.addClass("ent-cc-modal");
    this.titleEl.setText(this.titleText);
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setButtonText(this.confirmLabel).setWarning().onClick(async () => {
        try {
          await this.onConfirm();
          this.close();
        } catch (error) {
          reportAsyncError(error);
        }
      }));
  }
}

export interface CollectionTarget {
  headingId: string;
  subheadingId?: string;
  label: string;
}

export function collectionTargets(collections: LayoutHeading[]): CollectionTarget[] {
  return collections.flatMap((heading) => [
    { headingId: heading.id, label: heading.title },
    ...heading.subheadings.map((subheading) => ({
      headingId: heading.id,
      subheadingId: subheading.id,
      label: `${heading.title} / ${subheading.title}`,
    })),
  ]);
}

export class CollectionPickerModal extends FuzzySuggestModal<CollectionTarget> {
  constructor(
    app: App,
    private readonly targets: CollectionTarget[],
    private readonly action: "Add" | "Move",
    private readonly onChoose: (target: CollectionTarget) => void | Promise<void>,
  ) {
    super(app);
    this.setPlaceholder(`${action} to collection…`);
  }

  getItems(): CollectionTarget[] { return this.targets; }
  getItemText(item: CollectionTarget): string { return item.label; }
  onChooseItem(item: CollectionTarget): void { void Promise.resolve(this.onChoose(item)).catch(reportAsyncError); }

  onOpen(): void {
    super.onOpen();
    this.modalEl.addClass("ent-cc-modal");
    this.titleEl.setText(`${this.action} to collection`);
  }
}

export interface AddAction {
  id: string;
  title: string;
  description: string;
  icon: string;
}

export class AddActionModal extends FuzzySuggestModal<AddAction> {
  constructor(
    app: App,
    private readonly actions: AddAction[],
    private readonly onChoose: (action: AddAction) => void,
    private readonly heading = "Add to Command Center",
  ) {
    super(app);
    this.setPlaceholder("Add or create…");
  }

  getItems(): AddAction[] { return this.actions; }
  getItemText(item: AddAction): string { return `${item.title} ${item.description}`; }
  onChooseItem(item: AddAction): void { this.onChoose(item); }

  renderSuggestion(match: FuzzyMatch<AddAction>, element: HTMLElement): void {
    const item = match.item;
    element.addClass("ent-cc-action-suggestion");
    const icon = element.createSpan({ cls: "ent-cc-action-suggestion-icon" });
    setIcon(icon, item.icon);
    const text = element.createDiv();
    text.createDiv({ cls: "ent-cc-action-suggestion-title", text: item.title });
    text.createDiv({ cls: "ent-cc-action-suggestion-description", text: item.description });
  }

  onOpen(): void {
    super.onOpen();
    this.modalEl.addClass("ent-cc-modal", "ent-cc-add-modal");
    this.titleEl.setText(this.heading);
  }
}

export class RecordPickerModal extends FuzzySuggestModal<VaultRecord> {
  constructor(
    app: App,
    private readonly records: VaultRecord[],
    title: string,
    placeholder: string,
    private readonly onChoose: (record: VaultRecord) => void | Promise<void>,
  ) {
    super(app);
    this.titleEl.setText(title);
    this.setPlaceholder(placeholder);
  }

  getItems(): VaultRecord[] { return this.records; }
  getItemText(item: VaultRecord): string { return `${item.title} ${item.curriculumId} ${item.path}`; }
  onChooseItem(item: VaultRecord): void { void Promise.resolve(this.onChoose(item)).catch(reportAsyncError); }

  renderSuggestion(match: FuzzyMatch<VaultRecord>, element: HTMLElement): void {
    const item = match.item;
    element.createDiv({ text: item.title });
    element.createDiv({ cls: "ent-cc-picker-meta", text: [item.curriculumId, item.domain, item.path].filter(Boolean).join(" · ") });
  }

  onOpen(): void {
    super.onOpen();
    this.modalEl.addClass("ent-cc-modal");
  }
}

export class VaultFilePickerModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private readonly files: TFile[],
    private readonly titleText: string,
    private readonly onChoose: (file: TFile) => void | Promise<void>,
  ) {
    super(app);
    this.setPlaceholder("Search Markdown notes by name or path…");
  }

  getItems(): TFile[] { return this.files; }
  getItemText(item: TFile): string { return `${item.basename} ${item.path}`; }
  onChooseItem(item: TFile): void { void Promise.resolve(this.onChoose(item)).catch(reportAsyncError); }

  renderSuggestion(match: FuzzyMatch<TFile>, element: HTMLElement): void {
    const item = match.item;
    element.createDiv({ text: item.basename });
    element.createDiv({ cls: "ent-cc-picker-meta", text: item.path });
  }

  onOpen(): void {
    super.onOpen();
    this.modalEl.addClass("ent-cc-modal");
    this.titleEl.setText(this.titleText);
  }
}

export class StringPickerModal extends FuzzySuggestModal<string> {
  constructor(
    app: App,
    private readonly values: string[],
    private readonly titleText: string,
    placeholder: string,
    private readonly onChoose: (value: string) => void | Promise<void>,
  ) {
    super(app);
    this.setPlaceholder(placeholder);
  }

  getItems(): string[] { return this.values; }
  getItemText(item: string): string { return item; }
  onChooseItem(item: string): void { void Promise.resolve(this.onChoose(item)).catch(reportAsyncError); }

  onOpen(): void {
    super.onOpen();
    this.modalEl.addClass("ent-cc-modal");
    this.titleEl.setText(this.titleText);
  }
}

export class IndexGroupModal extends Modal {
  constructor(
    app: App,
    private readonly options: {
      title: string;
      groupLabel: string;
      initialValue: string;
      existingGroups: string[];
      submitLabel: string;
      onSubmit: (group: string) => void | Promise<void>;
    },
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.addClass("ent-cc-modal");
    this.titleEl.setText(this.options.title);
    let value = this.options.initialValue;
    let input: HTMLInputElement | null = null;
    const setting = new Setting(this.contentEl)
      .setName(this.options.groupLabel)
      .setDesc(`Choose an existing ${this.options.groupLabel.toLowerCase()} or type a new name. This changes only the visual index.`)
      .addText((text) => {
        text.setPlaceholder(`New ${this.options.groupLabel.toLowerCase()}`).setValue(value).onChange((next) => { value = next; });
        input = text.inputEl;
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") { event.preventDefault(); void this.submit(value); }
        });
      });
    setting.addButton((button) => button.setButtonText("Choose existing…").setDisabled(this.options.existingGroups.length === 0).onClick(() => {
      new StringPickerModal(this.app, this.options.existingGroups, `Choose ${this.options.groupLabel.toLowerCase()}`, `Search ${this.options.groupLabel.toLowerCase()}s…`, (group) => {
        value = group;
        if (input) input.value = group;
      }).open();
    }));
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setButtonText(this.options.submitLabel).setCta().onClick(() => void this.submit(value)));
    window.activeWindow.setTimeout(() => input?.focus(), 40);
  }

  private async submit(raw: string): Promise<void> {
    const group = raw.trim();
    if (!group) { new Notice(`Enter a ${this.options.groupLabel.toLowerCase()} name first.`); return; }
    try {
      await this.options.onSubmit(group);
      this.close();
    } catch (error) {
      reportAsyncError(error);
    }
  }
}

export interface KnowledgeNoteModalOptions {
  itemSingular: string;
  templates: TFile[];
  initial: GenericNoteFormValue;
  validate: (value: GenericNoteFormValue) => string | null;
  onSubmit: (value: GenericNoteFormValue) => void | Promise<void>;
}

export class KnowledgeNoteModal extends Modal {
  private value: GenericNoteFormValue;
  private pathEl: HTMLElement | null = null;
  private templateButton: HTMLButtonElement | null = null;
  private errorEl: HTMLElement | null = null;

  constructor(app: App, private readonly options: KnowledgeNoteModalOptions) {
    super(app);
    this.value = { ...options.initial };
  }

  onOpen(): void {
    this.contentEl.empty();
    this.modalEl.addClass("ent-cc-topic-editor-modal");
    this.contentEl.addClass("ent-cc-modal", "ent-cc-topic-editor");
    this.titleEl.setText(`Create ${this.options.itemSingular}`);
    this.contentEl.createEl("p", {
      cls: "ent-cc-modal-lead",
      text: "Choose a destination and start with a truly empty note or a copied Markdown template. Existing files are never overwritten.",
    });

    new Setting(this.contentEl)
      .setName("Title")
      .addText((text) => {
        text.setPlaceholder(`New ${this.options.itemSingular}`).setValue(this.value.title).onChange((value) => {
          this.value.title = value;
          this.updatePreview();
        });
        window.activeWindow.setTimeout(() => text.inputEl.focus(), 40);
      });

    new Setting(this.contentEl)
      .setName("Destination folder")
      .setDesc("Vault-relative folder. Leave empty to create at the vault root.")
      .addText((text) => text.setPlaceholder("Vault root").setValue(this.value.folder).onChange((value) => {
        this.value.folder = value;
        this.updatePreview();
      }));

    new Setting(this.contentEl)
      .setName("Starting content")
      .addDropdown((dropdown) => dropdown
        .addOptions({ empty: "Empty note", template: "Copy a template" })
        .setValue(this.value.mode)
        .onChange((value) => {
          this.value.mode = value as GenericNoteFormValue["mode"];
          this.updateTemplateButton();
          this.updatePreview();
        }));

    new Setting(this.contentEl)
      .setName("Template")
      .setDesc("Supports {{title}}, {{date}}, and {{time}}. Other template syntax is copied unchanged.")
      .addButton((button) => {
        this.templateButton = button.buttonEl;
        button.onClick(() => {
          if (this.value.mode !== "template") return;
          if (this.options.templates.length === 0) {
            new Notice("No Markdown templates were found in the configured templates folder.");
            return;
          }
          new VaultFilePickerModal(this.app, this.options.templates, "Choose a note template", (file) => {
            this.value.templatePath = file.path;
            this.updateTemplateButton();
            this.updatePreview();
          }).open();
        });
        this.updateTemplateButton();
      });

    new Setting(this.contentEl)
      .setName("Add to a collection after creation")
      .addToggle((toggle) => toggle.setValue(this.value.addToCollection).onChange((value) => { this.value.addToCollection = value; }));

    const preview = this.contentEl.createDiv({ cls: "ent-cc-path-preview" });
    preview.createDiv({ cls: "ent-cc-path-preview-label", text: "New note path" });
    this.pathEl = preview.createDiv({ cls: "ent-cc-path-preview-value" });
    this.errorEl = this.contentEl.createDiv({ cls: "ent-cc-form-error", attr: { role: "alert", "aria-live": "polite" } });
    this.updatePreview();

    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setButtonText(`Create ${this.options.itemSingular}`).setCta().onClick(() => void this.submit()))
      .settingEl.addClass("ent-cc-modal-footer");
  }

  private updateTemplateButton(): void {
    if (!this.templateButton) return;
    this.templateButton.disabled = this.value.mode !== "template";
    this.templateButton.setText(this.value.mode === "empty"
      ? "Not used for empty note"
      : this.value.templatePath.split("/").pop()?.replace(/\.md$/, "") || "Choose template…");
  }

  private updatePreview(): void {
    this.pathEl?.setText(genericNotePath(this.value.folder, this.value.title || `Untitled ${this.options.itemSingular}`));
    this.errorEl?.setText("");
  }

  private async submit(): Promise<void> {
    this.value.title = this.value.title.trim();
    this.value.folder = this.value.folder.trim().replace(/^\/+|\/+$/g, "");
    const error = this.options.validate(this.value);
    if (error) { this.errorEl?.setText(error); return; }
    try {
      await this.options.onSubmit({ ...this.value });
      this.close();
    } catch (error) {
      this.errorEl?.setText(error instanceof Error ? error.message : String(error));
    }
  }
}

export interface WorkspaceSetupValue {
  workspaceName: string;
  workspaceSubtitle: string;
  indexLabel: string;
  itemSingular: string;
  itemPlural: string;
  groupLabel: string;
  primaryFolder: string;
  proposalFolder: string;
  inboxLabel: string;
  defaultNoteFolder: string;
  idProperty: string;
  groupProperty: string;
  parentProperty: string;
  templatesFolder: string;
  defaultNewNoteMode: NewNoteMode;
  defaultTemplatePath: string;
}

export class WorkspaceSetupModal extends Modal {
  private value: WorkspaceSetupValue;
  private errorEl: HTMLElement | null = null;

  constructor(app: App, initial: PluginSettings, private readonly onSubmit: (value: WorkspaceSetupValue) => void | Promise<void>) {
    super(app);
    this.value = {
      workspaceName: initial.workspaceName,
      workspaceSubtitle: initial.workspaceSubtitle,
      indexLabel: initial.indexLabel,
      itemSingular: initial.itemSingular,
      itemPlural: initial.itemPlural,
      groupLabel: initial.groupLabel,
      primaryFolder: initial.primaryFolder,
      proposalFolder: initial.proposalFolder,
      inboxLabel: initial.inboxLabel,
      defaultNoteFolder: initial.defaultNoteFolder,
      idProperty: initial.idProperty,
      groupProperty: initial.groupProperty,
      parentProperty: initial.parentProperty,
      templatesFolder: initial.templatesFolder,
      defaultNewNoteMode: initial.defaultNewNoteMode,
      defaultTemplatePath: initial.defaultTemplatePath,
    };
  }

  onOpen(): void {
    this.contentEl.empty();
    this.modalEl.addClass("ent-cc-topic-editor-modal");
    this.contentEl.addClass("ent-cc-modal", "ent-cc-topic-editor");
    this.titleEl.setText("Set up your knowledge base");
    this.contentEl.createEl("p", { cls: "ent-cc-modal-lead", text: "This configures only the plugin view. Existing notes stay exactly where they are." });
    const textField = (name: string, description: string, key: Exclude<keyof WorkspaceSetupValue, "defaultNewNoteMode">, placeholder: string): void => {
      new Setting(this.contentEl).setName(name).setDesc(description).addText((text) => text
        .setPlaceholder(placeholder)
        .setValue(this.value[key])
        .onChange((value) => { this.value[key] = value; }));
    };
    textField("Command center name", "You can change it later in Settings.", "workspaceName", "My Knowledge Base");
    textField("Header description", "Short explanation shown below the command center name.", "workspaceSubtitle", "Search, organize, arrange, and create notes.");
    textField("Index name", "For example: Knowledge Index, Projects, Research Library.", "indexLabel", "Knowledge Index");
    textField("Item singular", "For example: note, project, paper.", "itemSingular", "note");
    textField("Item plural", "For example: notes, projects, papers.", "itemPlural", "notes");
    textField("Group name", "For example: Category, Area, Course, or Department.", "groupLabel", "Group");
    textField("Indexed notes folder", "All Markdown notes below it appear in the index.", "primaryFolder", "Knowledge Base");
    textField("Inbox folder", "Notes here appear in the separate Inbox section.", "proposalFolder", "Inbox");
    textField("Inbox name", "Name shown on the Inbox tab.", "inboxLabel", "Inbox");
    textField("Default new-note folder", "Initial destination when creating a note.", "defaultNoteFolder", "Knowledge Base");
    textField("ID property", "Optional property shown beside each indexed note.", "idProperty", "id");
    textField("Group property", "Falls back to the first subfolder when absent.", "groupProperty", "category");
    textField("Parent property", "Optional wikilink/title used for default nesting.", "parentProperty", "parent");
    textField("Templates folder", "Leave empty to allow any Markdown note as a template.", "templatesFolder", "Templates");

    new Setting(this.contentEl)
      .setName("Default starting content")
      .setDesc("You can override this for every note you create.")
      .addDropdown((dropdown) => dropdown
        .addOptions({ empty: "Empty note", template: "Selected template" })
        .setValue(this.value.defaultNewNoteMode)
        .onChange((value) => { this.value.defaultNewNoteMode = value as NewNoteMode; }));

    new Setting(this.contentEl)
      .setName("Default template")
      .setDesc("Optional. Supports {{title}}, {{date}}, and {{time}}.")
      .addButton((button) => {
        const update = (): void => { button.setButtonText(this.value.defaultTemplatePath.split("/").pop()?.replace(/\.md$/, "") || "Choose template…"); };
        update();
        button.onClick(() => {
          const root = this.value.templatesFolder.trim().replace(/^\/+|\/+$/g, "");
          const templates = this.app.vault.getMarkdownFiles().filter((file) => !root || pathIsInsideFolder(file.path, root));
          if (templates.length === 0) {
            new Notice("No Markdown templates were found in that folder.");
            return;
          }
          new VaultFilePickerModal(this.app, templates, "Choose a default note template", (file) => {
            this.value.defaultTemplatePath = file.path;
            update();
          }).open();
        });
      });
    this.errorEl = this.contentEl.createDiv({ cls: "ent-cc-form-error", attr: { role: "alert" } });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setButtonText("Finish setup").setCta().onClick(() => void this.submit()));
  }

  private async submit(): Promise<void> {
    for (const key of ["workspaceName", "indexLabel", "itemSingular", "itemPlural", "groupLabel", "inboxLabel"] as const) {
      this.value[key] = this.value[key].trim();
      if (!this.value[key]) { this.errorEl?.setText("Name and item labels cannot be empty."); return; }
    }
    this.value.workspaceSubtitle = this.value.workspaceSubtitle.trim();
    for (const key of ["primaryFolder", "proposalFolder", "defaultNoteFolder", "templatesFolder"] as const) this.value[key] = this.value[key].trim().replace(/^\/+|\/+$/g, "");
    for (const key of ["idProperty", "groupProperty", "parentProperty"] as const) this.value[key] = this.value[key].trim();
    this.value.defaultTemplatePath = this.value.defaultTemplatePath.trim().replace(/^\/+/, "");
    if (this.value.defaultNewNoteMode === "template" && !this.value.defaultTemplatePath) {
      this.errorEl?.setText("Choose a default template, or use Empty note as the default.");
      return;
    }
    try {
      await this.onSubmit({ ...this.value });
      this.close();
    } catch (error) {
      this.errorEl?.setText(error instanceof Error ? error.message : String(error));
    }
  }
}

export type TopicEditorMode = "proposal" | "canonical" | "promote" | "placement";

export interface TopicEditorOptions {
  mode: TopicEditorMode;
  title: string;
  submitLabel: string;
  proposalFolder: string;
  canonicalRecords: VaultRecord[];
  initial?: Partial<TopicFormValue>;
  validate: (value: TopicFormValue) => string | null;
  resolveExpectedParentPath?: (value: TopicFormValue) => string;
  previewDetails?: (value: TopicFormValue) => string[];
  onSubmit: (value: TopicFormValue) => void | Promise<void>;
}

class ParentTopicPickerModal extends FuzzySuggestModal<VaultRecord> {
  constructor(app: App, private readonly records: VaultRecord[], private readonly onChoose: (record: VaultRecord) => void) {
    super(app);
    this.setPlaceholder("Search canonical parent topics…");
  }
  getItems(): VaultRecord[] { return this.records; }
  getItemText(item: VaultRecord): string { return `${item.title} ${item.curriculumId}`; }
  onChooseItem(item: VaultRecord): void { this.onChoose(item); }
  renderSuggestion(match: FuzzyMatch<VaultRecord>, element: HTMLElement): void {
    const item = match.item;
    element.createDiv({ text: item.title });
    element.createDiv({ cls: "ent-cc-picker-meta", text: `${item.curriculumId} · ${item.domain}` });
  }
}

export class TopicEditorModal extends Modal {
  private value: TopicFormValue;
  private previewEl: HTMLElement | null = null;
  private errorEl: HTMLElement | null = null;
  private parentLabelEl: HTMLElement | null = null;
  private detailsEl: HTMLElement | null = null;
  private confirmed = false;

  constructor(app: App, private readonly options: TopicEditorOptions) {
    super(app);
    this.value = {
      title: options.initial?.title ?? "",
      domain: options.initial?.domain ?? DOMAIN_DEFINITIONS[0].name,
      parentPath: options.initial?.parentPath ?? "",
      topicKind: options.initial?.topicKind ?? "condition",
      priority: options.initial?.priority ?? "P2",
      safetyCritical: options.initial?.safetyCritical ?? false,
      curriculumId: options.initial?.curriculumId ?? "",
      addToCollection: options.initial?.addToCollection ?? true,
    };
  }

  onOpen(): void {
    this.contentEl.empty();
    this.modalEl.addClass("ent-cc-topic-editor-modal");
    this.contentEl.addClass("ent-cc-modal", "ent-cc-topic-editor");
    this.titleEl.setText(this.options.title);
    this.contentEl.createEl("p", {
      cls: "ent-cc-modal-lead",
      text: this.options.mode === "proposal"
        ? "Capture an unverified proposal in the Inbox. It will not enter the canonical curriculum until you promote it."
        : "This is a structural operation only. The resulting topic remains unverified and contains no clinical claims.",
    });

    new Setting(this.contentEl)
      .setName("Topic title")
      .setDesc("Used for the note title and filename.")
      .addText((text) => {
        text.setPlaceholder("e.g. Velopharyngeal insufficiency").setValue(this.value.title).onChange((value) => {
          this.value.title = value;
          this.updatePreview();
        });
        window.activeWindow.setTimeout(() => text.inputEl.focus(), 40);
      });

    new Setting(this.contentEl)
      .setName("ENT domain")
      .setDesc("Controls the canonical domain folder when promoted.")
      .addDropdown((dropdown) => {
        for (const definition of DOMAIN_DEFINITIONS) dropdown.addOption(definition.name, definition.name);
        dropdown.setValue(this.value.domain).onChange((value) => {
          this.value.domain = value;
          this.syncExpectedParent();
          this.updatePreview();
        });
      });

    new Setting(this.contentEl)
      .setName("Parent topic")
      .setDesc("Optional canonical parent; useful for topic-family placement.")
      .addButton((button) => {
        this.parentLabelEl = button.buttonEl;
        this.updateParentLabel();
        button.onClick(() => {
          const expectedId = expectedParentCurriculumId(this.value.curriculumId);
          if (this.options.mode !== "proposal" && this.value.curriculumId && !expectedId && !isExtensionCurriculumId(this.value.curriculumId)) {
            new Notice("Root curriculum IDs cannot have a parent topic.");
            return;
          }
          const expectedPath = this.options.resolveExpectedParentPath?.(this.value) ?? "";
          const candidates = expectedPath
            ? this.options.canonicalRecords.filter((record) => record.path === expectedPath)
            : this.options.canonicalRecords.filter((record) => record.domain === this.value.domain);
          new ParentTopicPickerModal(this.app, candidates, (record) => {
            this.value.parentPath = record.path;
            this.updateParentLabel();
            this.updatePreview();
          }).open();
        });
      })
      .addExtraButton((button) => button.setIcon("x").setTooltip("Clear parent").onClick(() => {
        this.value.parentPath = "";
        this.updateParentLabel();
      }));

    new Setting(this.contentEl)
      .setName("Topic kind")
      .addDropdown((dropdown) => {
        for (const kind of TOPIC_KINDS) dropdown.addOption(kind, kind.replace(/-/g, " "));
        dropdown.setValue(this.value.topicKind).onChange((value) => { this.value.topicKind = value; });
      });

    new Setting(this.contentEl)
      .setName("Priority")
      .setDesc("Study priority only; it does not indicate approval.")
      .addDropdown((dropdown) => dropdown
        .addOptions({ P1: "P1", P2: "P2", P3: "P3" })
        .setValue(this.value.priority)
        .onChange((value) => { this.value.priority = value; }));

    new Setting(this.contentEl)
      .setName("Safety-critical")
      .setDesc("Flags the scaffold for safety-focused evidence review.")
      .addToggle((toggle) => toggle.setValue(this.value.safetyCritical).onChange((value) => { this.value.safetyCritical = value; }));

    if (this.options.mode !== "proposal") {
      new Setting(this.contentEl)
        .setName("Curriculum ID")
        .setDesc("Must match the selected domain, e.g. ENT-LAR-010 or ENT-LAR-010.01.")
        .addText((text) => text.setPlaceholder("ENT-LAR-###").setValue(this.value.curriculumId).onChange((value) => {
          this.value.curriculumId = value.toUpperCase();
          text.setValue(this.value.curriculumId);
          this.syncExpectedParent();
          this.updatePreview();
        }));
    }

    if (this.options.mode === "proposal" || this.options.mode === "canonical") {
      new Setting(this.contentEl)
        .setName("Add to a collection after creation")
        .setDesc("You can choose the heading or subheading after the note is created.")
        .addToggle((toggle) => toggle.setValue(this.value.addToCollection).onChange((value) => { this.value.addToCollection = value; }));
    }

    const preview = this.contentEl.createDiv({ cls: "ent-cc-path-preview" });
    preview.createDiv({ cls: "ent-cc-path-preview-label", text: this.options.mode === "proposal" ? "Inbox destination" : "Canonical destination" });
    this.previewEl = preview.createDiv({ cls: "ent-cc-path-preview-value" });
    this.detailsEl = preview.createDiv({ cls: "ent-cc-promotion-preview" });
    this.updatePreview();

    if (this.options.mode !== "proposal") {
      const warning = this.contentEl.createDiv({ cls: "ent-cc-canonical-warning" });
      setIcon(warning.createSpan(), "triangle-alert");
      warning.createSpan({ text: this.options.mode === "placement"
        ? "Confirm the ID and final path. Existing review status is preserved; locked notes cannot be changed."
        : "Confirm this structural curriculum change. The note will remain review_status: unverified."
      });
      new Setting(this.contentEl)
        .setName("I checked the curriculum ID and destination")
        .addToggle((toggle) => toggle.setValue(false).onChange((value) => { this.confirmed = value; }));
    }

    this.errorEl = this.contentEl.createDiv({ cls: "ent-cc-form-error", attr: { role: "alert", "aria-live": "polite" } });
    const footer = new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setButtonText(this.options.submitLabel).setCta().onClick(() => void this.submit()));
    footer.settingEl.addClass("ent-cc-modal-footer");
  }

  private updateParentLabel(): void {
    if (!this.parentLabelEl) return;
    const parent = this.options.canonicalRecords.find((record) => record.path === this.value.parentPath);
    this.parentLabelEl.setText(parent ? `${parent.curriculumId} · ${parent.title}` : "Choose parent…");
  }

  private updatePreview(): void {
    if (!this.previewEl) return;
    const path = this.options.mode === "proposal"
      ? proposalPath(this.options.proposalFolder, this.value.title || "Untitled proposal")
      : canonicalPath(this.value) || "Choose a valid domain, ID, and title";
    this.previewEl.setText(path);
    this.detailsEl?.empty();
    for (const detail of this.options.previewDetails?.({ ...this.value }) ?? []) {
      const row = this.detailsEl?.createDiv({ cls: "ent-cc-promotion-preview-row" });
      if (row) {
        setIcon(row.createSpan(), "check-circle-2");
        row.createSpan({ text: detail });
      }
    }
  }

  private syncExpectedParent(): void {
    if (this.options.mode === "proposal") return;
    const expectedId = expectedParentCurriculumId(this.value.curriculumId);
    const expectedPath = this.options.resolveExpectedParentPath?.(this.value) ?? "";
    if (expectedPath) this.value.parentPath = expectedPath;
    else if (!expectedId && !isExtensionCurriculumId(this.value.curriculumId)) this.value.parentPath = "";
    this.updateParentLabel();
  }

  private async submit(): Promise<void> {
    this.value.title = this.value.title.trim();
    this.value.curriculumId = this.value.curriculumId.trim().toUpperCase();
    const error = this.options.validate(this.value) || (this.options.mode !== "proposal" && !this.confirmed ? "Confirm the curriculum ID and destination first." : null);
    if (error) {
      this.errorEl?.setText(error);
      return;
    }
    try {
      await this.options.onSubmit({ ...this.value });
      this.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.errorEl?.setText(message);
    }
  }
}
