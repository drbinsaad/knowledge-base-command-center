import { App, Plugin, PluginSettingTab, Setting, SettingDefinitionItem, SettingDefinitionRender, TFile, TFolder } from "obsidian";
import {
  asUnknownRecord,
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

interface SettingsHost extends Plugin {
  data: PluginData;
  savePluginData(): Promise<void>;
  refreshViews(): Promise<void>;
  getTemplateFiles(): TFile[];
  getIndexGroups(): string[];
  isDataReadOnly(): boolean;
  dataCompatibilityWarning: string;
}

function renderSetting(
  name: string,
  desc: string,
  render: (setting: Setting) => void,
  aliases: string[] = [],
): SettingDefinitionRender {
  return { name, desc, aliases, render };
}

export class EntCommandCenterSettingsTab extends PluginSettingTab {
  constructor(app: App, private readonly host: SettingsHost) {
    super(app, host);
  }

  private async save(refresh = true): Promise<void> {
    this.host.data.settings.setupComplete = true;
    await this.host.savePluginData();
    if (refresh) await this.host.refreshViews();
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const settings = this.host.data.settings;
    const readOnly = this.host.isDataReadOnly();
    const definitions: SettingDefinitionItem[] = [{
      name: "About this workspace",
      desc: "Configure the command center for this vault. Organization and visual hierarchy remain in plugin data; source notes are never moved by index actions.",
      aliases: ["knowledge base", "index", "command center"],
    }];
    if (readOnly) {
      definitions.push({
        name: "Read-only compatibility mode",
        desc: this.host.dataCompatibilityWarning,
        aliases: ["warning", "data version"],
      });
    }

    const folderPaths = (): string[] => this.host.app.vault.getAllLoadedFiles()
      .filter((file): file is TFolder => file instanceof TFolder && !file.isRoot())
      .map((folder) => folder.path)
      .filter((path) => !validateWritableFolderPath(path, this.host.app.vault.configDir))
      .sort((a, b) => a.localeCompare(b));

    const folderSetting = (
      name: string,
      description: string,
      current: string,
      onValid: (value: string) => void,
      allowEmpty = true,
    ): SettingDefinitionRender => renderSetting(name, description, (row) => {
      row.addText((text) => text
        .setPlaceholder(allowEmpty ? "Vault root (leave empty)" : "Folder/path")
        .setValue(current)
        .setDisabled(readOnly)
        .onChange(async (value) => {
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
        if (folders.length === 0) return;
        new StringPickerModal(this.host.app, folders, `Choose ${name.toLowerCase()}`, "Search vault folders…", async (path) => {
          onValid(path);
          await this.save();
          this.update();
        }).open();
      }));
    }, ["folder", "path"]);

    const propertyNames = (): string[] => {
      const names = new Set<string>();
      for (const file of this.host.app.vault.getMarkdownFiles()) {
        const frontmatter = asUnknownRecord(this.host.app.metadataCache.getFileCache(file)?.frontmatter);
        for (const key of Object.keys(frontmatter)) if (key !== "position") names.add(key);
      }
      return [...names].sort((a, b) => a.localeCompare(b));
    };

    const propertySetting = (
      name: string,
      description: string,
      placeholder: string,
      current: string,
      onChange: (value: string) => void,
    ): SettingDefinitionRender => renderSetting(name, description, (row) => {
      row.addText((text) => text
        .setPlaceholder(placeholder)
        .setValue(current)
        .setDisabled(readOnly)
        .onChange(async (value) => {
          onChange(value.trim());
          await this.save();
        }));
      row.addButton((button) => button.setButtonText("Choose…").setDisabled(readOnly).onClick(() => {
        const properties = propertyNames();
        if (properties.length === 0) return;
        new StringPickerModal(this.host.app, properties, `Choose ${name.toLowerCase()}`, "Search frontmatter properties…", async (property) => {
          onChange(property);
          await this.save();
          this.update();
        }).open();
      }));
    }, ["frontmatter", "property", "metadata"]);

    const defaultTabs: Record<string, string> = {
      curriculum: settings.indexLabel,
      inbox: settings.inboxLabel,
      collections: "My Collections",
      queues: "Smart Queues",
    };
    if (settings.workspaceMode === "ent-clinical") {
      defaultTabs.procedures = "Procedures";
      defaultTabs.medications = "Medications";
      defaultTabs.syndromes = "Syndromes";
    }

    definitions.push(
      {
        type: "group",
        heading: "Workspace",
        items: [
          renderSetting("Workspace profile", "Generic works with any folder-based knowledge base. ENT clinical retains the protected clinical creation and review workflow.", (row) => {
            row.addDropdown((dropdown) => dropdown
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
                this.update();
              }));
          }, ["generic", "ENT", "clinical", "preset"]),
          renderSetting("Command center name", "Displayed in the view title, header, ribbon tooltip, and settings.", (row) => {
            row.addText((text) => text.setPlaceholder("Knowledge base command center").setValue(settings.workspaceName).setDisabled(readOnly).onChange(async (value) => {
              const clean = value.trim();
              if (!clean) return;
              settings.workspaceName = clean;
              await this.save();
            }));
          }, ["workspace name", "title"]),
          renderSetting("Header description", "Short explanation shown below the command center name.", (row) => {
            row.addText((text) => text.setPlaceholder("Search, organize, arrange, and create notes.").setValue(settings.workspaceSubtitle).setDisabled(readOnly).onChange(async (value) => {
              settings.workspaceSubtitle = value.trim();
              await this.save();
            }));
          }, ["subtitle"]),
          renderSetting("Index name", "For example: Knowledge Index, Curriculum, Projects, Research Library.", (row) => {
            row.addText((text) => text.setPlaceholder("Knowledge index").setValue(settings.indexLabel).setDisabled(readOnly).onChange(async (value) => {
              const clean = value.trim();
              if (!clean) return;
              settings.indexLabel = clean;
              await this.save();
            }));
          }, ["curriculum", "library"]),
          renderSetting("Item singular", "Singular label used throughout the interface.", (row) => {
            row.addText((text) => text.setPlaceholder("Note").setValue(settings.itemSingular).setDisabled(readOnly).onChange(async (value) => {
              if (!value.trim()) return;
              settings.itemSingular = value.trim();
              await this.save();
            }));
          }, ["item name", "terminology"]),
          renderSetting("Item plural", "Plural label used throughout the interface.", (row) => {
            row.addText((text) => text.setPlaceholder("Notes").setValue(settings.itemPlural).setDisabled(readOnly).onChange(async (value) => {
              if (!value.trim()) return;
              settings.itemPlural = value.trim();
              await this.save();
            }));
          }, ["item names", "terminology"]),
          renderSetting("Group name", "Label for the top-level grouping property, such as Category, Domain, Area, or Course.", (row) => {
            row.addText((text) => text.setPlaceholder("Group").setValue(settings.groupLabel).setDisabled(readOnly).onChange(async (value) => {
              if (!value.trim()) return;
              settings.groupLabel = value.trim();
              await this.save();
            }));
          }, ["category", "domain", "area", "course"]),
        ],
      },
      {
        type: "group",
        heading: "Folders and templates",
        items: [
          folderSetting("Indexed notes folder", "Every Markdown note in this folder and its subfolders appears in the main index.", settings.primaryFolder, (value) => { settings.primaryFolder = value; }),
          folderSetting("Default new-note folder", "Initial destination in Create note. It can still be changed for each note.", settings.defaultNoteFolder, (value) => { settings.defaultNoteFolder = value; }),
          folderSetting("Templates folder", "Markdown templates offered by the per-note template picker. Leave empty to allow any Markdown file.", settings.templatesFolder, (value) => { settings.templatesFolder = value; }),
          renderSetting("Default starting content", "Every new note can override this choice.", (row) => {
            row.addDropdown((dropdown) => dropdown
              .addOptions({ empty: "Empty note", template: "Selected template" })
              .setValue(settings.defaultNewNoteMode)
              .setDisabled(readOnly)
              .onChange(async (value) => {
                settings.defaultNewNoteMode = value as NewNoteMode;
                await this.save(false);
              }));
          }, ["empty note", "template"]),
          renderSetting("Default template", settings.defaultTemplatePath || "No default template selected. Every new note can still choose a template.", (row) => {
            row.addButton((button) => button
              .setButtonText(settings.defaultTemplatePath ? settings.defaultTemplatePath.split("/").pop()?.replace(/\.md$/, "") ?? "Choose…" : "Choose…")
              .setDisabled(readOnly)
              .onClick(() => {
                const templates = this.host.getTemplateFiles();
                if (templates.length === 0) return;
                new VaultFilePickerModal(this.host.app, templates, "Choose the default note template", async (file) => {
                  settings.defaultTemplatePath = file.path;
                  await this.save(false);
                  this.update();
                }).open();
              }));
            row.addButton((button) => button.setIcon("x").setTooltip("Clear default template").setDisabled(readOnly || !settings.defaultTemplatePath).onClick(async () => {
              settings.defaultTemplatePath = "";
              if (settings.defaultNewNoteMode === "template") settings.defaultNewNoteMode = "empty";
              await this.save(false);
              this.update();
            }));
          }, ["template file"]),
          renderSetting("Inbox folder", settings.workspaceMode === "ent-clinical" ? "Clinical proposals must stay inside 01 Inbox." : "Notes in this folder appear in the Inbox section.", (row) => {
            const description = settings.workspaceMode === "ent-clinical" ? "Clinical proposals must stay inside 01 Inbox." : "Notes in this folder appear in the Inbox section.";
            row.addText((text) => text.setPlaceholder(DEFAULT_PROPOSAL_FOLDER).setValue(settings.proposalFolder).setDisabled(readOnly).onChange(async (value) => {
              const clean = value.trim().replace(/^\/+|\/+$/g, "");
              const error = settings.workspaceMode === "ent-clinical"
                ? validateProposalFolderPath(clean, this.host.app.vault.configDir)
                : validateWritableFolderPath(clean, this.host.app.vault.configDir);
              text.inputEl.toggleClass("is-error", Boolean(error));
              row.setDesc(error ?? description);
              if (error) return;
              settings.proposalFolder = clean;
              await this.save();
            }));
            row.addButton((button) => button.setButtonText("Browse…").setDisabled(readOnly).onClick(() => {
              new StringPickerModal(this.host.app, folderPaths(), "Choose inbox folder", "Search vault folders…", async (path) => {
                const error = settings.workspaceMode === "ent-clinical"
                  ? validateProposalFolderPath(path, this.host.app.vault.configDir)
                  : validateWritableFolderPath(path, this.host.app.vault.configDir);
                if (error) return;
                settings.proposalFolder = path;
                await this.save();
                this.update();
              }).open();
            }));
          }, ["proposal folder"]),
          renderSetting("Inbox name", "Label used for the Inbox section.", (row) => {
            row.addText((text) => text.setPlaceholder("Inbox").setValue(settings.inboxLabel).setDisabled(readOnly).onChange(async (value) => {
              if (!value.trim()) return;
              settings.inboxLabel = value.trim();
              await this.save();
            }));
          }, ["proposal inbox"]),
        ],
      },
      {
        type: "group",
        heading: "Metadata mapping",
        items: [
          {
            name: "Metadata mapping behavior",
            desc: "Property names are vault-specific. Notes without these properties still appear; folders provide safe fallbacks.",
            aliases: ["frontmatter", "properties"],
          },
          propertySetting("ID property", "Optional identifier shown beside each indexed note. Leave empty to disable it.", "id", settings.idProperty, (value) => { settings.idProperty = value; }),
          propertySetting("Group property", "If empty or absent on a note, the first subfolder under the indexed folder becomes the group.", "category", settings.groupProperty, (value) => { settings.groupProperty = value; }),
          propertySetting("Parent property", "A wikilink or note title used for default nesting. Leave empty to use only visual arrangement.", "parent", settings.parentProperty, (value) => { settings.parentProperty = value; }),
        ],
      },
      {
        type: "group",
        heading: "Navigation and behavior",
        items: [
          renderSetting("Default section", "Section shown when the command center opens for the first time.", (row) => {
            row.addDropdown((dropdown) => dropdown.addOptions(defaultTabs).setValue(settings.defaultTab).setDisabled(readOnly).onChange(async (value) => {
              settings.defaultTab = value as MainTab;
              this.host.data.activeTab = value as MainTab;
              await this.save();
            }));
          }, ["tab", "start page"]),
          renderSetting("Recent changes limit", "Maximum entries in the Recently changed smart queue (5–100).", (row) => {
            row.addSlider((slider) => slider.setLimits(5, 100, 5).setValue(settings.recentLimit).setDisabled(readOnly).onChange(async (value) => {
              settings.recentLimit = value;
              await this.save();
            }));
          }, ["recent queue", "history"]),
          renderSetting("Hover previews", "Use Obsidian Page Preview when hovering a record title.", (row) => {
            row.addToggle((toggle) => toggle.setValue(settings.enableHoverPreview).setDisabled(readOnly).onChange(async (value) => {
              settings.enableHoverPreview = value;
              await this.save();
            }));
          }, ["page preview"]),
          renderSetting("Open notes", "Choose where records open so the command center can remain available.", (row) => {
            row.addDropdown((dropdown) => dropdown
              .addOptions({ "new-tab": "New tab (recommended)", "same-tab": "Current tab", split: "Vertical split" })
              .setValue(settings.openNoteBehavior)
              .setDisabled(readOnly)
              .onChange(async (value) => {
                settings.openNoteBehavior = value as OpenNoteBehavior;
                await this.save(false);
              }));
          }, ["new tab", "same tab", "split"]),
        ],
      },
      {
        type: "group",
        heading: "Privacy and capabilities",
        items: [
          {
            name: "Vault indexing",
            desc: "Enumerates Markdown file paths and reads metadata inside this vault to build the index, pick notes and templates, and repair missing plugin references. No vault content is sent over a network.",
            aliases: ["privacy", "permissions", "enumeration", "files"],
          },
          {
            name: "Clipboard shortcuts",
            desc: "A copy button writes only the plugin-generated text shown by that action after you click it. The plugin never reads the clipboard.",
            aliases: ["privacy", "permissions", "copy"],
          },
        ],
      },
      {
        type: "group",
        heading: "ENT clinical safeguards",
        visible: settings.workspaceMode === "ent-clinical",
        items: [
          renderSetting("Safety badges", "Show a safety-critical indicator. This never changes clinical metadata.", (row) => {
            row.addToggle((toggle) => toggle.setValue(settings.showSafetyBadges).setDisabled(readOnly).onChange(async (value) => {
              settings.showSafetyBadges = value;
              await this.save();
            }));
          }, ["clinical", "safety critical"]),
          renderSetting("Advanced canonical actions", "Show direct ENT canonical creation and placement editing. Promotion from the clinical Inbox remains available.", (row) => {
            row.addToggle((toggle) => toggle.setValue(settings.enableAdvancedCanonicalActions).setDisabled(readOnly).onChange(async (value) => {
              settings.enableAdvancedCanonicalActions = value;
              await this.save();
            }));
          }, ["clinical", "topic placement", "create canonical"]),
          renderSetting("Visual cross-domain movement", "Allow ENT topics to be visually grouped across canonical domains. This changes only plugin organization; note folders, curriculum IDs, domain properties, and clinical metadata stay untouched. Off by default.", (row) => {
            row.addToggle((toggle) => toggle.setValue(settings.allowClinicalVisualGroupMoves).setDisabled(readOnly).onChange(async (value) => {
              if (value && this.host.data.indexGroupOrder.length === 0) this.host.data.indexGroupOrder = this.host.getIndexGroups();
              settings.allowClinicalVisualGroupMoves = value;
              await this.save();
            }));
          }, ["clinical", "groups", "arrange"]),
        ],
      },
    );
    return definitions;
  }
}
