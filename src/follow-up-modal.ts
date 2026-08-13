import { App, Modal, Notice, Setting, TFile, setIcon } from "obsidian";
import {
  allocateFollowUpCategoryId,
  DEFAULT_FOLLOW_UP_CATEGORIES,
  followUpCategoryLabelKey,
  MAX_FOLLOW_UP_CATEGORIES,
  type FollowUpCategoryDefinition,
} from "./follow-up";
import { errorMessage } from "./model";
import { calculateModalViewportLayout, ConfirmModal } from "./modals";

interface QuickAppendFormValue {
  categoryId: string;
  date: string;
  text: string;
}

interface QuickAppendModalOptions {
  categories: FollowUpCategoryDefinition[];
  file: TFile;
  initialDate: string;
  onSubmit: (value: QuickAppendFormValue) => void | Promise<void>;
}

abstract class FollowUpResponsiveModal extends Modal {
  private viewportWindow: Window | null = null;
  private viewportTimers: number[] = [];
  private deferredTimers: Array<{ id: number; owner: Window }> = [];

  protected bindResponsiveViewport(): void {
    const viewWindow = this.contentEl.ownerDocument.defaultView;
    if (!viewWindow) return;
    this.viewportWindow = viewWindow;
    viewWindow.visualViewport?.addEventListener("resize", this.syncViewport);
    viewWindow.visualViewport?.addEventListener("scroll", this.syncViewport);
    viewWindow.addEventListener("resize", this.syncViewport);
    this.contentEl.addEventListener("focusin", this.handleFocus);
    this.scheduleViewportSync();
  }

  protected releaseResponsiveViewport(): void {
    const viewWindow = this.viewportWindow;
    viewWindow?.visualViewport?.removeEventListener("resize", this.syncViewport);
    viewWindow?.visualViewport?.removeEventListener("scroll", this.syncViewport);
    viewWindow?.removeEventListener("resize", this.syncViewport);
    this.contentEl.removeEventListener("focusin", this.handleFocus);
    for (const timer of this.viewportTimers) viewWindow?.clearTimeout(timer);
    for (const timer of this.deferredTimers) timer.owner.clearTimeout(timer.id);
    this.viewportTimers = [];
    this.deferredTimers = [];
    this.viewportWindow = null;
    this.modalEl.style.removeProperty("--ent-cc-modal-visual-height");
    this.modalEl.style.removeProperty("--ent-cc-modal-visual-shift");
    this.modalEl.removeClass("is-virtual-keyboard-open");
  }

  protected focusAfter(element: HTMLElement, delay: number): void {
    const owner = element.ownerDocument.defaultView;
    if (!owner) return;
    const id = owner.setTimeout(() => {
      if (element.isConnected) element.focus();
    }, delay);
    this.deferredTimers.push({ id, owner });
  }

  private readonly syncViewport = (): void => {
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
    this.modalEl.style.setProperty("--ent-cc-modal-visual-height", `${String(layout.height)}px`);
    this.modalEl.style.setProperty("--ent-cc-modal-visual-shift", `${String(layout.shift)}px`);
    this.modalEl.toggleClass("is-virtual-keyboard-open", layout.keyboardOpen);
    const active = this.contentEl.ownerDocument.activeElement as HTMLElement | null;
    if (active && this.contentEl.contains(active) && typeof active.scrollIntoView === "function") {
      active.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  };

  private readonly handleFocus = (): void => { this.scheduleViewportSync(); };

  private scheduleViewportSync(): void {
    const viewWindow = this.viewportWindow;
    if (!viewWindow) return;
    for (const timer of this.viewportTimers) viewWindow.clearTimeout(timer);
    this.viewportTimers = [0, 60, 180, 420].map((delay) => viewWindow.setTimeout(this.syncViewport, delay));
  }
}

export class QuickAppendModal extends FollowUpResponsiveModal {
  private value: QuickAppendFormValue;
  private dateSettingEl: HTMLElement | null = null;
  private errorEl: HTMLElement | null = null;
  private busy = false;

  constructor(app: App, private readonly options: QuickAppendModalOptions) {
    super(app);
    const first = options.categories.find((category) => !category.archived);
    this.value = { categoryId: first?.id ?? "", date: options.initialDate, text: "" };
  }

