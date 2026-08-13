import { Modal, Notice, Setting, TFile, TFolder } from "obsidian";
import type EntVaultCommandCenterPlugin from "./main";
import {
  errorMessage,
  resolveLibraryNoteProfile,
  type LibraryDefinition,
  type LibraryNoteProfile,
  type NewNoteMode,
} from "./model";
import { calculateModalViewportLayout, StringPickerModal, VaultFilePickerModal } from "./modals";

function profileFingerprint(profile: LibraryNoteProfile | null): string {
  if (!profile) return "inherit";
  return JSON.stringify({
    ...(profile.folder !== undefined ? { folder: profile.folder } : {}),
    ...(profile.mode !== undefined ? { mode: profile.mode } : {}),
    ...(profile.templatePath !== undefined ? { templatePath: profile.templatePath } : {}),
  });
}

function libraryFingerprint(library: LibraryDefinition | null): string {
  return library ? JSON.stringify(library) : "missing";
}

function baseCreationDefaultsFingerprint(plugin: EntVaultCommandCenterPlugin): string {
  const settings = plugin.data.settings;
  return JSON.stringify({
    defaultNoteFolder: settings.defaultNoteFolder,
    defaultNewNoteMode: settings.defaultNewNoteMode,
    defaultTemplatePath: settings.defaultTemplatePath,
    templatesFolder: settings.templatesFolder,
  });
}

function fileLabel(path: string): string {
  return path.split("/").pop()?.replace(/\.md$/i, "") || "No template selected";
}

function reportProfileError(error: unknown): void {
  console.error("Knowledge Base Command Center Library creation-profile action failed", error);
  new Notice(errorMessage(error, "The Library creation profile could not be saved."), 8000);
}

