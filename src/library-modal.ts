import { Modal, Notice, Setting, setIcon } from "obsidian";
import type EntVaultCommandCenterPlugin from "./main";
import {
  LIBRARY_ICON_IDS,
  type LibraryDefinitionInput,
  type LibraryRemovalDestination,
} from "./main";
import { resolveLibraryIconId } from "./library-icons";
import { errorMessage, type LibraryDefinition } from "./model";
import { ConfirmModal, modalOwnerWindow } from "./modals";

function reportLibraryError(error: unknown): void {
  console.error("Knowledge Base Command Center library action failed", error);
  new Notice(errorMessage(error), 8000);
}

function readableIconName(icon: string): string {
  return icon.split("-").map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" ");
}

function suggestedSingular(name: string): string {
  const clean = name.trim();
  if (clean.length > 3 && /ies$/i.test(clean)) return `${clean.slice(0, -3)}y`;
  if (clean.length > 2 && /s$/i.test(clean) && !/ss$/i.test(clean)) return clean.slice(0, -1);
  return clean;
}

const NEW_LIBRARY_FOCUS_KEY = "library-new";

function libraryActionFocusKey(libraryId: string, action: string): string {
  return `library-${libraryId}-${action}`;
}

/** Definition-only fingerprint: editing a label/icon must never overwrite a newer library revision. */
function libraryDefinitionFingerprint(library: LibraryDefinition): string {
  return JSON.stringify([
    library.id,
    library.name,
    library.singularName,
    library.icon,
    library.order,
    library.sourceKind,
    library.archivedAt,
  ]);
}

/** Create or edit one top-level library without deriving identity from its editable name. */
export class LibraryEditorModal extends Modal {
  private readonly openedBaseId: string;
  private readonly openedDataEpoch: number;
  private readonly existingId: string | null;
  private readonly originalFingerprint: string | null;
  private name: string;
  private singularName: string;
  private singularEdited: boolean;
  private icon: string;
  private busy = false;
  private error = "";
  private focusNameAfterRender = true;
  private nameInputEl: HTMLInputElement | null = null;
  private singularInputEl: HTMLInputElement | null = null;
  private errorEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private submitButtonEl: HTMLButtonElement | null = null;
  private iconButtonEls = new Map<string, HTMLButtonElement>();

  constructor(
    private readonly plugin: EntVaultCommandCenterPlugin,
    existing: LibraryDefinition | null,
    private readonly onSaved?: (libraryId: string) => void,
  ) {
    super(plugin.app);
    this.openedBaseId = plugin.getActiveKnowledgeBaseId();
    this.openedDataEpoch = plugin.getDataEpoch();
    this.existingId = existing?.id ?? null;
    this.originalFingerprint = existing ? libraryDefinitionFingerprint(existing) : null;
    this.name = existing?.name ?? "";
    this.singularName = existing?.singularName ?? "";
    this.singularEdited = Boolean(existing);
    this.icon = existing?.icon ?? "library";
  }