  onOpen(): void {
    const categories = this.options.categories.filter((category) => !category.archived);
    this.modalEl.addClass("ent-cc-topic-editor-modal", "ent-cc-knowledge-note-modal", "ent-cc-follow-up-modal");
    this.contentEl.empty();
    this.contentEl.addClass("ent-cc-modal", "ent-cc-topic-editor", "ent-cc-knowledge-note-content");
    this.titleEl.setText("Quick append");
    const body = this.contentEl.createDiv({ cls: "ent-cc-note-form-body" });
    body.createEl("p", {
      cls: "ent-cc-modal-lead",
      text: "Append one item to the managed follow-up notes section. Reusing a category adds beneath its existing entries.",
    });
    const context = body.createDiv({ cls: "ent-cc-catalog-context", attr: { role: "note" } });
    const icon = context.createSpan({ attr: { "aria-hidden": "true" } });
    setIcon(icon, "file-text");
    context.createSpan({ text: this.options.file.path, attr: { dir: "auto" } });

    new Setting(body).setName("Category").addDropdown((dropdown) => {
      for (const category of categories) dropdown.addOption(category.id, category.label);
      dropdown.setValue(this.value.categoryId).onChange((categoryId) => {
        this.value.categoryId = categoryId;
        this.updateDateVisibility();
      });
      dropdown.selectEl.setAttribute("aria-label", "Follow-up category");
    });

    new Setting(body).setName("Follow-up note").setDesc("One item; multiple lines remain inside the same bullet or checkbox.")
      .addTextArea((control) => {
        control.setPlaceholder("Add a source, question, thought, lecture, reading item, or other follow-up…")
          .setValue(this.value.text)
          .onChange((text) => { this.value.text = text; });
        control.inputEl.rows = 6;
        control.inputEl.setAttribute("aria-label", "Follow-up note text");
        control.inputEl.enterKeyHint = "done";
        this.focusAfter(control.inputEl, 60);
      });

    const dateSetting = new Setting(body).setName("Date").setDesc("Stored at the start of this entry as yyyy-mm-dd.")
      .addText((control) => {
        control.setValue(this.value.date).onChange((date) => { this.value.date = date; });
        control.inputEl.type = "date";
        control.inputEl.setAttribute("aria-label", "Follow-up entry date");
      });
    this.dateSettingEl = dateSetting.settingEl;
    this.errorEl = body.createDiv({ cls: "ent-cc-form-error", attr: { role: "alert", "aria-live": "polite" } });
    this.updateDateVisibility();

    new Setting(this.contentEl)
      .addButton((button) => {
        button.setButtonText("Cancel").onClick(() => this.close());
        button.buttonEl.addClass("ent-cc-note-cancel-button");
      })
      .addButton((button) => button.setButtonText("Append to note").setCta().onClick(() => void this.submit()))
      .settingEl.addClass("ent-cc-modal-footer");
    this.bindResponsiveViewport();
  }

  onClose(): void { this.releaseResponsiveViewport(); }

  private updateDateVisibility(): void {
    const selected = this.options.categories.find((category) => category.id === this.value.categoryId);
    this.dateSettingEl?.toggleClass("is-hidden", selected?.includeDate !== true);
  }

  private async submit(): Promise<void> {
    if (this.busy) return;
    if (!this.value.categoryId || !this.value.text.trim()) {
      this.errorEl?.setText(this.value.categoryId ? "Enter a follow-up note." : "Choose a category.");
      return;
    }
    this.busy = true;
    this.errorEl?.setText("");
    try {
      await this.options.onSubmit({ ...this.value });
      this.close();
    } catch (error) {
      this.busy = false;
      const message = errorMessage(error);
      this.errorEl?.setText(message);
      new Notice(message, 8000);
    }
  }
}

interface CategoryEditorOptions {
  existingIds: ReadonlySet<string>;
  initial?: FollowUpCategoryDefinition;
  /** Returns false when the category was rejected, keeping the draft editable. */
  onSubmit: (category: FollowUpCategoryDefinition) => boolean;
}

class FollowUpCategoryEditorModal extends FollowUpResponsiveModal {
  private label: string;
  private style: FollowUpCategoryDefinition["style"];
  private includeDate: boolean;

  constructor(app: App, private readonly options: CategoryEditorOptions) {
    super(app);
    this.label = options.initial?.label ?? "";
    this.style = options.initial?.style ?? "bullet";
    this.includeDate = options.initial?.includeDate ?? false;
  }

  onOpen(): void {
    this.modalEl.addClass("ent-cc-topic-editor-modal", "ent-cc-knowledge-note-modal", "ent-cc-follow-up-editor-modal");
    this.contentEl.empty();
    this.contentEl.addClass("ent-cc-modal", "ent-cc-topic-editor", "ent-cc-knowledge-note-content");
    this.titleEl.setText(this.options.initial ? "Edit quick append category" : "New quick append category");
    const body = this.contentEl.createDiv({ cls: "ent-cc-note-form-body" });
    new Setting(body).setName("Name").addText((control) => {
      control.setPlaceholder("Category name").setValue(this.label).onChange((label) => { this.label = label; });
      control.inputEl.setAttribute("aria-label", "Quick append category name");
      this.focusAfter(control.inputEl, 40);
    });
    new Setting(body).setName("Entry style").addDropdown((dropdown) => dropdown
      .addOptions({ bullet: "Bullet", checkbox: "Checkbox" })
      .setValue(this.style)
      .onChange((style) => { this.style = style === "checkbox" ? "checkbox" : "bullet"; }));
    new Setting(body).setName("Include date").setDesc("Prefix every new entry in this category with yyyy-mm-dd.")
      .addToggle((toggle) => toggle.setValue(this.includeDate).onChange((value) => { this.includeDate = value; }));
    if (this.options.initial) {
      body.createDiv({ cls: "ent-cc-catalog-context", text: `Stable marker ID: ${this.options.initial.id}`, attr: { role: "note" } });
    }
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setButtonText("Save category").setCta().onClick(() => this.submit()))
      .settingEl.addClass("ent-cc-modal-footer");
    this.bindResponsiveViewport();
  }

