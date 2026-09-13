import { Modal, Notice } from "obsidian";
import type EntVaultCommandCenterPlugin from "./main";
import {
  MAX_LIBRARY_DISPLAY_PROPERTY_LENGTH,
  MAX_LIBRARY_VISIBLE_PROPERTIES,
  type LibraryDisplayProfile,
} from "./library-display-profile";
import { DeleteArchivedLibraryModal, LibraryEditorModal } from "./library-modal";
import { LibraryNoteProfileEditorModal } from "./library-profile-modal";
import { errorMessage, type LibraryDefinition } from "./model";
import { calculateModalViewportLayout, ConfirmModal } from "./modals";
import { createOpenedBaseGuard, type OpenedBaseGuard } from "./opened-base-guard";

type LibrarySettingsSection = "general" | "display" | "creation";

/** One discoverable entry point for Library identity, presentation, and creation. */
export class LibrarySettingsModal extends Modal {
  private readonly openedBaseId: string;
  private guardOpenedBase: OpenedBaseGuard;
  private originalLibraryFingerprint = "";
  private originalDisplayFingerprint = "";
  private section: LibrarySettingsSection = "general";
  private draft: LibraryDisplayProfile;
  private visiblePropertiesText: string;
  private busy = false;
  private stale = false;
  private error = "";
  private previewEl: HTMLElement | null = null;
  private errorEl: HTMLElement | null = null;
  private viewportWindow: Window | null = null;
  private focusTimer: number | null = null;

  constructor(
    private readonly plugin: EntVaultCommandCenterPlugin,
    private library: LibraryDefinition,
    private readonly onChanged?: () => void,
  ) {
    super(plugin.app);
    this.openedBaseId = plugin.getActiveKnowledgeBaseId();
    this.draft = plugin.getLibraryDisplayProfile(library.id);
    this.visiblePropertiesText = this.draft.visibleProperties.join(", ");
    this.guardOpenedBase = this.captureBaseline();
  }

  onOpen(): void {
    this.modalEl.addClass("ent-cc-library-profile-modal", "ent-cc-library-settings-modal");
    this.contentEl.addClass("ent-cc-modal", "ent-cc-library-settings");
    this.render();
    this.viewportWindow = this.contentEl.ownerDocument.defaultView;
    this.viewportWindow?.visualViewport?.addEventListener("resize", this.syncViewportLayout);
    this.viewportWindow?.visualViewport?.addEventListener("scroll", this.syncViewportLayout);
    this.viewportWindow?.addEventListener("resize", this.syncViewportLayout);
    this.contentEl.addEventListener("focusin", this.handleFocus);
    this.syncViewportLayout();
  }

  onClose(): void {
    this.viewportWindow?.visualViewport?.removeEventListener("resize", this.syncViewportLayout);
    this.viewportWindow?.visualViewport?.removeEventListener("scroll", this.syncViewportLayout);
    this.viewportWindow?.removeEventListener("resize", this.syncViewportLayout);
    this.contentEl.removeEventListener("focusin", this.handleFocus);
    if (this.focusTimer !== null) this.viewportWindow?.clearTimeout(this.focusTimer);
    this.viewportWindow = null;
    this.modalEl.style.removeProperty("--ent-cc-modal-visual-height");
    this.modalEl.style.removeProperty("--ent-cc-modal-visual-shift");
  }

  private readonly syncViewportLayout = (): void => {
    const viewWindow = this.viewportWindow;
    if (!viewWindow) return;
    const viewport = viewWindow.visualViewport;
    const layout = calculateModalViewportLayout(
      viewWindow.innerHeight,
      viewport?.height ?? viewWindow.innerHeight,
      viewport?.offsetTop ?? 0,
      Number.parseFloat(viewWindow.getComputedStyle(this.modalEl).getPropertyValue("--keyboard-height")),
    );
    this.modalEl.style.setProperty("--ent-cc-modal-visual-height", `${layout.height}px`);
    this.modalEl.style.setProperty("--ent-cc-modal-visual-shift", `${layout.shift}px`);
  };