  onOpen(): void {
    this.modalEl.addClass("ent-cc-library-modal", "ent-cc-library-editor-modal");
    this.contentEl.addClass("ent-cc-modal", "ent-cc-library-editor");
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    this.titleEl.setText(this.existingId ? "Edit library" : "New library");
    this.contentEl.createEl("p", {
      text: this.existingId
        ? "Change the tab label and icon. Its stable identity, records, headings, and Markdown notes stay unchanged."
        : "Create a top-level tab inside this knowledge base. You can then add notes and organize them under headings and subheadings.",
    });
    this.contentEl.createDiv({
      cls: "ent-cc-library-terminology-note",
      text: "A library is a section inside the current knowledge base—not another knowledge base, an Obsidian .base file, or a Collection.",
    });

    new Setting(this.contentEl)
      .setName("Library name")
      .setDesc("Plural tab label, for example guidelines, devices, or radiology.")
      .addText((text) => {
        this.nameInputEl = text.inputEl;
        text.inputEl.maxLength = 100;
        text.inputEl.dir = "auto";
        text.inputEl.setAttribute("aria-required", "true");
        text.setPlaceholder("Guidelines").setValue(this.name).setDisabled(this.busy).onChange((value) => {
          this.name = value;
          if (!this.singularEdited) {
            this.singularName = suggestedSingular(value);
            if (this.singularInputEl) this.singularInputEl.value = this.singularName;
          }
          this.error = "";
          this.updateState();
        });
      });

    new Setting(this.contentEl)
      .setName("Singular item name")
      .setDesc("Used in actions such as “create guideline”.")
      .addText((text) => {
        this.singularInputEl = text.inputEl;
        text.inputEl.maxLength = 100;
        text.inputEl.dir = "auto";
        text.inputEl.setAttribute("aria-required", "true");
        text.setPlaceholder("Guideline").setValue(this.singularName).setDisabled(this.busy).onChange((value) => {
          this.singularName = value;
          this.singularEdited = true;
          this.error = "";
          this.updateState();
        });
      });

    const iconSection = this.contentEl.createDiv({ cls: "ent-cc-library-icon-section" });
    iconSection.createEl("h3", { text: "Icon" });
    iconSection.createEl("p", { text: "Choose the icon shown in the library tab." });
    const iconGrid = iconSection.createDiv({
      cls: "ent-cc-library-icon-grid",
      attr: { role: "group", "aria-label": "Library icon" },
    });
    const displayedIcon = resolveLibraryIconId(this.icon);
    this.iconButtonEls.clear();
    for (const icon of LIBRARY_ICON_IDS) {
      const label = readableIconName(icon);
      const button = iconGrid.createEl("button", {
        cls: `ent-cc-library-icon-choice ${displayedIcon === icon ? "is-selected" : ""}`,
        type: "button",
        attr: {
          "aria-label": label,
          "aria-pressed": String(displayedIcon === icon),
          title: label,
        },
      });
      this.iconButtonEls.set(icon, button);
      setIcon(button, icon);
      button.disabled = this.busy;
      button.addEventListener("click", () => this.selectIcon(icon, button));
    }

    const feedback = this.contentEl.createDiv({
      cls: "ent-cc-library-form-feedback",
      attr: { "aria-live": "polite" },
    });
    this.errorEl = feedback.createSpan({ cls: "ent-cc-library-form-error" });
    this.countEl = feedback.createSpan({ cls: "ent-cc-library-form-count" });

    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").setDisabled(this.busy).onClick(() => this.close()))
      .addButton((button) => {
        this.submitButtonEl = button.buttonEl;
        button
          .setButtonText(this.busy ? "Saving…" : this.existingId ? "Save changes" : "Create library")
          .setCta()
          .onClick(() => void this.submit());
      });
    this.updateState();
    if (!this.busy && this.focusNameAfterRender) {
      this.focusNameAfterRender = false;
      modalOwnerWindow(this.contentEl).setTimeout(() => this.nameInputEl?.focus(), 40);
    }
  }

  private updateState(): void {
    this.errorEl?.setText(this.error);
    this.countEl?.setText(`${this.name.length}/100 · ${this.singularName.length}/100`);
    this.nameInputEl?.setAttribute("aria-invalid", String(Boolean(this.error)));
    this.singularInputEl?.setAttribute("aria-invalid", String(Boolean(this.error)));
    if (this.submitButtonEl) {
      this.submitButtonEl.disabled = this.busy || !this.name.trim() || !this.singularName.trim();
    }
  }

  /** Keep keyboard focus and the existing form controls while changing only icon choice state. */
  private selectIcon(icon: string, button: HTMLButtonElement): void {
    if (this.busy || this.icon === icon) {
      button.focus({ preventScroll: true });
      return;
    }
    this.icon = icon;
    this.error = "";
    for (const [candidate, choice] of this.iconButtonEls) {
      const selected = candidate === icon;
      choice.toggleClass("is-selected", selected);
      choice.setAttribute("aria-pressed", String(selected));
    }
    this.updateState();
    button.focus({ preventScroll: true });
  }

