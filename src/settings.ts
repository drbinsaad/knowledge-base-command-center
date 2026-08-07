import { App, PluginSettingTab, Setting, TFile, TFolder } from "obsidian";
import {
  DEFAULT_PROPOSAL_FOLDER,
  validateProposalFolderPath,
  validateWritableFolderPath,
  type MainTab,
  type NewNoteMode,
  type OpenNoteBehavior,
  type PluginData,
  type WorkspaceMode,
} from "./model";
import { StringPickerModal, VaultFilePickerModal } from "./modals";

interface SettingsHost {
  app: App;
  data: PluginData;
  savePluginData(): Promise<void>;
  refreshViews(): Promise<void>;
  getTemplateFiles(): TFile[];
  getIndexGroups(): string[];
  isDataReadOnly(): boolean;
  dataCompatibilityWarning: string;
}

export class EntCommandCenterSettingsTab extends PluginSettingTab {
  constructor(app: App, private readonly host: SettingsHost) {
    super(app, host as never);
  }

  private async save(refresh = true): Promise<void> {
    this.host.data.settings.setupComplete = true;
    await this.host.savePluginData();
    if (refresh) await this.host.refreshViews();
  }

  display(): void {
    const { containerEl } = this;
    const settings = this.host.data.settings;
    containerEl.empty();
    containerEl.createEl("p", {
      text: "Configure the command center for this vault. Organization and visual hierarchy remain in plugin data; source notes are never moved by index actions.",
      cls: "setting-item-description",
    });
    const readOnly = this.host.isDataReadOnly();
    if (readOnly) containerEl.createDiv({ cls: "ent-cc-settings-warning", text: this.host.dataCompatibilityWarning });

    new Setting(containerEl).setName("Workspace").setHeading();

    new Setting(containerEl)
      .setName("Workspace profile")
      .setDesc("Generic works with any folder-based knowledge base. ENT clinical retains the protected clinical creation and review workflow.")
      .addDropdown((dropdown) => dropdown
        .addOptions({ generic: "Generic knowledge base", "ent-clinical": "ENT clinical preset" })
        .setValue(settings.workspaceMode)
        .setDisabled(readOnly)
        .onChange(async (value) => {
          settings.workspaceMode = value as WorkspaceMode;
          if (settings.workspaceMode === "generic") {
            settings.enableAdvancedCanonicalActions = false;
            if (["procedures", "medications", "syndromes"].includes(this.host.data.activeTab)) this.host.data.activeTab = "curriculum";
          }
          await this.save();
          this.display();
        }));

    new Setting(containerEl)
      .setName("Command center name")
      .setDesc("Displayed in the view title, header, ribbon tooltip, and settings.")
      .addText((text) => text.setPlaceholder("Knowledge Base Command Center").setValue(settings.workspaceName).setDisabled(readOnly).onChange(async (value) => {
        const clean = value.trim();
        if (!clean) return;
        settings.workspaceName = clean;
        await this.save();
      }));

    new Setting(containerEl)
      .setName("Header description")
      .setDesc("Short explanation shown below the command center name.")
      .addText((text) => text.setPlaceholder("Search, organize, arrange, and create notes.").setValue(settings.workspaceSubtitle).setDisabled(readOnly).onChange(async (value) => {
        settings.workspaceSubtitle = value.trim();
        await this.save();
      }));

    new Setting(containerEl)
      .setName("Index name")
      .setDesc("For example: Knowledge Index, Curriculum, Projects, Research Library.")
      .addText((text) => text.setPlaceholder("Knowledge Index").setValue(settings.indexLabel).setDisabled(readOnly).onChange(async (value) => {
        const clean = value.trim();
        if (!clean) return;
        settings.indexLabel = clean;
        await this.save();
      }));

    new Setting(containerEl)
      .setName("Item names")
      .setDesc("Singular first, plural second. These labels are used throughout the interface.")
      .addText((text) => text.setPlaceholder("note").setValue(settings.itemSingular).setDisabled(readOnly).onChange(async (value) => {
        if (value.trim()) { settings.itemSingular = value.trim(); await this.save(); }
      }))
      .addText((text) => text.setPlaceholder("notes").setValue(settings.itemPlural).setDisabled(readOnly).onChange(async (value) => {
        if (value.trim()) { settings.itemPlural = value.trim(); await this.save(); }
      }));

    new Setting(containerEl)
      .setName("Group name")
      .setDesc("Label for the top-level grouping property, such as Category, Domain, Area, or Course.")
      .addText((text) => text.setPlaceholder("Group").setValue(settings.groupLabel).setDisabled(readOnly).onChange(async (value) => {
        if (value.trim()) { settings.groupLabel = value.trim(); await this.save(); }
      }));

    new Setting(containerEl).setName("Folders and templates").setHeading();

    const folderPaths = (): string[] => this.host.app.vault.getAllLoadedFiles()
      .filter((file): file is TFolder => file instanceof TFolder && !file.isRoot())
      .map((folder) => folder.path)
      .filter((path) => !validateWritableFolderPath(path, this.host.app.vault.configDir))
      .sort((a, b) => a.localeCompare(b));

    const folderText = (
      name: string,
      description: string,
      current: string,
      onValid: (value: string) => void,
      allowEmpty = true,
    ): void => {
      const row = new Setting(containerEl).setName(name).setDesc(description);
      row.addText((text) => text.setPlaceholder(allowEmpty ? "Vault root (leave empty)" : "Folder/path").setValue(current).setDisabled(readOnly).onChange(async (value) => {
        const clean = value.trim().replace(/^\/+|\/+$/g, "");
        const error = validateWritableFolderPath(clean, this.host.app.vault.configDir) || (!allowEmpty && !clean ? "Choose a folder." : null);
        text.inputEl.toggleClass("is-error", Boolean(error));
        row.setDesc(error ?? description);
        if (error) return;
        onValid(clean);
        await this.save();
      }));
      row.addButton((button) => button.setButtonText("Browse…").setDisabled(readOnly).onClick(() => {
        const folders = folderPaths();
        if (folders.length === 0) { return; }
        new StringPickerModal(this.host.app, folders, `Choose ${name.toLowerCase()}`, "Search vault folders…", async (path) => {
          onValid(path);
          await this.save();
          this.display();
        }).open();
      }));
    };

    folderText("Indexed notes folder", "Every Markdown note in this folder and its subfolders appears in the main index.", settings.primaryFolder, (value) => { settings.primaryFolder = value; });
    folderText("Default new-note folder", "Initial destination in Create note. It can still be changed for each note.", settings.defaultNoteFolder, (value) => { settings.defaultNoteFolder = value; });
    folderText("Templates folder", "Markdown templates offered by the per-note template picker. Leave empty to allow any Markdown file.", settings.templatesFolder, (value) => { settings.templatesFolder = value; });

    new Setting(containerEl)
      .setName("Default starting content")
      .setDesc("Every new note can override this choice.")
      .addDropdown((dropdown) => dropdown
        .addOptions({ empty: "Empty note", template: "Selected template" })
        .setValue(settings.defaultNewNoteMode)
        .setDisabled(readOnly)
        .onChange(async (value) => { settings.defaultNewNoteMode = value as NewNoteMode; await this.save(false); }));

    new Setting(containerEl)
      .setName("Default template")
      .setDesc(settings.defaultTemplatePath || "No default template selected. Every new note can still choose a template.")
      .addButton((button) => button.setButtonText(settings.defaultTemplatePath ? settings.defaultTemplatePath.split("/").pop()?.replace(/\.md$/, "") ?? "Choose…" : "Choose…").setDisabled(readOnly).onClick(() => {
        const templates = this.host.getTemplateFiles();
        if (templates.length === 0) return;
        new VaultFilePickerModal(this.host.app, templates, "Choose the default note template", async (file) => {
          settings.defaultTemplatePath = file.path;
          await this.save(false);
          this.display();
        }).open();
      }))
      .addButton((button) => button.setIcon("x").setTooltip("Clear default template").setDisabled(readOnly || !settings.defaultTemplatePath).onClick(async () => {
        settings.defaultTemplatePath = "";
        if (settings.defaultNewNoteMode === "template") settings.defaultNewNoteMode = "empty";
        await this.save(false);
        this.display();
      }));

    const inboxSetting = new Setting(containerEl)
      .setName("Inbox folder")
      .setDesc(settings.workspaceMode === "ent-clinical" ? "Clinical proposals must stay inside 01 Inbox." : "Notes in this folder appear in the Inbox section.");
    inboxSetting.addText((text) => text.setPlaceholder(DEFAULT_PROPOSAL_FOLDER).setValue(settings.proposalFolder).setDisabled(readOnly).onChange(async (value) => {
      const clean = value.trim().replace(/^\/+|\/+$/g, "");
      const error = settings.workspaceMode === "ent-clinical"
        ? validateProposalFolderPath(clean, this.host.app.vault.configDir)
        : validateWritableFolderPath(clean, this.host.app.vault.configDir);
      text.inputEl.toggleClass("is-error", Boolean(error));
      inboxSetting.setDesc(error ?? (settings.workspaceMode === "ent-clinical" ? "Clinical proposals must stay inside 01 Inbox." : "Notes in this folder appear in the Inbox section."));
      if (error) return;
      settings.proposalFolder = clean;
      await this.save();
    }));
    inboxSetting.addButton((button) => button.setButtonText("Browse…").setDisabled(readOnly).onClick(() => {
      new StringPickerModal(this.host.app, folderPaths(), "Choose inbox folder", "Search vault folders…", async (path) => {
        const error = settings.workspaceMode === "ent-clinical"
          ? validateProposalFolderPath(path, this.host.app.vault.configDir)
          : validateWritableFolderPath(path, this.host.app.vault.configDir);
        if (error) return;
        settings.proposalFolder = path;
        await this.save();
        this.display();
      }).open();
    }));

    new Setting(containerEl)
      .setName("Inbox name")
      .addText((text) => text.setPlaceholder("Inbox").setValue(settings.inboxLabel).setDisabled(readOnly).onChange(async (value) => {
        if (value.trim()) { settings.inboxLabel = value.trim(); await this.save(); }
      }));

    new Setting(containerEl).setName("Metadata mapping").setHeading();
    containerEl.createEl("p", {
      text: "Property names are vault-specific. Notes without these properties still appear; folders provide safe fallbacks.",
      cls: "setting-item-description",
    });

    const propertyNames = (): string[] => [...new Set(this.host.app.vault.getMarkdownFiles().flatMap((file) => {
      const frontmatter = this.host.app.metadataCache.getFileCache(file)?.frontmatter;
      return frontmatter ? Object.keys(frontmatter).filter((key) => key !== "position") : [];
    }))].sort((a, b) => a.localeCompare(b));

    const propertyText = (name: string, description: string, placeholder: string, current: string, onChange: (value: string) => void): void => {
      const row = new Setting(containerEl).setName(name).setDesc(description);
      row.addText((text) => text.setPlaceholder(placeholder).setValue(current).setDisabled(readOnly).onChange(async (value) => {
        onChange(value.trim());
        await this.save();
      }));
      row.addButton((button) => button.setButtonText("Choose…").setDisabled(readOnly).onClick(() => {
        const properties = propertyNames();
        if (properties.length === 0) return;
        new StringPickerModal(this.host.app, properties, `Choose ${name.toLowerCase()}`, "Search frontmatter properties…", async (property) => {
          onChange(property);
          await this.save();
          this.display();
        }).open();
      }));
    };

    propertyText("ID property", "Optional identifier shown beside each indexed note. Leave empty to disable it.", "id", settings.idProperty, (value) => { settings.idProperty = value; });
    propertyText("Group property", "If empty or absent on a note, the first subfolder under the indexed folder becomes the group.", "category", settings.groupProperty, (value) => { settings.groupProperty = value; });
    propertyText("Parent property", "A wikilink or note title used for default nesting. Leave empty to use only visual arrangement.", "parent", settings.parentProperty, (value) => { settings.parentProperty = value; });

    new Setting(containerEl).setName("Navigation and behavior").setHeading();

    const defaultTabs: Record<MainTab, string> = {
      curriculum: settings.indexLabel,
      inbox: settings.inboxLabel,
      collections: "My Collections",
      queues: "Smart Queues",
      procedures: "Procedures",
      medications: "Medications",
      syndromes: "Syndromes",
    };
    if (settings.workspaceMode === "generic") {
      delete (defaultTabs as Partial<Record<MainTab, string>>).procedures;
      delete (defaultTabs as Partial<Record<MainTab, string>>).medications;
      delete (defaultTabs as Partial<Record<MainTab, string>>).syndromes;
    }
    new Setting(containerEl)
      .setName("Default section")
      .setDesc("Section shown when the command center opens for the first time.")
      .addDropdown((dropdown) => dropdown.addOptions(defaultTabs).setValue(settings.defaultTab).setDisabled(readOnly).onChange(async (value) => {
        settings.defaultTab = value as MainTab;
        this.host.data.activeTab = value as MainTab;
        await this.save();
      }));

    new Setting(containerEl)
      .setName("Recent changes limit")
      .setDesc("Maximum entries in the Recently changed smart queue (5–100).")
      .addSlider((slider) => slider.setLimits(5, 100, 5).setDynamicTooltip().setValue(settings.recentLimit).setDisabled(readOnly).onChange(async (value) => {
        settings.recentLimit = value;
        await this.save();
      }));

    new Setting(containerEl)
      .setName("Hover previews")
      .setDesc("Use Obsidian Page Preview when hovering a record title.")
      .addToggle((toggle) => toggle.setValue(settings.enableHoverPreview).setDisabled(readOnly).onChange(async (value) => {
        settings.enableHoverPreview = value;
        await this.save();
      }));

    new Setting(containerEl)
      .setName("Open notes")
      .setDesc("Choose where records open so the command center can remain available.")
      .addDropdown((dropdown) => dropdown
        .addOptions({ "new-tab": "New tab (recommended)", "same-tab": "Current tab", split: "Vertical split" })
        .setValue(settings.openNoteBehavior)
        .setDisabled(readOnly)
        .onChange(async (value) => { settings.openNoteBehavior = value as OpenNoteBehavior; await this.save(false); }));

    if (settings.workspaceMode === "ent-clinical") {
      new Setting(containerEl).setName("ENT clinical safeguards").setHeading();
      new Setting(containerEl)
        .setName("Safety badges")
        .setDesc("Show a safety-critical indicator. This never changes clinical metadata.")
        .addToggle((toggle) => toggle.setValue(settings.showSafetyBadges).setDisabled(readOnly).onChange(async (value) => {
          settings.showSafetyBadges = value;
          await this.save();
        }));

      new Setting(containerEl)
        .setName("Advanced canonical actions")
        .setDesc("Show direct ENT canonical creation and placement editing. Promotion from the clinical Inbox remains available.")
        .addToggle((toggle) => toggle.setValue(settings.enableAdvancedCanonicalActions).setDisabled(readOnly).onChange(async (value) => {
          settings.enableAdvancedCanonicalActions = value;
          await this.save();
        }));

      new Setting(containerEl)
        .setName("Visual cross-domain movement")
        .setDesc("Allow ENT topics to be visually grouped across canonical domains. This changes only plugin organization; note folders, curriculum IDs, domain properties, and clinical metadata stay untouched. Off by default.")
        .addToggle((toggle) => toggle.setValue(settings.allowClinicalVisualGroupMoves).setDisabled(readOnly).onChange(async (value) => {
          if (value && this.host.data.indexGroupOrder.length === 0) this.host.data.indexGroupOrder = this.host.getIndexGroups();
          settings.allowClinicalVisualGroupMoves = value;
          await this.save();
        }));
    }
  }
}
