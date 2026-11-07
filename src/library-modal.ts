import { Modal, Notice, Setting, setIcon } from "obsidian";
import type EntVaultCommandCenterPlugin from "./main";
import {
  DeleteArchivedLibraryModal,
  LibraryEditorModal,
  reportLibraryError,
} from "./library-form-modals";
import { resolveLibraryIconId } from "./library-icons";
import type { LibraryDefinition } from "./model";
import { ConfirmModal } from "./modals";
import { LibrarySettingsModal } from "./library-settings-modal";

// Compatibility re-export: the classes live in the library-form-modals leaf.
export { DeleteArchivedLibraryModal, LibraryEditorModal } from "./library-form-modals";

const NEW_LIBRARY_FOCUS_KEY = "library-new";

function libraryActionFocusKey(libraryId: string, action: string): string {
  return `library-${libraryId}-${action}`;
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
    copy.createDiv({
      cls: "ent-cc-picker-meta",
      text: library.sourceKind !== null
        ? "Built-in library: rename, customize, or archive. Permanent deletion is unavailable because its source classification is retained."
        : archived
          ? "Archived: restore, rename, customize, or permanently delete."
          : "Rename and choose a layout in Library settings. Archive first to make permanent deletion available.",
    });
    const actions = row.createDiv({ cls: "ent-cc-library-manager-actions" });

    if (archived) {
      this.settingsButton(actions, library);
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
    this.settingsButton(actions, library);
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

  private settingsButton(parent: HTMLElement, library: LibraryDefinition): void {
    this.actionButton(parent, "settings", "Library settings…", () => {
      if (!this.isCurrent()) return;
      const current = this.plugin.getLibrary(library.id);
      if (!current) {
        new Notice("That library is no longer available. Reopen manage libraries.", 8000);
        return;
      }
      new LibrarySettingsModal(this.plugin, current, () => this.afterNestedMutation(
        libraryActionFocusKey(library.id, "edit"),
        NEW_LIBRARY_FOCUS_KEY,
      )).open();
    }, false, false, libraryActionFocusKey(library.id, "edit"), NEW_LIBRARY_FOCUS_KEY);
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