  private isCurrent(): boolean {
    if (this.plugin.getActiveKnowledgeBaseId() === this.openedBaseId
      && this.plugin.getDataEpoch() === this.openedDataEpoch) return true;
    new Notice("The active knowledge base or its libraries changed. Reopen this dialog before continuing.", 8000);
    return false;
  }

  private existingLibraryIsOriginal(): boolean {
    if (!this.existingId || !this.originalFingerprint) return true;
    const current = this.plugin.getLibrary(this.existingId);
    const message = !current
      ? "This library was deleted after the editor opened. Reopen Manage libraries before continuing."
      : libraryDefinitionFingerprint(current) !== this.originalFingerprint
        ? "This library changed after the editor opened. Reopen it so you do not overwrite newer changes."
        : "";
    if (!message) return true;
    this.error = message;
    this.updateState();
    new Notice(message, 8000);
    return false;
  }

  private async submit(): Promise<void> {
    if (this.busy || !this.isCurrent() || !this.existingLibraryIsOriginal()) return;
    const input: LibraryDefinitionInput = {
      name: this.name,
      singularName: this.singularName,
      icon: this.icon,
    };
    this.busy = true;
    this.error = "";
    this.render();
    try {
      const libraryId = this.existingId ?? await this.plugin.createLibrary(input);
      if (this.existingId) await this.plugin.updateLibrary(this.existingId, input);
      this.close();
      this.onSaved?.(libraryId);
      new Notice(`${this.existingId ? "Updated" : "Created"} library “${input.name.trim()}”. Markdown notes were not changed.`);
    } catch (error) {
      this.busy = false;
      this.error = errorMessage(error);
      this.focusNameAfterRender = true;
      this.render();
      reportLibraryError(error);
    }
  }
}

/** Destructive removal is available only after a custom library has been archived. */
export class DeleteArchivedLibraryModal extends Modal {
  private readonly openedBaseId: string;
  private readonly openedDataEpoch: number;
  private destinationValue = "";
  private busy = false;
  private error = "";
  private submitButtonEl: HTMLButtonElement | null = null;
  private errorEl: HTMLElement | null = null;

  constructor(
    private readonly plugin: EntVaultCommandCenterPlugin,
    private readonly library: LibraryDefinition,
    private readonly subjectCount: number,
    private readonly onDeleted: () => void,
  ) {
    super(plugin.app);
    this.openedBaseId = plugin.getActiveKnowledgeBaseId();
    this.openedDataEpoch = plugin.getDataEpoch();
  }

  onOpen(): void {
    this.modalEl.addClass("ent-cc-library-modal", "ent-cc-library-delete-modal");
    this.contentEl.addClass("ent-cc-modal");
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    this.titleEl.setText("Permanently delete archived library?");
    this.contentEl.createEl("p", {
      text: `This removes the “${this.library.name}” tab and its plugin-owned heading structure. Markdown files are never deleted, moved, renamed, or rewritten.`,
      attr: { dir: "auto" },
    });

    if (this.subjectCount > 0) {
      new Setting(this.contentEl)
        .setName(`Destination for ${this.subjectCount} ${this.subjectCount === 1 ? this.library.singularName : this.library.name}`)
        .setDesc("Choose where every record will go before the library is removed. Destinations that conflict with protected clinical source classification are omitted. Collection membership, pins, links, and note files remain unchanged.")
        .addDropdown((dropdown) => {
          const options: Record<string, string> = {
            "": "Choose a destination…",
            unassigned: "Leave unassigned in this knowledge base",
          };
          if (!this.plugin.getLibraryRemovalDestinationError(this.library.id, "index")) {
            options.index = this.plugin.data.settings.indexLabel;
          }
          for (const candidate of this.plugin.getLibraries()) {
            const destination: LibraryRemovalDestination = { libraryId: candidate.id };
            if (candidate.id !== this.library.id
              && !this.plugin.getLibraryRemovalDestinationError(this.library.id, destination)) {
              options[`library:${candidate.id}`] = candidate.name;
            }
          }
          dropdown.addOptions(options).setValue(this.destinationValue).setDisabled(this.busy).onChange((value) => {
            this.destinationValue = value;
            this.error = "";
            this.updateState();
          });
          dropdown.selectEl.setAttribute("aria-required", "true");
        });
    } else {
      this.contentEl.createDiv({
        cls: "ent-cc-library-delete-empty-note",
        text: "This archived library contains no records. No destination is required.",
      });
    }

    this.errorEl = this.contentEl.createDiv({
      cls: "ent-cc-library-form-error",
      attr: { role: "alert", "aria-live": "assertive" },
    });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").setDisabled(this.busy).onClick(() => this.close()))
      .addButton((button) => {
        this.submitButtonEl = button.buttonEl;
        button
          .setButtonText(this.busy ? "Deleting…" : "Delete library")
          .setDestructive()
          .onClick(() => void this.submit());
      });
    this.updateState();
  }

