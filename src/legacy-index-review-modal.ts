import { Modal, Notice, setIcon, type App } from "obsidian";
import type { LegacyIndexReviewCandidate, LegacyIndexReviewPlan } from "./legacy-index-review";
import { errorMessage, normalizeSearchText } from "./model";
import { createOpenedBaseGuard, type OpenedBaseGuard } from "./modals";

export interface LegacyIndexReviewHost {
  app: App;
  data: unknown;
  getActiveKnowledgeBaseId(): string;
  getDataEpoch?(): number;
  getExternalChangeGeneration?(): number;
  isDataReadOnly(): boolean;
  getLegacyIndexReviewPlans(): LegacyIndexReviewPlan[];
  applyLegacyIndexReview(
    plan: LegacyIndexReviewPlan,
    preservePaths: readonly string[],
    syncContentsConfirmed: boolean,
  ): Promise<void>;
  keepLegacyIndexSource(plan: LegacyIndexReviewPlan): Promise<void>;
}

let nextReviewId = 1;

/**
 * Converts the implicit v14 folder scope into an explicit v15 choice. The
 * review is intentionally about plugin membership only: it never offers a
 * file move, frontmatter edit, or Markdown deletion.
 */
export class LegacyIndexReviewModal extends Modal {
  static readonly PAGE_SIZE = 300;
  private readonly modalId = `ent-cc-legacy-review-${nextReviewId++}`;
  private readonly selectedPaths = new Set<string>();
  private readonly checkboxes = new Map<string, HTMLInputElement>();
  private readonly guard: OpenedBaseGuard;
  private summaryEl: HTMLElement | null = null;
  private applyButtonEl: HTMLButtonElement | null = null;
  private keepButtonEl: HTMLButtonElement | null = null;
  private notNowButtonEl: HTMLButtonElement | null = null;
  private selectAllButtonEl: HTMLButtonElement | null = null;
  private selectNoneButtonEl: HTMLButtonElement | null = null;
  private candidatePageEl: HTMLElement | null = null;
  private pageStatusEl: HTMLElement | null = null;
  private previousPageButtonEl: HTMLButtonElement | null = null;
  private nextPageButtonEl: HTMLButtonElement | null = null;
  private workingEl: HTMLElement | null = null;
  private syncConfirmationEl: HTMLInputElement | null = null;
  private filterEl: HTMLInputElement | null = null;
  private filteredCandidates: readonly LegacyIndexReviewCandidate[];
  private currentPage = 0;
  private syncContentsConfirmed = false;
  private busy = false;
  private forceClosing = false;
  private closedNotified = false;

  constructor(
    private readonly host: LegacyIndexReviewHost,
    private readonly plan: LegacyIndexReviewPlan,
    private readonly onResolved: () => void = () => undefined,
    private readonly onClosed: () => void = () => undefined,
  ) {
    super(host.app);
    this.filteredCandidates = plan.candidates;
    if (plan.candidates.length <= plan.preserveCapacity) {
      for (const candidate of plan.candidates) this.selectedPaths.add(candidate.path);
    }
    this.guard = createOpenedBaseGuard(host, {
      message: "Knowledge-base data changed. Reopen the legacy Index review to see the current notes.",
      onStale: () => this.dismissImmediately(),
    });
  }

  override close(): void {
    if (this.busy && !this.forceClosing) {
      new Notice("Wait for the current legacy index action to finish before closing this review.");
      return;
    }
    super.close();
  }

  /** Plugin unload and a stale opened-base guard must remove the surface immediately. */
  dismissImmediately(): void {
    this.forceClosing = true;
    this.close();
  }

  onOpen(): void {
    if (!this.guard() || !this.hasCurrentPlan()) {
      if (this.guard.owns()) {
        new Notice("The legacy index source changed. Reopen its review from settings.", 8000);
        this.close();
      }
      return;
    }

    this.modalEl.addClass("ent-cc-legacy-review-modal");
    this.contentEl.addClass("ent-cc-modal", "ent-cc-legacy-review");
    this.titleEl.setText("Review legacy index source");
    this.modalEl.setAttribute("aria-describedby", `${this.modalId}-intro ${this.modalId}-effect`);
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
    this.checkboxes.clear();
    this.filterEl = null;
    this.syncConfirmationEl = null;
    if (!this.closedNotified) {
      this.closedNotified = true;
      try {
        this.onClosed();
      } catch (error) {
        console.error("Knowledge Base Command Center could not finish closing the legacy index review", error);
      }
    }
  }