  onClose(): void { this.releaseResponsiveViewport(); }

  private submit(): void {
    const label = this.label.normalize("NFC").trim();
    if (!label || label.length > 100 || /[\r\n]/u.test(label)) {
      new Notice("Enter a one-line category name of 1–100 characters.");
      return;
    }
    const id = this.options.initial?.id ?? allocateFollowUpCategoryId(label, this.options.existingIds);
    const accepted = this.options.onSubmit({ id, label, style: this.style, includeDate: this.includeDate, archived: this.options.initial?.archived ?? false });
    if (accepted) this.close();
  }
}

export class FollowUpCategoryManagerModal extends Modal {
  private categories: FollowUpCategoryDefinition[];
  private saving = false;

  constructor(
    app: App,
    categories: readonly FollowUpCategoryDefinition[],
    private readonly onSave: (categories: FollowUpCategoryDefinition[]) => void | Promise<void>,
  ) {
    super(app);
    this.categories = categories.map((category) => ({ ...category }));
  }

  onOpen(): void {
    this.modalEl.addClass("ent-cc-manager-modal", "ent-cc-follow-up-category-manager");
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    this.contentEl.addClass("ent-cc-modal");
    this.titleEl.setText("Quick append categories");
    this.contentEl.createEl("p", {
      cls: "ent-cc-modal-lead",
      text: "Categories are base-specific. Renaming keeps the stable marker ID so existing note sections continue to receive new entries.",
    });
    const list = this.contentEl.createDiv({ cls: "ent-cc-follow-up-category-list" });
    this.categories.forEach((category, index) => {
      const row = new Setting(list)
        .setName(category.label)
        .setDesc(`${category.style === "checkbox" ? "Checkbox" : "Bullet"}${category.includeDate ? " · dated" : ""} · ${category.id}${category.archived ? " · archived" : ""}`);
      row.settingEl.toggleClass("is-archived", category.archived);
      row.addButton((button) => button.setIcon("arrow-up").setTooltip("Move up").setDisabled(index === 0).onClick(() => {
        const previous = this.categories[index - 1];
        if (!previous) return;
        this.categories[index - 1] = category;
        this.categories[index] = previous;
        this.render();
      }));
      row.addButton((button) => button.setIcon("arrow-down").setTooltip("Move down").setDisabled(index === this.categories.length - 1).onClick(() => {
        const next = this.categories[index + 1];
        if (!next) return;
        this.categories[index + 1] = category;
        this.categories[index] = next;
        this.render();
      }));
      row.addButton((button) => button.setButtonText("Edit").onClick(() => this.openEditor(category)));
      row.addButton((button) => button.setButtonText(category.archived ? "Restore" : "Archive").onClick(() => {
        if (!category.archived && this.categories.filter((item) => !item.archived).length <= 1) {
          new Notice("Keep at least one active quick append category.");
          return;
        }
        category.archived = !category.archived;
        this.render();
      }));
    });

    const actions = new Setting(this.contentEl);
    actions.addButton((button) => button.setButtonText("Add category").setDisabled(this.categories.length >= MAX_FOLLOW_UP_CATEGORIES).onClick(() => this.openEditor()));
    actions.addButton((button) => button.setButtonText("Reset defaults…").onClick(() => {
      new ConfirmModal(
        this.app,
        "Reset quick append categories?",
        "This replaces the draft category list with the six defaults. Existing managed sections remain in notes and are never deleted.",
        "Reset draft",
        () => {
          this.categories = DEFAULT_FOLLOW_UP_CATEGORIES.map((category) => ({ ...category }));
          this.render();
        },
      ).open();
    }));
    actions.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()));
    actions.addButton((button) => button.setButtonText("Save categories").setCta().onClick(() => void this.submit()));
    actions.settingEl.addClass("ent-cc-modal-footer");
  }

  private openEditor(initial?: FollowUpCategoryDefinition): void {
    new FollowUpCategoryEditorModal(this.app, {
      existingIds: new Set(this.categories.map((category) => category.id)),
      initial,
      onSubmit: (category) => {
        const duplicate = this.categories.some((item) => item.id !== category.id
          && followUpCategoryLabelKey(item.label) === followUpCategoryLabelKey(category.label));
        if (duplicate) {
          new Notice("Use a unique quick append category name.");
          return false;
        }
        const index = this.categories.findIndex((item) => item.id === category.id);
        if (index >= 0) this.categories[index] = category;
        else this.categories.push(category);
        this.render();
        return true;
      },
    }).open();
  }

  private async submit(): Promise<void> {
    if (this.saving) return;
    if (this.categories.length === 0 || this.categories.every((category) => category.archived)) {
      new Notice("Keep at least one active quick append category.");
      return;
    }
    this.saving = true;
    try {
      await this.onSave(this.categories.map((category) => ({ ...category })));
      this.close();
    } catch (error) {
      this.saving = false;
      new Notice(errorMessage(error), 8000);
    }
  }
}

export type { QuickAppendFormValue };