  private updateState(): void {
    this.errorEl?.setText(this.error);
    if (this.submitButtonEl) {
      this.submitButtonEl.disabled = this.busy || (this.subjectCount > 0 && !this.destinationValue);
    }
  }

  private isCurrent(): boolean {
    if (this.plugin.getActiveKnowledgeBaseId() === this.openedBaseId
      && this.plugin.getDataEpoch() === this.openedDataEpoch) return true;
    new Notice("The active knowledge base or its libraries changed. Reopen this confirmation before continuing.", 8000);
    return false;
  }

  private destination(): LibraryRemovalDestination {
    if (this.subjectCount === 0 || this.destinationValue === "unassigned") return "unassigned";
    if (this.destinationValue === "index") return "index";
    if (this.destinationValue.startsWith("library:")) {
      return { libraryId: this.destinationValue.slice("library:".length) };
    }
    throw new Error("Choose a destination for the library records.");
  }

  private async submit(): Promise<void> {
    if (this.busy || !this.isCurrent()) return;
    this.busy = true;
    this.error = "";
    this.render();
    try {
      await this.plugin.deleteLibrary(this.library.id, this.destination());
      this.close();
      this.onDeleted();
      new Notice(`Deleted archived library “${this.library.name}”. Markdown notes were not changed.`);
    } catch (error) {
      this.busy = false;
      this.error = errorMessage(error);
      this.render();
      reportLibraryError(error);
    }
  }
}

export class ManageLibrariesModal extends Modal {
  private readonly openedBaseId: string;
  private expectedDataEpoch: number;
  private busy = false;
  private staleNoticeShown = false;
  private changed = false;
  private pendingFocusKey: string | null = null;
  private pendingFallbackFocusKey: string | null = null;
  private renderGeneration = 0;

  constructor(
    private readonly plugin: EntVaultCommandCenterPlugin,
    private readonly onChanged?: () => void,
  ) {
    super(plugin.app);
    this.openedBaseId = plugin.getActiveKnowledgeBaseId();
    this.expectedDataEpoch = plugin.getDataEpoch();
  }

  onOpen(): void {
    this.modalEl.addClass("ent-cc-library-modal");
    this.contentEl.addClass("ent-cc-modal", "ent-cc-library-manager");
    this.contentEl.setAttribute("tabindex", "-1");
    this.render();
  }

  onClose(): void {
    this.renderGeneration += 1;
    this.pendingFocusKey = null;
    this.pendingFallbackFocusKey = null;
    if (this.changed) this.onChanged?.();
  }