/** Edit one optional base → Library note-creation override without touching notes. */
export class LibraryNoteProfileEditorModal extends Modal {
  private readonly openedBaseId: string;
  private readonly openedDataEpoch: number;
  private readonly originalProfileFingerprint: string;
  private readonly originalLibraryFingerprint: string;
  private readonly originalBaseDefaultsFingerprint: string;
  private folderOverride = false;
  private folder = "";
  private mode: "inherit" | NewNoteMode = "inherit";
  private templateOverride = false;
  private templatePath = "";
  private busy = false;
  private staleNoticeShown = false;
  private summaryEl: HTMLElement | null = null;
  private errorEl: HTMLElement | null = null;
  private folderInput: HTMLInputElement | null = null;
  private folderBrowseButton: HTMLButtonElement | null = null;
  private templateButton: HTMLButtonElement | null = null;
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
    this.modalEl.style.setProperty("--ent-cc-modal-visual-height", `${layout.height}px`);
    this.modalEl.style.setProperty("--ent-cc-modal-visual-shift", `${layout.shift}px`);
    this.modalEl.toggleClass("is-virtual-keyboard-open", layout.keyboardOpen);
  };

  private readonly handleViewportFocus = (event: FocusEvent): void => {
    this.scheduleViewportSync();
    const target = event.target as HTMLElement | null;
    const viewWindow = this.viewportWindow;
    if (!viewWindow || !target || typeof target.scrollIntoView !== "function") return;
    this.viewportSyncTimers.push(viewWindow.setTimeout(() => {
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, 80));
  };

  constructor(
    private readonly plugin: EntVaultCommandCenterPlugin,
    private readonly library: LibraryDefinition,
    private readonly onSaved?: () => void,
  ) {
    super(plugin.app);
    this.openedBaseId = plugin.getActiveKnowledgeBaseId();
    this.openedDataEpoch = plugin.getDataEpoch();
    const profile = plugin.getLibraryNoteProfile(library.id);
    this.originalProfileFingerprint = profileFingerprint(profile);
    this.originalLibraryFingerprint = libraryFingerprint(library);
    this.originalBaseDefaultsFingerprint = baseCreationDefaultsFingerprint(plugin);
    const effective = plugin.getEffectiveLibraryNoteProfile(library.id);
    this.folderOverride = profile?.folder !== undefined;
    this.folder = profile?.folder ?? effective.folder;
    this.mode = profile?.mode ?? "inherit";
    this.templateOverride = profile?.templatePath !== undefined;
    this.templatePath = profile?.templatePath ?? effective.templatePath;
  }

  onOpen(): void {
    this.modalEl.addClass("ent-cc-library-profile-modal");
    this.contentEl.addClass("ent-cc-modal", "ent-cc-library-profile-editor");
    this.titleEl.setText(`Creation defaults — ${this.library.name}`);
    this.contentEl.createEl("p", {
      cls: "ent-cc-modal-lead",
      text: "Override only what this library needs. Every field left on inherit follows the active knowledge base defaults. The create note form can still override these values for one note.",
    });
    if (this.library.sourceKind !== null && this.plugin.isClinicalMode()) {
      this.contentEl.createDiv({
        cls: "ent-cc-catalog-context",
        text: "This built-in clinical Library normally detects source notes instead of creating them. Its profile is retained for portability and any future explicit creation workflow.",
        attr: { role: "note" },
      });
    }

    new Setting(this.contentEl)
      .setName("Override destination folder")
      .setDesc("Off uses the knowledge base default. Turn it on to choose a library-specific folder, including the vault root.")
      .addToggle((toggle) => toggle
        .setValue(this.folderOverride)
        .onChange((value) => {
          const inheritedFolder = this.effectiveProfile().folder;
          this.folderOverride = value;
          if (value && !this.folder) this.folder = inheritedFolder;
          this.syncControls();
        }));
    const folderSetting = new Setting(this.contentEl)
      .setName("Destination folder")
      .setDesc("Vault-relative. An empty override means the vault root.")
      .addText((text) => {
        this.folderInput = text.inputEl;
        text.setPlaceholder("Vault root").setValue(this.folder).onChange((value) => {
          this.folder = value;
          this.updateSummary();
        });
        text.inputEl.setAttribute("aria-label", `Destination folder for ${this.library.name}`);
      })
      .addButton((button) => {
        this.folderBrowseButton = button.buttonEl;
        button.setButtonText("Browse…").onClick(() => {
          if (!this.isCurrent() || !this.folderOverride) return;
          const folders = this.plugin.app.vault.getAllLoadedFiles()
            .filter((file): file is TFolder => file instanceof TFolder && !file.isRoot())
            .map((folder) => folder.path)
            .sort((left, right) => left.localeCompare(right));
          new StringPickerModal(this.plugin.app, folders, "Choose destination folder", "Search vault folders…", (path) => {
            if (!this.isCurrent()) return;
            this.folder = path;
            if (this.folderInput) this.folderInput.value = path;
            this.updateSummary();
          }).open();
        });
      });
    folderSetting.settingEl.addClass("ent-cc-library-profile-dependent");

    new Setting(this.contentEl)
      .setName("Starting content")
      .setDesc("Inherit, create an empty note, or copy a selected template.")
      .addDropdown((dropdown) => dropdown
        .addOptions({ inherit: "Inherit knowledge base default", empty: "Empty note", template: "Copy a template" })
        .setValue(this.mode)
        .onChange((value) => {
          this.mode = value as "inherit" | NewNoteMode;
          this.updateSummary();
        }));

    new Setting(this.contentEl)
      .setName("Override template")
      .setDesc("Off follows the knowledge base template. The template is read only when this library creates a note from a template.")
      .addToggle((toggle) => toggle
        .setValue(this.templateOverride)
        .onChange((value) => {
          const inheritedTemplate = this.effectiveProfile().templatePath;
          this.templateOverride = value;
          if (value && !this.templatePath) this.templatePath = inheritedTemplate;
          this.syncControls();
        }));
    const templateSetting = new Setting(this.contentEl)
      .setName("Template")
      .setDesc("Template files stay inside the configured templates folder.")
      .addButton((button) => {
        this.templateButton = button.buttonEl;
        button.onClick(() => {
          if (!this.isCurrent() || !this.templateOverride) return;
          const templates = this.plugin.getTemplateFiles();
          if (templates.length === 0) {
            new Notice("No Markdown templates were found in the configured templates folder.");
            return;
          }
          new VaultFilePickerModal(this.plugin.app, templates, "Choose a Library note template", (file: TFile) => {
            if (!this.isCurrent()) return;
            this.templatePath = file.path;
            this.syncControls();
          }).open();
        });
      });
    templateSetting.settingEl.addClass("ent-cc-library-profile-dependent");

    const summary = this.contentEl.createDiv({ cls: "ent-cc-library-profile-summary", attr: { role: "status", "aria-live": "polite" } });
    summary.createDiv({ cls: "ent-cc-path-preview-label", text: "Effective creation defaults" });
    this.summaryEl = summary.createDiv({ cls: "ent-cc-library-profile-summary-value" });
    this.errorEl = this.contentEl.createDiv({ cls: "ent-cc-form-error", attr: { role: "alert", "aria-live": "assertive" } });

    const footer = new Setting(this.contentEl);
    footer.settingEl.addClass("ent-cc-modal-footer", "ent-cc-library-profile-footer");
    footer.addButton((button) => button
      .setButtonText("Reset to inherit")
      .onClick(() => void this.submit(true)));
    footer.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()));
    footer.addButton((button) => button.setButtonText("Save profile").setCta().onClick(() => void this.submit(false)));
    this.syncControls();
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
    this.viewportWindow = null;
    this.modalEl.style.removeProperty("--ent-cc-modal-visual-height");
    this.modalEl.style.removeProperty("--ent-cc-modal-visual-shift");
    this.modalEl.removeClass("is-virtual-keyboard-open");
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
    this.viewportSyncTimers = [0, 60, 180, 420].map((delay) => (
      viewWindow.setTimeout(this.syncViewportLayout, delay)
    ));
  }

  private effectiveProfile(): ReturnType<typeof resolveLibraryNoteProfile> {
    const profile = this.buildProfile();
    return resolveLibraryNoteProfile({
      ...this.plugin.data.settings,
      libraryNoteProfiles: profile ? { [this.library.id]: profile } : {},
    }, this.library.id);
  }

  private buildProfile(): LibraryNoteProfile | null {
    const profile: LibraryNoteProfile = {};
    if (this.folderOverride) profile.folder = this.folder.trim().replace(/^\/+|\/+$/g, "");
    if (this.mode !== "inherit") profile.mode = this.mode;
    if (this.templateOverride) profile.templatePath = this.templatePath.trim().replace(/^\/+/, "");
    return Object.keys(profile).length > 0 ? profile : null;
  }

  private syncControls(): void {
    if (this.folderInput) {
      this.folderInput.disabled = !this.folderOverride || this.busy;
      this.folderInput.value = this.folder;
    }
    if (this.folderBrowseButton) this.folderBrowseButton.disabled = !this.folderOverride || this.busy;
    if (this.templateButton) {
      this.templateButton.disabled = !this.templateOverride || this.busy;
      this.templateButton.setText(fileLabel(this.templatePath));
      this.templateButton.setAttribute("aria-label", `Choose template for ${this.library.name}; current ${fileLabel(this.templatePath)}`);
    }
    this.updateSummary();
  }

  private updateSummary(): void {
    const effective = this.effectiveProfile();
    const folder = effective.folder || "Vault root";
    const content = effective.mode === "empty" ? "Empty note" : `Template: ${fileLabel(effective.templatePath)}`;
    this.summaryEl?.setText(`${folder} · ${content}`);
    this.errorEl?.setText("");
  }

  private isCurrent(): boolean {
    const current = this.plugin.getLibrary(this.library.id);
    const currentProfile = this.plugin.getLibraryNoteProfile(this.library.id);
    const valid = this.plugin.getActiveKnowledgeBaseId() === this.openedBaseId
      && this.plugin.getDataEpoch() === this.openedDataEpoch
      && libraryFingerprint(current) === this.originalLibraryFingerprint
      && profileFingerprint(currentProfile) === this.originalProfileFingerprint
      && baseCreationDefaultsFingerprint(this.plugin) === this.originalBaseDefaultsFingerprint;
    if (!valid && !this.staleNoticeShown) {
      this.staleNoticeShown = true;
      new Notice("The active knowledge base, its creation defaults, the library, or the synced profile changed. Close and reopen this editor before continuing.", 8000);
    }
    return valid;
  }

  private async submit(reset: boolean): Promise<void> {
    if (this.busy || !this.isCurrent()) return;
    const profile = reset ? null : this.buildProfile();
    if (profile) {
      const error = this.plugin.validateLibraryNoteProfile(this.library.id, profile);
      if (error) {
        this.errorEl?.setText(error);
        return;
      }
    }
    this.busy = true;
    this.syncControls();
    try {
      await this.plugin.setLibraryNoteProfile(this.library.id, profile);
      this.onSaved?.();
      new Notice(reset || !profile
        ? `${this.library.name} now inherits the knowledge base creation defaults.`
        : `Saved creation defaults for ${this.library.name}. Existing notes were not changed.`);
      this.close();
    } catch (error) {
      this.busy = false;
      this.syncControls();
      this.errorEl?.setText(errorMessage(error));
      reportProfileError(error);
    }
  }
}