  private render(): void {
    this.contentEl.empty();
    this.checkboxes.clear();

    this.contentEl.createEl("p", {
      cls: "ent-cc-legacy-review-intro",
      text: "An earlier plugin version treated a storage folder as automatic index membership. The upgrade preserved that behavior as a legacy linked source so existing entries would not disappear without your review.",
      attr: { id: `${this.modalId}-intro` },
    });

    const source = this.contentEl.createDiv({ cls: "ent-cc-legacy-review-source" });
    const sourceIcon = source.createSpan({ attr: { "aria-hidden": "true" } });
    setIcon(sourceIcon, "folder-sync");
    const sourceText = source.createDiv();
    sourceText.createDiv({ cls: "ent-cc-legacy-review-source-label", text: "Folder currently linked to the Index" });
    sourceText.createDiv({ cls: "ent-cc-legacy-review-source-path", text: this.plan.source.path, attr: { dir: "auto" } });

    const boundary = this.contentEl.createDiv({
      cls: "ent-cc-legacy-review-boundary",
      attr: { id: `${this.modalId}-effect`, role: "note" },
    });
    boundary.createDiv({
      text: "Applying this review makes the selected notes durable direct Index members, unlinks this folder, and stops future notes in it from appearing automatically.",
    });
    boundary.createEl("strong", { text: "No Markdown note, folder, property, attachment, or link will be changed." });

    if (!this.plan.sourceFolderAvailable) {
      this.contentEl.createDiv({
        cls: "ent-cc-legacy-review-sync-warning",
        text: "This linked folder is not available on this device, so its notes cannot be counted safely. Let Obsidian Sync finish or restore the folder before unlinking it. You may keep the link intentionally or choose Not now.",
        attr: { role: "alert" },
      });
    }

    const toolbar = this.contentEl.createDiv({ cls: "ent-cc-legacy-review-toolbar" });
    toolbar.createDiv({
      cls: "ent-cc-legacy-review-count",
      text: this.plan.sourceFolderAvailable
        ? `${this.plan.candidates.length.toLocaleString()} source-only Markdown ${this.plan.candidates.length === 1 ? "note needs" : "notes need"} a choice`
        : "Source-only notes unavailable until this folder finishes syncing",
    });
    const bulk = toolbar.createDiv({ cls: "ent-cc-legacy-review-bulk", attr: { "aria-label": "Bulk note selection" } });
    this.selectAllButtonEl = this.textButton(bulk, "Select all notes", () => this.selectAll(true));
    this.selectNoneButtonEl = this.textButton(bulk, "Clear all notes", () => this.selectAll(false));

    if (this.plan.candidates.length > 0) {
      const filter = this.contentEl.createEl("input", {
        type: "search",
        cls: "ent-cc-legacy-review-filter",
        attr: {
          placeholder: "Filter by note title or path",
          "aria-label": "Filter legacy index notes",
          enterkeyhint: "search",
        },
      });
      this.filterEl = filter;
      filter.addEventListener("input", () => this.filterCandidates(filter.value));
    }

    if (this.plan.candidates.length > this.plan.preserveCapacity) {
      this.contentEl.createDiv({
        cls: "ent-cc-legacy-review-capacity",
        text: `This knowledge base can preserve at most ${this.plan.preserveCapacity.toLocaleString()} more direct members. Nothing is preselected. Filter and select a smaller set, or choose Keep linked to preserve dynamic membership.`,
        attr: { role: "alert" },
      });
    }

    if (this.plan.candidates.length > 0) {
      const list = this.contentEl.createEl("fieldset", {
        cls: "ent-cc-legacy-review-list",
        attr: { "aria-describedby": `${this.modalId}-summary` },
      });
      list.createEl("legend", { text: "Notes to preserve as direct index members" });
      this.candidatePageEl = list.createDiv({ cls: "ent-cc-legacy-review-page" });
      const pagination = list.createDiv({ cls: "ent-cc-legacy-review-pagination", attr: { "aria-label": "Review pages" } });
      this.previousPageButtonEl = this.iconButton(pagination, "chevron-left", "Previous", () => this.changePage(-1));
      this.pageStatusEl = pagination.createDiv({ cls: "ent-cc-legacy-review-page-status", attr: { "aria-live": "polite" } });
      this.nextPageButtonEl = this.iconButton(pagination, "chevron-right", "Next", () => this.changePage(1));
      this.renderCandidatePage();
    } else {
      this.contentEl.createDiv({
        cls: "ent-cc-legacy-review-empty",
        text: this.plan.sourceFolderAvailable
          ? "No source-only Markdown notes are currently available. This does not prove that every synced copy of the folder is empty; confirm Sync completeness below before unlinking."
          : "The source-only note list is unavailable while this linked folder is missing on this device.",
      });
    }

    this.summaryEl = this.contentEl.createDiv({
      cls: "ent-cc-legacy-review-summary",
      attr: { id: `${this.modalId}-summary`, role: "status", "aria-live": "polite", "aria-atomic": "true" },
    });
    this.updateSummary();

    if (this.plan.sourceFolderAvailable) {
      const confirmation = this.contentEl.createEl("label", { cls: "ent-cc-legacy-review-sync-confirmation" });
      this.syncConfirmationEl = confirmation.createEl("input", {
        type: "checkbox",
        attr: { "aria-label": "Confirm linked folder sync completeness" },
      });
      confirmation.createSpan({
        text: "I confirm Obsidian Sync has finished and this folder’s Markdown contents are complete on this device.",
      });
      this.syncConfirmationEl.checked = this.syncContentsConfirmed;
      this.syncConfirmationEl.addEventListener("change", () => {
        this.syncContentsConfirmed = this.syncConfirmationEl?.checked === true;
        this.updateDisabledState();
      });
    }

    const keepExplanation = this.contentEl.createDiv({ cls: "ent-cc-legacy-review-keep-note" });
    keepExplanation.createEl("strong", { text: "Keep linked" });
    keepExplanation.createSpan({
      text: " means this folder remains an intentional dynamic source: its current and future Markdown notes continue to join the Index automatically.",
    });
    keepExplanation.createDiv({
      text: "Not now changes nothing: the inherited folder link and warning remain active until you review it later.",
    });

    const actions = this.contentEl.createDiv({ cls: "ent-cc-legacy-review-actions" });
    this.notNowButtonEl = this.textButton(actions, "Not now", () => this.close());
    this.keepButtonEl = this.iconButton(actions, "link", "Keep linked", () => { void this.keepLinked(); });
    this.applyButtonEl = this.iconButton(actions, "list-checks", "Apply review & unlink", () => { void this.applyReview(); }, "mod-cta");
    this.workingEl = actions.createDiv({
      cls: "ent-cc-legacy-review-working",
      attr: { role: "status", "aria-live": "polite" },
    });
    this.workingEl.hidden = true;
    this.updateDisabledState();
    // Obsidian owns initial focus and restoration so screen readers encounter
    // the title and explanation before the large checkbox list.
  }