  private render(focusKey?: string, fallbackFocusKey?: string): void {
    this.renderGeneration += 1;
    this.capturePendingFocus(focusKey, fallbackFocusKey);
    this.contentEl.empty();
    this.contentEl.setAttribute("aria-busy", String(this.busy));
    this.titleEl.setText("Manage libraries");
    this.contentEl.createEl("p", {
      text: `Libraries are top-level tabs inside “${this.plugin.data.settings.workspaceName}”. Each library has independent headings and subheadings, while every Markdown note remains in its original vault location.`,
      attr: { dir: "auto" },
    });
    this.contentEl.createDiv({
      cls: "ent-cc-library-terminology-note",
      text: "Knowledge base = independent profile. Library = top-level category inside that profile. Collection = a reusable cross-category list.",
    });

    const toolbar = this.contentEl.createDiv({ cls: "ent-cc-library-manager-toolbar" });
    const create = toolbar.createEl("button", {
      cls: "ent-cc-button ent-cc-add-button",
      type: "button",
      attr: {
        "data-library-focus": NEW_LIBRARY_FOCUS_KEY,
        "data-library-focus-fallback": NEW_LIBRARY_FOCUS_KEY,
      },
    });
    setIcon(create.createSpan(), "plus");
    create.createSpan({ text: "New library" });
    create.disabled = this.busy;
    create.addEventListener("click", () => {
      if (!this.isCurrent()) return;
      this.setPendingFocus(NEW_LIBRARY_FOCUS_KEY, NEW_LIBRARY_FOCUS_KEY);
      new LibraryEditorModal(this.plugin, null, (libraryId) => this.afterNestedMutation(
        libraryActionFocusKey(libraryId, "edit"),
        NEW_LIBRARY_FOCUS_KEY,
      )).open();
    });

    const allLibraries = this.plugin.getLibraries(true);
    const available = allLibraries.filter((library) => library.archivedAt === null);
    const archived = allLibraries.filter((library) => library.archivedAt !== null);
    this.contentEl.createEl("h3", { text: "Active libraries" });
    const activeList = this.contentEl.createDiv({ cls: "ent-cc-library-manager-list" });
    if (available.length === 0) {
      activeList.createDiv({ cls: "ent-cc-library-manager-empty", text: "No active libraries yet. Create one to add a top-level tab." });
    }
    for (const [index, library] of available.entries()) {
      this.renderLibrary(activeList, library, false, index, available, allLibraries);
    }

    if (archived.length > 0) {
      this.contentEl.createEl("h3", { text: "Archived libraries" });
      const archivedList = this.contentEl.createDiv({ cls: "ent-cc-library-manager-list" });
      for (const library of archived) this.renderLibrary(archivedList, library, true, -1, available, allLibraries);
    }

    new Setting(this.contentEl)
      .addButton((button) => {
        button.buttonEl.setAttribute("data-library-focus", "library-close");
        button.buttonEl.setAttribute("data-library-focus-fallback", NEW_LIBRARY_FOCUS_KEY);
        button.setButtonText("Close").setDisabled(this.busy).onClick(() => this.close());
      });
    this.restorePendingFocus();
  }

