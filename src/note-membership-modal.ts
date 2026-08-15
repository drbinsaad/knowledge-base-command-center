import { Modal, setIcon } from "obsidian";
import type {
  NoteOrganizerBaseMembership,
  NoteOrganizerMembershipSummary,
} from "./note-organizer-surfaces";

let noteMembershipModalSequence = 0;

export interface NoteMembershipModalHost {
  app: ConstructorParameters<typeof Modal>[0];
  getNoteOrganizerMembershipSummary(path: string): NoteOrganizerMembershipSummary;
  noteOrganizerRestrictionReason(path: string): string | null;
  openNoteOrganizer(paths: readonly string[]): void;
}

function primaryLabel(base: NoteOrganizerBaseMembership): string {
  if (base.primary.kind === "index" || base.primary.kind === "library") return base.primary.label;
  if (base.primary.kind === "conflict") return `Conflicting: ${base.primary.labels.join(" · ")}`;
  return base.collectionOnly ? "Collections only" : "Not organized";
}

function detailLabel(base: NoteOrganizerBaseMembership): string {
  const details: string[] = [];
  if (base.collectionTitles.length > 0) details.push(`Collections: ${base.collectionTitles.join(" · ")}`);
  if (base.provenance.length > 0) {
    const provenance = base.provenance.map((item) => {
      if (item === "linked-folder") return "Linked folder";
      if (item === "direct") return "Direct";
      if (item === "protected") return "Protected source";
      return "Portable identity";
    });
    details.push(provenance.join(" · "));
  }
  if (base.hidden) details.push("Hidden from Index");
  return details.join(" · ") || "No KBCC organization in this knowledge base";
}

/** Read-only all-base membership detail opened from the active-note indicator. */
export class NoteMembershipModal extends Modal {
  private readonly instanceId = `ent-cc-note-membership-${++noteMembershipModalSequence}`;

  constructor(
    private readonly host: NoteMembershipModalHost,
    private readonly path: string,
  ) {
    super(host.app);
  }

  onOpen(): void {
    const summary = this.host.getNoteOrganizerMembershipSummary(this.path);
    this.modalEl.addClass("ent-cc-note-membership-modal");
    this.contentEl.empty();
    this.contentEl.addClass("ent-cc-modal", "ent-cc-note-membership-detail");
    this.titleEl.setText("This note’s knowledge-base organization");
    this.titleEl.setAttribute("id", `${this.instanceId}-title`);
    this.modalEl.setAttribute("role", "dialog");
    this.modalEl.setAttribute("aria-modal", "true");
    this.modalEl.setAttribute("aria-labelledby", `${this.instanceId}-title`);
    this.modalEl.setAttribute("aria-describedby", `${this.instanceId}-summary ${this.instanceId}-guarantee`);

    const status = this.contentEl.createDiv({
      cls: "ent-cc-note-membership-summary",
      attr: { id: `${this.instanceId}-summary` },
    });
    const statusIcon = status.createSpan({
      cls: "ent-cc-note-membership-summary-icon",
      attr: { "aria-hidden": "true" },
    });
    setIcon(statusIcon, summary.indicator.icon);
    const statusText = status.createDiv({ cls: "ent-cc-note-membership-summary-text" });
    statusText.createEl("strong", { text: summary.indicator.label, attr: { dir: "auto" } });
    statusText.createEl("p", { text: summary.indicator.tooltip, attr: { dir: "auto" } });
    this.contentEl.createEl("p", {
      cls: "ent-cc-note-membership-path",
      text: this.path,
      attr: { dir: "auto" },
    });

    const list = this.contentEl.createDiv({
      cls: "ent-cc-note-membership-base-list",
      attr: { role: "list", "aria-label": "Knowledge-base memberships", tabindex: "0" },
    });
    for (const base of summary.bases) {
      const row = list.createDiv({
        cls: `ent-cc-note-membership-base${base.current ? " is-current" : ""}${base.broken ? " has-issue" : ""}`,
        attr: { role: "listitem" },
      });
      const heading = row.createDiv({ cls: "ent-cc-note-membership-base-heading" });
      heading.createEl("strong", { text: base.baseName, attr: { dir: "auto" } });
      if (base.current) heading.createSpan({ cls: "ent-cc-note-membership-current", text: "Current" });
      row.createDiv({ cls: "ent-cc-note-membership-primary", text: primaryLabel(base), attr: { dir: "auto" } });
      row.createDiv({ cls: "ent-cc-note-membership-detail-text", text: detailLabel(base), attr: { dir: "auto" } });
      for (const issue of base.issues) {
        row.createDiv({ cls: "ent-cc-note-membership-issue", text: issue.detail, attr: { dir: "auto" } });
      }
    }

    this.contentEl.createEl("p", {
      cls: "ent-cc-note-membership-guarantee",
      text: "Organizing changes plugin data only. The Markdown file and its folder stay unchanged.",
      attr: { id: `${this.instanceId}-guarantee`, role: "note" },
    });

    const actions = this.contentEl.createDiv({ cls: "ent-cc-note-membership-actions" });
    const close = actions.createEl("button", { cls: "ent-cc-button", text: "Close", type: "button" });
    close.addEventListener("click", () => this.close());
    const organize = actions.createEl("button", { cls: "ent-cc-button mod-cta", type: "button" });
    setIcon(organize.createSpan(), "network");
    organize.createSpan({ text: "Organize…" });
    const restrictionReason = this.host.noteOrganizerRestrictionReason(this.path);
    if (restrictionReason) {
      const reasonId = `ent-cc-note-membership-restriction-${Math.random().toString(36).slice(2)}`;
      organize.disabled = true;
      organize.setAttribute("aria-describedby", reasonId);
      organize.setAttribute("title", restrictionReason);
      actions.createEl("p", {
        cls: "ent-cc-note-membership-action-reason",
        text: restrictionReason,
        attr: { id: reasonId, role: "note" },
      });
    } else {
      organize.addEventListener("click", () => {
        this.close();
        this.host.openNoteOrganizer([this.path]);
      });
    }
  }
}