  private hasCurrentPlan(): boolean {
    try {
      return this.host.getLegacyIndexReviewPlans().some((candidate) => (
        candidate.source.id === this.plan.source.id && candidate.fingerprint === this.plan.fingerprint
      ));
    } catch {
      return false;
    }
  }

  private selectAll(selected: boolean): void {
    if (this.busy) return;
    if (selected && this.plan.candidates.length > this.plan.preserveCapacity) return;
    this.selectedPaths.clear();
    for (const candidate of this.plan.candidates) {
      const checkbox = this.checkboxes.get(candidate.path);
      if (checkbox) checkbox.checked = selected;
      if (selected) this.selectedPaths.add(candidate.path);
    }
    this.updateSummary();
  }

  private filterCandidates(value: string): void {
    if (this.busy) return;
    const query = normalizeSearchText(value.trim());
    this.filteredCandidates = query
      ? this.plan.candidates.filter((candidate) => normalizeSearchText(`${candidate.title} ${candidate.path}`).includes(query))
      : this.plan.candidates;
    this.currentPage = 0;
    this.renderCandidatePage();
  }

  private renderCandidatePage(): void {
    if (!this.candidatePageEl) return;
    this.candidatePageEl.empty();
    this.checkboxes.clear();
    const pageCount = Math.max(1, Math.ceil(this.filteredCandidates.length / LegacyIndexReviewModal.PAGE_SIZE));
    this.currentPage = Math.max(0, Math.min(this.currentPage, pageCount - 1));
    const start = this.currentPage * LegacyIndexReviewModal.PAGE_SIZE;
    const end = Math.min(start + LegacyIndexReviewModal.PAGE_SIZE, this.filteredCandidates.length);
    for (let index = start; index < end; index += 1) {
      const candidate = this.filteredCandidates[index];
      if (!candidate) continue;
      const inputId = `${this.modalId}-candidate-${index}`;
      const titleId = `${inputId}-title`;
      const pathId = `${inputId}-path`;
      const row = this.candidatePageEl.createEl("label", { cls: "ent-cc-legacy-review-candidate", attr: { for: inputId } });
      const checkbox = row.createEl("input", {
        type: "checkbox",
        attr: { id: inputId, "aria-labelledby": titleId, "aria-describedby": pathId },
      });
      checkbox.checked = this.selectedPaths.has(candidate.path);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) this.selectedPaths.add(candidate.path);
        else this.selectedPaths.delete(candidate.path);
        this.updateSummary();
      });
      this.checkboxes.set(candidate.path, checkbox);
      const text = row.createDiv({ cls: "ent-cc-legacy-review-candidate-text" });
      text.createDiv({ cls: "ent-cc-legacy-review-candidate-title", text: candidate.title, attr: { id: titleId, dir: "auto" } });
      text.createDiv({ cls: "ent-cc-legacy-review-candidate-path", text: candidate.path, attr: { id: pathId, dir: "auto" } });
    }
    if (this.filteredCandidates.length === 0) {
      this.candidatePageEl.createDiv({
        cls: "ent-cc-legacy-review-empty",
        text: "No notes match this filter.",
      });
    }
    this.pageStatusEl?.setText(
      this.filteredCandidates.length === 0
        ? "No notes"
        : `Showing ${(start + 1).toLocaleString()}–${end.toLocaleString()} of ${this.filteredCandidates.length.toLocaleString()}${this.filteredCandidates.length === this.plan.candidates.length ? "" : " matching"}`,
    );
    if (this.previousPageButtonEl) this.previousPageButtonEl.hidden = pageCount <= 1;
    if (this.nextPageButtonEl) this.nextPageButtonEl.hidden = pageCount <= 1;
    if (this.pageStatusEl) this.pageStatusEl.hidden = pageCount <= 1 && this.filteredCandidates.length === this.plan.candidates.length;
    this.updateDisabledState();
  }

  private changePage(delta: number): void {
    if (this.busy) return;
    const pageCount = Math.max(1, Math.ceil(this.filteredCandidates.length / LegacyIndexReviewModal.PAGE_SIZE));
    const nextPage = Math.max(0, Math.min(this.currentPage + delta, pageCount - 1));
    if (nextPage === this.currentPage) return;
    this.currentPage = nextPage;
    this.renderCandidatePage();
    if (this.candidatePageEl?.parentElement) this.candidatePageEl.parentElement.scrollTop = 0;
  }

  private updateSummary(): void {
    const preserved = this.selectedPaths.size;
    const leaving = this.plan.candidates.length - preserved;
    const capacity = this.plan.candidates.length > this.plan.preserveCapacity
      ? ` At most ${this.plan.preserveCapacity.toLocaleString()} can be preserved directly.`
      : "";
    this.summaryEl?.setText(
      `${preserved.toLocaleString()} ${preserved === 1 ? "note becomes" : "notes become"} a durable direct member. ${leaving.toLocaleString()} ${leaving === 1 ? "note leaves" : "notes leave"} the Index.${capacity} Markdown files remain untouched.`,
    );
    this.updateDisabledState();
  }

  private updateDisabledState(): void {
    const disabled = this.busy || this.host.isDataReadOnly();
    if (this.filterEl) this.filterEl.disabled = disabled;
    if (this.syncConfirmationEl) this.syncConfirmationEl.disabled = disabled;
    for (const checkbox of this.checkboxes.values()) checkbox.disabled = disabled;
    if (this.selectAllButtonEl) this.selectAllButtonEl.disabled = disabled
      || this.plan.candidates.length === 0
      || this.plan.candidates.length > this.plan.preserveCapacity;
    if (this.selectNoneButtonEl) this.selectNoneButtonEl.disabled = disabled || this.plan.candidates.length === 0;
    if (this.applyButtonEl) this.applyButtonEl.disabled = disabled
      || !this.plan.sourceFolderAvailable
      || !this.syncContentsConfirmed
      || this.selectedPaths.size > this.plan.preserveCapacity;
    if (this.keepButtonEl) this.keepButtonEl.disabled = disabled;
    if (this.notNowButtonEl) this.notNowButtonEl.disabled = this.busy;
    const pageCount = Math.max(1, Math.ceil(this.filteredCandidates.length / LegacyIndexReviewModal.PAGE_SIZE));
    if (this.previousPageButtonEl) this.previousPageButtonEl.disabled = disabled || this.currentPage === 0;
    if (this.nextPageButtonEl) this.nextPageButtonEl.disabled = disabled || this.currentPage >= pageCount - 1;
  }

  private canWriteCurrentPlan(): boolean {
    if (!this.guard()) return false;
    if (this.host.isDataReadOnly()) {
      new Notice("Knowledge-base organization is read-only. Resolve the protection state before reviewing this source.", 8000);
      return false;
    }
    if (!this.hasCurrentPlan()) {
      new Notice("The legacy index source changed. Reopen its review from settings.", 8000);
      this.close();
      return false;
    }
    return true;
  }

  private async applyReview(): Promise<void> {
    if (this.busy) return;
    if (!this.plan.sourceFolderAvailable) {
      new Notice("Wait for Obsidian Sync to finish or restore the linked folder before unlinking it.", 8000);
      return;
    }
    if (!this.syncContentsConfirmed) {
      new Notice("Confirm that Obsidian Sync has finished and this folder is complete before unlinking it.", 8000);
      return;
    }
    if (!this.canWriteCurrentPlan()) return;
    this.setBusy(true, "Applying the review and saving one Undo checkpoint…");
    try {
      const preservePaths = this.plan.candidates
        .map((candidate) => candidate.path)
        .filter((path) => this.selectedPaths.has(path));
      await this.host.applyLegacyIndexReview(this.plan, preservePaths, true);
      this.setBusy(false);
      this.close();
      try {
        this.onResolved();
      } catch (error) {
        console.error("Knowledge Base Command Center could not refresh after the legacy index review", error);
      }
      const leaving = this.plan.candidates.length - preservePaths.length;
      new Notice(
        `Legacy folder unlinked. ${preservePaths.length.toLocaleString()} direct ${preservePaths.length === 1 ? "member" : "members"} preserved; ${leaving.toLocaleString()} ${leaving === 1 ? "entry" : "entries"} left the Index. Markdown files were not changed.`,
        8000,
      );
    } catch (error) {
      if (!this.guard()) return;
      this.setBusy(false);
      new Notice(errorMessage(error, "The legacy Index review could not be applied."), 8000);
    }
  }

  private async keepLinked(): Promise<void> {
    if (this.busy || !this.canWriteCurrentPlan()) return;
    this.setBusy(true, "Keeping the folder linked and saving one Undo checkpoint…");
    try {
      await this.host.keepLegacyIndexSource(this.plan);
      this.setBusy(false);
      this.close();
      try {
        this.onResolved();
      } catch (error) {
        console.error("Knowledge Base Command Center could not refresh after accepting the legacy index source", error);
      }
      new Notice("Folder kept as an intentional linked index source. Current and future Markdown notes below it will continue to appear automatically.", 8000);
    } catch (error) {
      if (!this.guard()) return;
      this.setBusy(false);
      new Notice(errorMessage(error, "The legacy Index source could not be kept."), 8000);
    }
  }

  private setBusy(value: boolean, message = ""): void {
    this.busy = value;
    this.contentEl.toggleClass("is-busy", value);
    this.contentEl.setAttribute("aria-busy", value ? "true" : "false");
    if (this.workingEl) {
      this.workingEl.hidden = !value;
      this.workingEl.setText(value ? message : "");
    }
    this.updateDisabledState();
  }

  private textButton(parent: HTMLElement, text: string, action: () => void): HTMLButtonElement {
    const button = parent.createEl("button", { cls: "ent-cc-button", type: "button", text });
    button.addEventListener("click", action);
    return button;
  }

  private iconButton(
    parent: HTMLElement,
    icon: string,
    text: string,
    action: () => void,
    extraClass = "",
  ): HTMLButtonElement {
    const button = parent.createEl("button", { cls: `ent-cc-button ${extraClass}`.trim(), type: "button" });
    const iconEl = button.createSpan({ attr: { "aria-hidden": "true" } });
    setIcon(iconEl, icon);
    button.createSpan({ text });
    button.addEventListener("click", action);
    return button;
  }
}