  private renderLibrary(
    parent: HTMLElement,
    library: LibraryDefinition,
    archived: boolean,
    activeIndex: number,
    activeLibraries: LibraryDefinition[],
    allLibraries: LibraryDefinition[],
  ): void {
    const count = this.plugin.librarySubjectCount(library.id);
    const row = parent.createDiv({ cls: `ent-cc-library-manager-row ${archived ? "is-archived" : ""}` });
    const icon = row.createDiv({ cls: "ent-cc-library-manager-icon", attr: { "aria-hidden": "true" } });
    setIcon(icon, resolveLibraryIconId(library.icon));
    const copy = row.createDiv({ cls: "ent-cc-library-manager-copy" });
    const title = copy.createDiv({ cls: "ent-cc-library-manager-title" });
    title.createSpan({ text: library.name, attr: { dir: "auto", title: library.name } });
    if (library.sourceKind) title.createSpan({ cls: "ent-cc-library-badge", text: "Built-in" });
    if (archived) title.createSpan({ cls: "ent-cc-library-badge", text: "Archived" });
    copy.createDiv({
      cls: "ent-cc-picker-meta",
      text: `${count} ${count === 1 ? library.singularName : library.name} · ${library.singularName} / ${library.name}`,
      attr: { dir: "auto" },
    });
    const actions = row.createDiv({ cls: "ent-cc-library-manager-actions" });

    if (archived) {
      this.actionButton(actions, "archive-restore", "Restore", () => void this.run(async () => {
        await this.plugin.restoreLibrary(library.id);
      }), false, false, libraryActionFocusKey(library.id, "restore"), libraryActionFocusKey(library.id, "edit"));
      if (library.sourceKind === null) {
        this.actionButton(actions, "trash-2", "Delete permanently", () => {
          if (!this.isCurrent()) return;
          new DeleteArchivedLibraryModal(this.plugin, library, count, () => this.afterNestedMutation(
            NEW_LIBRARY_FOCUS_KEY,
            "library-close",
          )).open();
        }, false, true, libraryActionFocusKey(library.id, "delete"), NEW_LIBRARY_FOCUS_KEY);
      }
      return;
    }

    const currentAllIndex = allLibraries.findIndex((candidate) => candidate.id === library.id);
    const previousActive = activeLibraries[activeIndex - 1];
    const nextActive = activeLibraries[activeIndex + 1];
    const previousAllIndex = previousActive
      ? allLibraries.findIndex((candidate) => candidate.id === previousActive.id)
      : -1;
    const nextAllIndex = nextActive
      ? allLibraries.findIndex((candidate) => candidate.id === nextActive.id)
      : -1;
    this.actionButton(actions, "arrow-up", "Move up", () => void this.run(async () => {
      await this.plugin.reorderLibrary(library.id, previousAllIndex);
    }), activeIndex <= 0 || currentAllIndex < 0 || previousAllIndex < 0, false,
    libraryActionFocusKey(library.id, "move-up"), libraryActionFocusKey(library.id, "edit"));
    this.actionButton(actions, "arrow-down", "Move down", () => void this.run(async () => {
      await this.plugin.reorderLibrary(library.id, nextAllIndex);
    }), activeIndex < 0 || activeIndex >= activeLibraries.length - 1 || currentAllIndex < 0 || nextAllIndex < 0, false,
    libraryActionFocusKey(library.id, "move-down"), libraryActionFocusKey(library.id, "edit"));
    this.actionButton(actions, "pencil", "Edit", () => {
      if (!this.isCurrent()) return;
      const current = this.plugin.getLibrary(library.id);
      if (!current) {
        new Notice("That library is no longer available. Reopen manage libraries.", 8000);
        return;
      }
      new LibraryEditorModal(this.plugin, current, () => this.afterNestedMutation(
        libraryActionFocusKey(library.id, "edit"),
        NEW_LIBRARY_FOCUS_KEY,
      )).open();
    }, false, false, libraryActionFocusKey(library.id, "edit"), NEW_LIBRARY_FOCUS_KEY);
    this.actionButton(actions, "archive", "Archive", () => {
      if (!this.isCurrent()) return;
      new ConfirmModal(
        this.app,
        "Archive library?",
        `“${library.name}” will leave the tab bar and move destinations, but its ${count} records and exact heading structure remain fully restorable. If it is the current or default tab, ${this.plugin.data.settings.indexLabel} becomes the fallback. No Markdown note will be changed.`,
        "Archive library",
        async () => {
          if (!this.isCurrent()) return;
          await this.plugin.archiveLibrary(library.id);
          this.afterNestedMutation(
            libraryActionFocusKey(library.id, "restore"),
            NEW_LIBRARY_FOCUS_KEY,
          );
        },
      ).open();
    }, false, false, libraryActionFocusKey(library.id, "archive"), libraryActionFocusKey(library.id, "restore"));
  }

