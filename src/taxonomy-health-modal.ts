import { Modal, Notice, TFile, setIcon } from "obsidian";
import type EntVaultCommandCenterPlugin from "./main";
import type { TaxonomyHealthFinding } from "./taxonomy-health";

const PAGE_SIZE = 200;

export class TaxonomyRepairPreviewModal extends Modal {
  private openedBaseId = "";
  private openedDataEpoch = 0;

  constructor(
    private readonly plugin: EntVaultCommandCenterPlugin,
    private readonly finding: TaxonomyHealthFinding,
    private readonly onApplied: () => void,
  ) {
    super(plugin.app);
  }

  onOpen(): void {
    const repair = this.finding.repair;
    if (!repair) {
      this.close();
      return;
    }
    this.openedBaseId = this.plugin.getActiveKnowledgeBaseId();
    this.openedDataEpoch = this.plugin.getDataEpoch();
    this.modalEl.addClass("ent-cc-taxonomy-preview-modal");
    this.contentEl.addClass("ent-cc-modal", "ent-cc-taxonomy-preview");
    this.titleEl.setText("Review taxonomy repair");
    const body = this.contentEl.createDiv({
      cls: "ent-cc-taxonomy-preview-body",
      attr: { role: "region", "aria-label": "Taxonomy repair details", tabindex: "0" },
    });
    body.createEl("h3", { text: repair.label, attr: { dir: "auto" } });
    body.createEl("p", { text: repair.preview, attr: { dir: "auto" } });
    const guarantees = body.createEl("ul", { cls: "ent-cc-taxonomy-guarantees" });
    guarantees.createEl("li", { text: "The repair changes plugin-owned organization only." });
    guarantees.createEl("li", { text: "Markdown notes, note bodies, properties, folders, and attachments are not changed." });
    guarantees.createEl("li", { text: "The complete repair is saved as one transaction and can be reversed with undo." });
    const actions = this.contentEl.createDiv({ cls: "ent-cc-taxonomy-preview-actions" });
    const cancel = actions.createEl("button", { cls: "ent-cc-button", type: "button", text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const apply = actions.createEl("button", { cls: "ent-cc-button mod-cta", type: "button", text: "Apply repair" });
    apply.addEventListener("click", () => {
      if (this.plugin.getActiveKnowledgeBaseId() !== this.openedBaseId
        || this.plugin.getDataEpoch() !== this.openedDataEpoch) {
        this.close();
        new Notice("The knowledge base changed after this preview. Recheck taxonomy health before applying a repair.", 8000);
        return;
      }
      apply.disabled = true;
      cancel.disabled = true;
      void this.plugin.applyTaxonomyHealthRepair(this.finding.id, repair).then(() => {
        this.close();
        this.onApplied();
        new Notice("Taxonomy repair applied. Undo is available.");
      }).catch((error: unknown) => {
        apply.disabled = false;
        cancel.disabled = false;
        new Notice(error instanceof Error ? error.message : "The taxonomy repair failed.", 8000);
      });
    });
  }
}

export class TaxonomyHealthModal extends Modal {
  private query = "";
  private visibleLimit = PAGE_SIZE;
  private openedBaseId = "";
  private openedDataEpoch = 0;
  private findings: TaxonomyHealthFinding[] = [];

  constructor(private readonly plugin: EntVaultCommandCenterPlugin) {
    super(plugin.app);
  }

  onOpen(): void {
    this.openedBaseId = this.plugin.getActiveKnowledgeBaseId();
    this.openedDataEpoch = this.plugin.getDataEpoch();
    this.modalEl.addClass("ent-cc-taxonomy-health-modal");
    this.contentEl.addClass("ent-cc-modal", "ent-cc-taxonomy-health");
    this.titleEl.setText("Taxonomy health center");
    this.refreshFindings();
  }

  private ownsOpenedBase(): boolean {
    return this.plugin.getActiveKnowledgeBaseId() === this.openedBaseId
      && this.plugin.getDataEpoch() === this.openedDataEpoch;
  }

  private guardOpenedBase(): boolean {
    if (this.ownsOpenedBase()) return true;
    this.close();
    new Notice("The active knowledge base changed. Reopen taxonomy health before reviewing or applying repairs.", 8000);
    return false;
  }

  private refreshFindings(): void {
    if (!this.guardOpenedBase()) return;
    this.findings = this.plugin.getTaxonomyHealthFindings();
    this.render();
  }

  private render(): void {
    if (!this.guardOpenedBase()) return;
    this.contentEl.empty();
    const warnings = this.findings.filter((finding) => finding.severity === "warning").length;
    const repairable = this.findings.filter((finding) => Boolean(finding.repair)).length;
    const intro = this.contentEl.createDiv({ cls: "ent-cc-taxonomy-intro" });
    intro.createEl("p", { text: "Inspect names, hierarchy, configured paths, portable identities, and empty structures. Nothing is changed automatically." });
    const summary = intro.createDiv({ cls: "ent-cc-taxonomy-summary", attr: { role: "status", "aria-live": "polite" } });
    summary.createSpan({ text: `${this.findings.length} findings` });
    summary.createSpan({ text: `${warnings} warnings` });
    summary.createSpan({ text: `${repairable} previewable repairs` });
    intro.createDiv({
      cls: "ent-cc-taxonomy-load-note",
      text: "Historical load-repair and dropped-entry counts are not persisted by this data format, so no unverifiable count is shown. Current data is analyzed in full below.",
    });

    const toolbar = this.contentEl.createDiv({ cls: "ent-cc-taxonomy-toolbar" });
    const search = toolbar.createEl("input", {
      type: "search",
      placeholder: "Filter findings…",
      attr: { "aria-label": "Filter taxonomy health findings" },
    });
    search.value = this.query;
    search.addEventListener("input", () => {
      this.query = search.value;
      this.visibleLimit = PAGE_SIZE;
      this.render();
      const next = this.contentEl.querySelector<HTMLInputElement>('.ent-cc-taxonomy-toolbar input[type="search"]');
      next?.focus();
      next?.setSelectionRange(this.query.length, this.query.length);
    });
    const refresh = toolbar.createEl("button", { cls: "ent-cc-button", type: "button" });
    setIcon(refresh.createSpan(), "refresh-cw");
    refresh.createSpan({ text: "Recheck" });
    refresh.addEventListener("click", () => this.refreshFindings());

    const normalizedQuery = this.query.normalize("NFKC").trim().toLowerCase();
    const filtered = normalizedQuery
      ? this.findings.filter((finding) => `${finding.title} ${finding.detail} ${finding.scope} ${finding.kind}`.normalize("NFKC").toLowerCase().includes(normalizedQuery))
      : this.findings;
    const list = this.contentEl.createDiv({ cls: "ent-cc-taxonomy-list", attr: { role: "list", "aria-label": "Taxonomy health findings" } });
    for (const finding of filtered.slice(0, this.visibleLimit)) this.renderFinding(list, finding);
    if (filtered.length === 0) {
      list.createDiv({ cls: "ent-cc-empty", text: this.findings.length === 0 ? "No taxonomy health findings detected." : "No findings match this filter." });
    }
    if (filtered.length > this.visibleLimit) {
      const more = this.contentEl.createEl("button", { cls: "ent-cc-button ent-cc-taxonomy-more", type: "button", text: `Show ${Math.min(PAGE_SIZE, filtered.length - this.visibleLimit)} more` });
      more.addEventListener("click", () => {
        this.visibleLimit += PAGE_SIZE;
        this.render();
      });
    }
    const footer = this.contentEl.createDiv({ cls: "ent-cc-taxonomy-footer" });
    const close = footer.createEl("button", { cls: "ent-cc-button", type: "button", text: "Close" });
    close.addEventListener("click", () => this.close());
  }

  private renderFinding(parent: HTMLElement, finding: TaxonomyHealthFinding): void {
    const row = parent.createEl("article", {
      cls: `ent-cc-taxonomy-finding is-${finding.severity}`,
      attr: { role: "listitem", "data-taxonomy-kind": finding.kind },
    });
    const icon = row.createSpan({ cls: "ent-cc-taxonomy-finding-icon", attr: { "aria-hidden": "true" } });
    setIcon(icon, finding.severity === "warning" ? "triangle-alert" : "info");
    const content = row.createDiv({ cls: "ent-cc-taxonomy-finding-content" });
    content.createEl("h3", { text: finding.title, attr: { dir: "auto" } });
    content.createDiv({ cls: "ent-cc-taxonomy-scope", text: finding.scope, attr: { dir: "auto" } });
    content.createEl("p", { text: finding.detail, attr: { dir: "auto" } });
    const actions = row.createDiv({ cls: "ent-cc-taxonomy-finding-actions" });
    if (finding.path) {
      const file = this.app.vault.getAbstractFileByPath(finding.path);
      if (file instanceof TFile) {
        const open = actions.createEl("button", { cls: "ent-cc-button", type: "button" });
        setIcon(open.createSpan(), "external-link");
        open.createSpan({ text: "Open note" });
        open.addEventListener("click", () => void this.plugin.openFile(file));
      }
    }
    if (finding.repair) {
      const review = actions.createEl("button", { cls: "ent-cc-button mod-cta", type: "button" });
      setIcon(review.createSpan(), "wrench");
      review.createSpan({ text: "Review repair…" });
      review.disabled = this.plugin.isDataReadOnly();
      review.addEventListener("click", () => {
        if (!this.guardOpenedBase()) return;
        new TaxonomyRepairPreviewModal(this.plugin, finding, () => {
          this.openedDataEpoch = this.plugin.getDataEpoch();
          this.refreshFindings();
        }).open();
      });
    } else {
      actions.createSpan({ cls: "ent-cc-taxonomy-report-only", text: "Report only — manual judgment required" });
    }
  }
}