/** Browse active and archived Libraries and open their creation-profile editor. */
export class ManageLibraryNoteProfilesModal extends Modal {
  private readonly openedBaseId: string;
  private expectedDataEpoch: number;
  private staleNoticeShown = false;

  constructor(
    private readonly plugin: EntVaultCommandCenterPlugin,
    private readonly onChanged?: () => void,
  ) {
    super(plugin.app);
    this.openedBaseId = plugin.getActiveKnowledgeBaseId();
    this.expectedDataEpoch = plugin.getDataEpoch();
  }

  onOpen(): void {
    this.modalEl.addClass("ent-cc-library-profile-modal", "ent-cc-library-profile-manager-modal");
    this.contentEl.addClass("ent-cc-modal", "ent-cc-library-profile-manager");
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    this.titleEl.setText("Library creation profiles");
    this.contentEl.createEl("p", {
      cls: "ent-cc-modal-lead",
      text: "Each library can inherit the knowledge base note-creation defaults or override its folder, starting content, and template. Profiles contain settings only; notes and attachments are never moved or rewritten.",
    });
    const libraries = this.plugin.getLibraries(true);
    if (libraries.length === 0) {
      this.contentEl.createDiv({ cls: "ent-cc-empty", text: "Create a Library before configuring a Library-specific note profile." });
    }
    const active = libraries.filter((library) => library.archivedAt === null);
    const archived = libraries.filter((library) => library.archivedAt !== null);
    this.renderSection("Active libraries", active);
    this.renderSection("Archived libraries", archived);
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Close").onClick(() => this.close()));
  }