  private actionButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    action: () => void,
    disabled = false,
    destructive = false,
    focusKey = "",
    fallbackFocusKey = NEW_LIBRARY_FOCUS_KEY,
  ): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: `ent-cc-button ent-cc-library-manager-action ${destructive ? "mod-warning" : ""}`,
      type: "button",
      attr: {
        "aria-label": label,
        title: label,
        ...(focusKey ? { "data-library-focus": focusKey } : {}),
        ...(fallbackFocusKey ? { "data-library-focus-fallback": fallbackFocusKey } : {}),
      },
    });
    setIcon(button.createSpan(), icon);
    button.createSpan({ text: label });
    button.disabled = this.busy || disabled;
    button.addEventListener("click", () => {
      if (focusKey) this.setPendingFocus(focusKey, fallbackFocusKey);
      action();
    });
    return button;
  }

  private setPendingFocus(focusKey: string, fallbackFocusKey = NEW_LIBRARY_FOCUS_KEY): void {
    this.pendingFocusKey = focusKey;
    this.pendingFallbackFocusKey = fallbackFocusKey;
  }

  private capturePendingFocus(focusKey?: string, fallbackFocusKey?: string): void {
    if (focusKey) {
      this.setPendingFocus(focusKey, fallbackFocusKey);
      return;
    }
    const active = this.contentEl.ownerDocument.activeElement;
    if (!active || !this.contentEl.contains(active)) return;
    const activeFocusKey = active.getAttribute("data-library-focus");
    if (!activeFocusKey) return;
    this.setPendingFocus(
      activeFocusKey,
      active.getAttribute("data-library-focus-fallback") ?? NEW_LIBRARY_FOCUS_KEY,
    );
  }

  private restorePendingFocus(): void {
    const focusKey = this.pendingFocusKey;
    if (!focusKey) return;
    const controls = Array.from(this.contentEl.querySelectorAll<HTMLButtonElement>("[data-library-focus]"));
    const enabled = (control: HTMLButtonElement): boolean => !control.disabled;
    const target = controls.find((control) => control.getAttribute("data-library-focus") === focusKey && enabled(control))
      ?? controls.find((control) => control.getAttribute("data-library-focus") === this.pendingFallbackFocusKey && enabled(control));
    const generation = this.renderGeneration;
    const viewWindow = this.contentEl.ownerDocument.defaultView ?? window;
    if (!target) {
      if (!this.busy) {
        this.pendingFocusKey = null;
        this.pendingFallbackFocusKey = null;
      }
      viewWindow.setTimeout(() => {
        if (this.renderGeneration === generation) this.contentEl.focus({ preventScroll: true });
      }, 0);
      return;
    }
    this.pendingFocusKey = null;
    this.pendingFallbackFocusKey = null;
    viewWindow.setTimeout(() => {
      if (this.renderGeneration === generation && this.contentEl.contains(target) && !target.disabled) {
        target.focus({ preventScroll: true });
      }
    }, 0);
  }

  private isCurrent(): boolean {
    if (this.plugin.getActiveKnowledgeBaseId() === this.openedBaseId
      && this.plugin.getDataEpoch() === this.expectedDataEpoch) return true;
    if (!this.staleNoticeShown) {
      this.staleNoticeShown = true;
      new Notice("The active knowledge base or its libraries changed. Close and reopen manage libraries before continuing.", 8000);
    }
    return false;
  }

  private afterNestedMutation(focusKey?: string, fallbackFocusKey?: string): void {
    if (this.plugin.getActiveKnowledgeBaseId() !== this.openedBaseId) {
      this.close();
      return;
    }
    this.expectedDataEpoch = this.plugin.getDataEpoch();
    this.staleNoticeShown = false;
    this.changed = true;
    this.render(focusKey, fallbackFocusKey);
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy || !this.isCurrent()) return;
    this.busy = true;
    this.render();
    try {
      await action();
      this.expectedDataEpoch = this.plugin.getDataEpoch();
      this.staleNoticeShown = false;
      this.changed = true;
      this.busy = false;
      this.render();
    } catch (error) {
      this.busy = false;
      this.render();
      reportLibraryError(error);
    }
  }
}
