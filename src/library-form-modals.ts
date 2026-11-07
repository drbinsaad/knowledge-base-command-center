import { Modal, Notice, Setting, setIcon } from "obsidian";
import type EntVaultCommandCenterPlugin from "./main";
import type { LibraryDefinitionInput, LibraryRemovalDestination } from "./main";
import { resolveLibraryIconId } from "./library-icons";
import { errorMessage, type LibraryDefinition } from "./model";
import { createOpenedBaseGuard, modalOwnerWindow, type OpenedBaseGuard } from "./modals";

/**
 * Temporary local copy of the Library icon choices. The canonical tuple still lives in
 * main.ts; this leaf must not import main at runtime (that would re-create the cycle).
 * tests/library-form-modals.test.ts asserts it stays identical to main's tuple until the
 * tuple moves out of main.ts in its own ticket.
 */
export const LIBRARY_FORM_ICON_IDS = [
  "library", "book-open", "book-copy", "folder", "folders", "bookmark", "archive",
  "clipboard-list", "pill", "dna", "stethoscope", "heart-pulse", "brain", "microscope",
  "flask-conical", "syringe", "activity", "graduation-cap", "file-text", "notebook-tabs",
] as const;

export function reportLibraryError(error: unknown): void {
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

const LIBRARY_STALE_MESSAGE = "The active knowledge base or its libraries changed.";

/**
 * Library form dialogs keep their draft through a settled, unchanged Sync reload
 * and still refuse after a real base change. Every refused press is answered;
 * the shared guard's own once-only notice is deliberately not used here.
 */
function libraryDialogOwnsBase(
  plugin: EntVaultCommandCenterPlugin,
  ownsBase: OpenedBaseGuard,
  reopenAdvice: string,
): boolean {
  if (ownsBase.owns()) return true;
  new Notice(
    plugin.isExternalReloadInProgress?.()
      ? "Checking a synced update. Your draft is still open; try again when the check finishes."
      : `${LIBRARY_STALE_MESSAGE} ${reopenAdvice}`,
    8000,
  );
  return false;
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
  private readonly ownsBase: OpenedBaseGuard;
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
    this.ownsBase = createOpenedBaseGuard(plugin, { message: LIBRARY_STALE_MESSAGE });
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
    for (const icon of LIBRARY_FORM_ICON_IDS) {
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
    return libraryDialogOwnsBase(this.plugin, this.ownsBase, "Reopen this dialog before continuing.");
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
  private readonly ownsBase: OpenedBaseGuard;
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
    this.ownsBase = createOpenedBaseGuard(plugin, { message: LIBRARY_STALE_MESSAGE });
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
    return libraryDialogOwnsBase(this.plugin, this.ownsBase, "Reopen this confirmation before continuing.");
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