  private renderSection(title: string, libraries: LibraryDefinition[]): void {
    if (libraries.length === 0) return;
    this.contentEl.createEl("h3", { text: title });
    const list = this.contentEl.createDiv({ cls: "ent-cc-library-profile-list" });
    for (const library of libraries) {
      const profile = this.plugin.getLibraryNoteProfile(library.id);
      const effective = this.plugin.getEffectiveLibraryNoteProfile(library.id);
      const row = list.createDiv({ cls: `ent-cc-library-profile-row ${library.archivedAt !== null ? "is-archived" : ""}` });
      const copy = row.createDiv({ cls: "ent-cc-library-profile-row-copy" });
      const heading = copy.createDiv({ cls: "ent-cc-library-profile-row-title" });
      heading.createSpan({ text: library.name, attr: { dir: "auto" } });
      if (library.archivedAt !== null) heading.createSpan({ cls: "ent-cc-library-badge", text: "Archived" });
      if (!profile) heading.createSpan({ cls: "ent-cc-library-badge", text: "Inherited" });
      copy.createDiv({
        cls: "ent-cc-picker-meta",
        text: `${effective.folder || "Vault root"} · ${effective.mode === "empty" ? "Empty note" : fileLabel(effective.templatePath)}`,
        attr: { dir: "auto" },
      });
      const configure = row.createEl("button", {
        cls: "ent-cc-button",
        text: profile ? "Edit…" : "Configure…",
        type: "button",
        attr: { "aria-label": `Configure note creation defaults for ${library.name}` },
      });
      configure.addEventListener("click", () => {
        if (!this.isCurrent()) return;
        const current = this.plugin.getLibrary(library.id);
        if (!current) return;
        new LibraryNoteProfileEditorModal(this.plugin, current, () => {
          if (this.plugin.getActiveKnowledgeBaseId() !== this.openedBaseId) {
            this.close();
            return;
          }
          this.expectedDataEpoch = this.plugin.getDataEpoch();
          this.staleNoticeShown = false;
          this.onChanged?.();
          this.render();
        }).open();
      });
    }
  }

  private isCurrent(): boolean {
    const valid = this.plugin.getActiveKnowledgeBaseId() === this.openedBaseId
      && this.plugin.getDataEpoch() === this.expectedDataEpoch;
    if (!valid && !this.staleNoticeShown) {
      this.staleNoticeShown = true;
      new Notice("The active knowledge base or synced settings changed. Close and reopen library creation profiles.", 8000);
    }
    return valid;
  }
}