  private readonly handleFocus = (event: FocusEvent): void => {
    const target = event.target as HTMLElement | null;
    const viewWindow = this.viewportWindow;
    if (!viewWindow || !target) return;
    if (this.focusTimer !== null) viewWindow.clearTimeout(this.focusTimer);
    this.focusTimer = viewWindow.setTimeout(() => {
      this.syncViewportLayout();
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, 80);
  };

  private captureBaseline(): OpenedBaseGuard {
    this.originalLibraryFingerprint = JSON.stringify(this.plugin.getLibrary(this.library.id));
    this.originalDisplayFingerprint = JSON.stringify(this.plugin.getLibraryDisplayProfile(this.library.id));
    return createOpenedBaseGuard(this.plugin, {
      message: "The knowledge base or library settings changed. Close and reopen Library settings before saving your draft.",
      onStale: () => this.markStale(),
    });
  }

  private markStale(): void {
    this.stale = true;
    this.showError("The knowledge base or library settings changed. Close and reopen Library settings before saving your draft.");
    for (const control of this.contentEl.querySelectorAll<HTMLInputElement>(".ent-cc-library-settings-mutation")) {
      control.disabled = true;
    }
  }

  private isCurrent(): boolean {
    if (!this.guardOpenedBase()) return false;
    if (JSON.stringify(this.plugin.getLibrary(this.library.id)) !== this.originalLibraryFingerprint
      || JSON.stringify(this.plugin.getLibraryDisplayProfile(this.library.id)) !== this.originalDisplayFingerprint) {
      this.markStale();
      return false;
    }
    if (this.plugin.isDataReadOnly()) {
      this.showError("Library settings are read-only because knowledge-base data is protected.");
      return false;
    }
    return true;
  }

  private mutationDisabled(): boolean {
    return this.busy || this.stale || this.plugin.isDataReadOnly();
  }

  private render(focusLabel?: string): void {
    this.contentEl.empty();
    this.previewEl = null;
    this.contentEl.setAttribute("aria-busy", String(this.busy));
    this.titleEl.setText(`Library settings — ${this.library.name}`);
    this.contentEl.createEl("p", {
      cls: "ent-cc-modal-lead",
      text: "Customize this library in the current knowledge base. Display changes apply to its existing notes without editing note content.",
    });
    if (this.plugin.isDataReadOnly()) {
      this.contentEl.createDiv({ cls: "ent-cc-catalog-context", text: "Library settings are read-only because knowledge-base data is protected.", attr: { role: "status" } });
    }
    const nav = this.contentEl.createDiv({ cls: "ent-cc-library-settings-nav", attr: { role: "group", "aria-label": "Library settings sections" } });
    for (const [section, label] of [["general", "General"], ["display", "Display"], ["creation", "Note creation"]] as const) {
      const button = this.button(nav, label, () => { this.section = section; this.render(label); }, false);
      button.setAttribute("aria-pressed", String(this.section === section));
      button.toggleClass("is-selected", this.section === section);
    }
    const panel = this.contentEl.createDiv({ cls: "ent-cc-library-settings-panel" });
    if (this.section === "general") this.renderGeneral(panel);
    else if (this.section === "display") this.renderDisplay(panel);
    else this.renderCreation(panel);
    this.errorEl = this.contentEl.createDiv({ cls: "ent-cc-form-error", text: this.error, attr: { role: "alert", "aria-live": "assertive" } });
    const footer = this.contentEl.createDiv({ cls: "ent-cc-library-settings-footer" });
    this.button(footer, "Close", () => this.close(), false);
    if (this.section === "display") {
      this.button(footer, "Reset display", () => void this.saveDisplay(true));
      this.button(footer, this.busy ? "Saving…" : "Save display", () => void this.saveDisplay(false)).addClass("mod-cta");
    }
    if (focusLabel) {
      const buttons = Array.from(this.contentEl.querySelectorAll<HTMLButtonElement>("button"));
      const target = buttons.find((button) => button.getAttribute("aria-label") === focusLabel && !button.disabled)
        ?? buttons.find((button) => button.getAttribute("aria-pressed") === "true");
      target?.focus({ preventScroll: true });
    }
  }

  private renderGeneral(parent: HTMLElement): void {
    parent.createEl("h3", { text: this.library.name, attr: { dir: "auto" } });
    parent.createEl("p", { text: `Singular item name: ${this.library.singularName}. Icon: ${this.library.icon}.`, attr: { dir: "auto" } });
    this.button(parent, "Rename…", () => {
      if (!this.isCurrent()) return;
      new LibraryEditorModal(this.plugin, this.library, () => this.afterMutation("Rename…")).open();
    });
    parent.createEl("p", { text: "Rename also lets you change the singular item name and tab icon." });
    parent.createEl("h3", { text: this.library.archivedAt === null ? "Archive library" : "Archived library" });
    parent.createEl("p", {
      text: this.library.sourceKind !== null
        ? "This built-in library can be renamed, customized, or archived. Permanent deletion is unavailable because its source classification is retained."
        : this.library.archivedAt === null
          ? "Archive hides the tab and preserves all records and headings. Permanent deletion becomes available after archiving."
          : "Restore returns this library to the tab bar. Permanent deletion removes its organization after you choose where its records should go. Markdown notes are preserved.",
    });
    if (this.library.archivedAt === null) {
      this.button(parent, "Archive…", () => {
        if (!this.isCurrent()) return;
        new ConfirmModal(this.app, "Archive library?", `Archive “${this.library.name}” and hide its tab? Its records, headings, and Markdown notes remain available for restoration.`, "Archive library", async () => {
          if (this.isCurrent()) await this.runMutation(() => this.plugin.archiveLibrary(this.library.id));
        }).open();
      });
    } else {
      this.button(parent, "Restore library", () => void this.runMutation(() => this.plugin.restoreLibrary(this.library.id)));
      if (this.library.sourceKind === null) {
        this.button(parent, "Delete permanently…", () => {
          if (!this.isCurrent()) return;
          new DeleteArchivedLibraryModal(this.plugin, this.library, this.plugin.librarySubjectCount(this.library.id), () => {
            this.onChanged?.();
            this.close();
          }).open();
        }).addClass("mod-warning");
      }
    }
  }

  private renderDisplay(parent: HTMLElement): void {
    this.select(parent, "Layout", "Choose a compact list or a cover gallery for this library.", { list: "List", cards: "Cards" }, this.draft.layout, (value) => {
      this.draft.layout = value as LibraryDisplayProfile["layout"];
    });
    this.textInput(parent, "Image property", "The note property containing a vault image link, such as cover. Example: cover: \"[[Covers/My book.jpg]]\".", this.draft.imageProperty, MAX_LIBRARY_DISPLAY_PROPERTY_LENGTH, (value) => {
      this.draft.imageProperty = value;
    });
    this.select(parent, "Card size", "Controls card width and the size of its cover image.", { small: "Small", medium: "Medium", large: "Large" }, this.draft.cardSize, (value) => {
      this.draft.cardSize = value as LibraryDisplayProfile["cardSize"];
    });
    this.select(parent, "Image proportions", "Portrait suits book covers; square and landscape suit other libraries.", { portrait: "Portrait", square: "Square", landscape: "Landscape" }, this.draft.imageRatio, (value) => {
      this.draft.imageRatio = value as LibraryDisplayProfile["imageRatio"];
    });
    this.select(parent, "Image fit", "Show the complete image or crop it to fill the image area.", { contain: "Show whole image", cover: "Crop to fill" }, this.draft.imageFit, (value) => {
      this.draft.imageFit = value as LibraryDisplayProfile["imageFit"];
    });
    this.textInput(parent, "Visible properties", `Up to ${MAX_LIBRARY_VISIBLE_PROPERTIES} comma-separated property names, shown beneath the title. Leave empty for titles only.`, this.visiblePropertiesText, (MAX_LIBRARY_DISPLAY_PROPERTY_LENGTH + 2) * MAX_LIBRARY_VISIBLE_PROPERTIES, (value) => {
      this.visiblePropertiesText = value;
    });
    const preview = parent.createDiv({ cls: "ent-cc-library-profile-summary", attr: { role: "status", "aria-live": "polite" } });
    preview.createDiv({ cls: "ent-cc-path-preview-label", text: "Display preview" });
    this.previewEl = preview.createDiv({ cls: "ent-cc-library-profile-summary-value" });
    this.updatePreview();
    const covers = parent.createDiv({ cls: "ent-cc-library-cover-info" });
    covers.createEl("h3", { text: "Cover images" });
    covers.createEl("p", { text: "Covers use images stored in this vault. Online images are not supported in this release." });
  }

  private renderCreation(parent: HTMLElement): void {
    parent.createEl("h3", { text: "Note creation defaults" });
    if (!this.guardOpenedBase.owns()
      || JSON.stringify(this.plugin.getLibrary(this.library.id)) !== this.originalLibraryFingerprint) {
      parent.createEl("p", { text: "Reopen library settings to inspect the current note creation defaults." });
      return;
    }
    const effective = this.plugin.getEffectiveLibraryNoteProfile(this.library.id);
    parent.createEl("p", { text: `Destination: ${effective.folder || "Vault root"}. Starting content: ${effective.mode === "empty" ? "Empty note" : `Template ${effective.templatePath || "not selected"}`}.`, attr: { dir: "auto" } });
    parent.createEl("p", { text: "Set a destination folder and starting content for new notes in this library, or inherit the knowledge base defaults." });
    this.button(parent, "Edit note creation defaults…", () => {
      if (!this.isCurrent()) return;
      new LibraryNoteProfileEditorModal(this.plugin, this.library, () => this.afterMutation("Edit note creation defaults…")).open();
    });
  }

  private field(parent: HTMLElement, name: string, description: string): HTMLElement {
    const setting = parent.createDiv({ cls: "setting-item" });
    const info = setting.createDiv({ cls: "setting-item-info" });
    info.createDiv({ cls: "setting-item-name", text: name });
    info.createDiv({ cls: "setting-item-description", text: description });
    return setting.createDiv({ cls: "setting-item-control" });
  }

  private textInput(parent: HTMLElement, name: string, description: string, value: string, maxLength: number, onChange: (value: string) => void): void {
    const input = this.field(parent, name, description).createEl("input", { type: "text", value, cls: "ent-cc-library-settings-mutation", attr: { "aria-label": name, dir: "auto" } });
    input.maxLength = maxLength;
    input.disabled = this.mutationDisabled();
    input.addEventListener("input", () => { onChange(input.value); this.updatePreview(); });
  }

  private select(parent: HTMLElement, name: string, description: string, options: Record<string, string>, value: string, onChange: (value: string) => void): void {
    const select = this.field(parent, name, description).createEl("select", { cls: "ent-cc-library-settings-mutation", attr: { "aria-label": name } });
    for (const [key, label] of Object.entries(options)) select.createEl("option", { value: key, text: label });
    select.value = value;
    select.disabled = this.mutationDisabled();
    select.addEventListener("change", () => { onChange(select.value); this.updatePreview(); });
  }

  private button(parent: HTMLElement, label: string, action: () => void, mutation = true): HTMLButtonElement {
    const button = parent.createEl("button", { type: "button", text: label, cls: `ent-cc-button${mutation ? " ent-cc-library-settings-mutation" : ""}`, attr: { "aria-label": label } });
    button.disabled = mutation && this.mutationDisabled();
    button.addEventListener("click", action);
    return button;
  }

  private updatePreview(): void {
    const properties = this.propertyNames();
    this.previewEl?.setText(this.draft.layout === "list"
      ? "List layout. Your card and image choices are saved for when you switch to Cards."
      : `${this.draft.cardSize} cards · ${this.draft.imageRatio} images · ${this.draft.imageFit === "contain" ? "whole image" : "cropped to fill"} · image property: ${this.draft.imageProperty.trim() || "none"} · title${properties.length ? `, ${properties.join(", ")}` : " only"}`);
  }

  private propertyNames(): string[] {
    return [...new Set(this.visiblePropertiesText.split(",").map((value) => value.trim()).filter(Boolean))];
  }

  private showError(message: string): void {
    this.error = message;
    this.errorEl?.setText(message);
  }

  private async saveDisplay(reset: boolean): Promise<void> {
    if (this.busy || !this.isCurrent()) return;
    const properties = this.propertyNames();
    if (!reset && properties.length > MAX_LIBRARY_VISIBLE_PROPERTIES) {
      this.showError(`Choose at most ${MAX_LIBRARY_VISIBLE_PROPERTIES} visible properties.`);
      return;
    }
    await this.runMutation(async () => {
      await this.plugin.setLibraryDisplayProfile(this.library.id, reset ? null : { ...this.draft, imageProperty: this.draft.imageProperty.trim(), visibleProperties: properties });
      this.draft = this.plugin.getLibraryDisplayProfile(this.library.id);
      this.visiblePropertiesText = this.draft.visibleProperties.join(", ");
      new Notice(reset ? "Library display reset to defaults." : `Saved display settings for ${this.library.name}.`);
    });
  }

  private afterMutation(focusLabel?: string): void {
    if (this.plugin.getActiveKnowledgeBaseId() !== this.openedBaseId) { this.close(); return; }
    const library = this.plugin.getLibrary(this.library.id);
    if (!library) { this.close(); return; }
    this.library = library;
    this.guardOpenedBase = this.captureBaseline();
    this.stale = false;
    this.error = "";
    this.onChanged?.();
    this.render(focusLabel);
  }

  private async runMutation(action: () => Promise<void>): Promise<void> {
    if (this.busy || !this.isCurrent()) return;
    const focusLabel = this.contentEl.ownerDocument.activeElement?.getAttribute("aria-label") ?? undefined;
    this.busy = true;
    this.render();
    try {
      await action();
      this.busy = false;
      this.afterMutation(focusLabel);
    } catch (error) {
      this.busy = false;
      this.error = errorMessage(error);
      this.render(focusLabel);
    }
  }
}
