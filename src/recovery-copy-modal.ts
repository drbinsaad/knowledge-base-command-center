/**
 * Review of kept recovery copies (A07). A callback-based modal: it reads and
 * previews through injected callbacks and never mutates plugin data itself.
 * Applying and opening the restored base are host callbacks fired only by an
 * explicit click; cancelling at any step fires neither.
 *
 * Pages: list -> preview -> name -> confirm -> done. Status text never
 * contains a vault or device path; only file names are shown.
 */
import { Modal, type App } from "obsidian";
import { normalizedNameKey } from "./model";
import {
  RECOVERY_RESTORE_OMITTED_ITEMS,
  createRecoveryRestoreIntent,
  suggestRestoredBaseName,
  type RecoveryCopyBasePreview,
  type RecoveryCopyParsed,
  type RecoveryCopyRejected,
  type RecoveryRestoreIntent,
  type RestoreIdentity,
} from "./recovery-copy";
import type { RecoveryCandidate, RecoveryCopyLoadResult, RecoveryDiscoveryResult } from "./recovery-discovery";

export type RecoveryApplyResult =
  | { status: "applied"; baseId: string }
  /** Nothing was written. The message must not contain a path. */
  | { status: "failed"; message: string }
  /** The write may or may not have happened. The message must not contain a path. */
  | { status: "uncertain"; message: string };

export interface RecoveryCopyModalCallbacks {
  /** Protected read-only mode: review is allowed, Apply is disabled. */
  isReadOnly(): boolean;
  /** The opened vault's identity; never inferred from names. */
  getCurrentVaultId(): string | null;
  /** Names of non-archived bases, for uniqueness. */
  getExistingNames(): readonly string[];
  /** Base ids and deletion tombstone ids that must not be reused. */
  getExistingBaseIds(): readonly string[];
  /** Fresh base id and causal head; injected so it is deterministic in tests. */
  generateIdentity(): RestoreIdentity;
  discover(): Promise<RecoveryDiscoveryResult>;
  load(candidate: RecoveryCandidate): Promise<RecoveryCopyLoadResult>;
  /** Optional: let the user pick a retained file outside the inspected folders. */
  pickExplicit?(): Promise<RecoveryCandidate | null>;
  /** The only mutation hook. Fired by the Apply click only. */
  onApply(intent: RecoveryRestoreIntent): Promise<RecoveryApplyResult>;
  /** Fired only by a click on "Open restored base" after a successful apply. */
  onOpenRestored(baseId: string): void | Promise<void>;
}

type Step = "list" | "preview" | "name" | "confirm" | "done";

const MAX_NAME_LENGTH = 100;

function presetLabel(preset: string): string {
  return preset === "ent-clinical" ? "ENT clinical" : "Generic";
}

function dateLabel(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function sizeLabel(size: number | null): string {
  if (size === null) return "size unknown";
  return size < 1024 ? `${size} B` : `${Math.round(size / 1024)} KB`;
}

function originLabel(candidate: RecoveryCandidate): string {
  return candidate.origin === "kept-backup" ? "Kept data backup" : "Sync conflict rescue";
}

function nameProblem(name: string, existingNames: readonly string[]): string {
  const clean = name.normalize("NFC").trim();
  if (!clean) return "Enter a name for the restored base.";
  if (clean.length > MAX_NAME_LENGTH) return "Keep the name to 100 characters or fewer.";
  if (/[\p{Cc}\p{Cf}]/u.test(clean)) return "The name contains an unsupported control character.";
  const key = normalizedNameKey(clean);
  if (existingNames.some((existing) => normalizedNameKey(existing) === key)) return "A knowledge base with this name already exists.";
  return "";
}

export class RecoveryCopyModal extends Modal {
  private step: Step = "list";
  private discovery: RecoveryDiscoveryResult | null = null;
  private selected: RecoveryCandidate | null = null;
  private parsed: RecoveryCopyParsed | null = null;
  private notRestorable: RecoveryCopyRejected | "unreadable" | null = null;
  private baseId = "";
  private chosenName = "";
  private restoredBaseId = "";
  private restoredName = "";
  private busy = false;
  private blocked = false;
  private closed = false;
  private pageEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private errorEl: HTMLElement | null = null;

  constructor(app: App, private readonly callbacks: RecoveryCopyModalCallbacks) {
    super(app);
  }

  onOpen(): void {
    this.closed = false;
    this.modalEl.addClass("ent-cc-sync-recovery-modal");
    this.contentEl.addClass("ent-cc-modal", "ent-cc-sync-recovery");
    this.titleEl.setText("Review kept copies");
    this.contentEl.empty();
    // Persistent live regions live outside the page container so they survive step changes.
    this.statusEl = this.contentEl.createDiv({
      cls: "ent-cc-sync-recovery-recheck-status",
      attr: { role: "status", "aria-live": "polite", "aria-atomic": "true" },
    });
    this.errorEl = this.contentEl.createDiv({
      cls: "ent-cc-form-error",
      attr: { role: "alert", "aria-live": "assertive", "aria-atomic": "true" },
    });
    this.pageEl = this.contentEl.createDiv({ cls: "ent-cc-sync-recovery-scroll" });
    this.step = "list";
    this.render();
    void this.runDiscovery();
  }

  onClose(): void {
    this.closed = true;
    this.contentEl.empty();
    this.pageEl = null;
    this.statusEl = null;
    this.errorEl = null;
  }

  private setStatus(text: string): void {
    this.statusEl?.setText(text);
  }

  private setError(text: string): void {
    this.errorEl?.setText(text);
  }

  private async runDiscovery(): Promise<void> {
    this.setStatus("Looking for kept copies…");
    try {
      const found = await this.callbacks.discover();
      if (this.closed) return;
      this.discovery = found;
      this.setStatus(found.summary);
    } catch {
      if (this.closed) return;
      this.discovery = { candidates: [], inspectedFolders: 0, unreadableFolders: 0, truncated: false, summary: "" };
      this.setStatus("");
      this.setError("The folders could not be checked. Nothing was changed.");
    }
    if (this.step === "list") this.render();
  }

  private go(step: Step): void {
    this.step = step;
    this.setError("");
    this.render();
  }

  private button(parent: HTMLElement, text: string, onClick: () => void, options: { cta?: boolean; disabled?: boolean; label?: string } = {}): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: "ent-cc-button",
      type: "button",
      text,
      attr: options.label ? { "aria-label": options.label } : undefined,
    });
    if (options.disabled) {
      button.disabled = true;
      button.setAttribute("aria-disabled", "true");
    }
    button.addEventListener("click", () => {
      if (button.disabled || this.busy) return;
      onClick();
    });
    return button;
  }

  private heading(text: string): HTMLElement {
    const heading = this.pageEl?.createEl("h3", { text, attr: { tabindex: "-1" } });
    if (!heading) throw new Error("The review page is not open.");
    return heading;
  }

  private render(): void {
    const page = this.pageEl;
    if (!page || this.closed) return;
    page.empty();
    let focus: HTMLElement | null = null;
    if (this.step === "list") focus = this.renderList(page);
    else if (this.step === "preview") focus = this.renderPreview(page);
    else if (this.step === "name") focus = this.renderName(page);
    else if (this.step === "confirm") focus = this.renderConfirm(page);
    else focus = this.renderDone(page);
    focus?.focus();
  }

  private renderList(page: HTMLElement): HTMLElement {
    const heading = this.heading("Kept copies");
    const note = page.createDiv({ cls: "ent-cc-sync-recovery-note" });
    note.createEl("p", { text: "Review a kept rescue copy or data backup and restore one of its knowledge bases as a new base. Your existing bases and notes are not changed." });
    const found = this.discovery;
    if (found === null) {
      note.createEl("p", { text: "Looking for kept copies…" });
    } else {
      note.createEl("p", { text: found.summary || "No folder could be checked." });
      const list = page.createDiv({ cls: "ent-cc-base-manager-list" });
      for (const candidate of found.candidates) {
        const row = list.createDiv({ cls: "ent-cc-base-manager-row" });
        row.createSpan({ text: candidate.displayName });
        const meta = [originLabel(candidate), candidate.mtime === null ? "date unknown" : dateLabel(new Date(candidate.mtime).toISOString()), sizeLabel(candidate.size)];
        row.createSpan({ cls: "ent-cc-picker-meta", text: meta.join(" · ") });
        this.button(row, "Review", () => void this.review(candidate), { label: `Review ${candidate.displayName}` });
      }
    }
    const actions = page.createDiv({ cls: "ent-cc-sync-recovery-actions" });
    if (this.callbacks.pickExplicit) {
      this.button(actions, "Choose another file", () => void this.pickExplicit());
    }
    this.button(actions, "Close", () => this.close());
    return heading;
  }

  private async pickExplicit(): Promise<void> {
    let candidate: RecoveryCandidate | null = null;
    try {
      candidate = (await this.callbacks.pickExplicit?.()) ?? null;
    } catch {
      candidate = null;
    }
    if (this.closed || candidate === null) return;
    await this.review(candidate);
  }

  private async review(candidate: RecoveryCandidate): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.selected = candidate;
    this.parsed = null;
    this.notRestorable = null;
    this.setError("");
    this.setStatus(`Reading ${candidate.displayName}…`);
    let loaded: RecoveryCopyLoadResult;
    try {
      loaded = await this.callbacks.load(candidate);
    } catch {
      loaded = { status: "unreadable" };
    }
    this.busy = false;
    if (this.closed) return;
    if (loaded.status === "unreadable") {
      this.notRestorable = "unreadable";
      this.setStatus("This file could not be read. It is left untouched.");
    } else if (loaded.result.ok) {
      this.parsed = loaded.result;
      this.setStatus(`Previewing ${candidate.displayName}.`);
    } else {
      this.notRestorable = loaded.result;
      this.setStatus("Preserved, not restorable.");
    }
    this.go("preview");
  }

  private renderPreview(page: HTMLElement): HTMLElement {
    const heading = this.heading("Review this copy");
    const actions = (): HTMLElement => page.createDiv({ cls: "ent-cc-sync-recovery-actions" });
    if (this.notRestorable !== null) {
      const callout = page.createDiv({ cls: "ent-cc-sync-recovery-callout is-warning" });
      callout.createEl("strong", { text: "Preserved, not restorable" });
      callout.createEl("p", {
        text: this.notRestorable === "unreadable"
          ? "This file could not be read. It is left untouched and is not counted as a valid recovery."
          : this.notRestorable.message,
      });
      const row = actions();
      this.button(row, "Back", () => this.go("list"));
      this.button(row, "Close", () => this.close());
      return heading;
    }
    const parsed = this.parsed;
    if (!parsed) return heading;
    const preview = parsed.preview;
    const facts = page.createDiv({ cls: "ent-cc-sync-recovery-facts" });
    const fact = (label: string, value: string): void => {
      const row = facts.createDiv({ cls: "ent-cc-sync-recovery-fact" });
      row.createSpan({ text: label });
      row.createEl("strong", { text: value });
    };
    fact("Source", preview.sourceKind === "conflict-rescue" ? "Sync conflict rescue" : "Plugin data backup");
    fact("Date", preview.date ? dateLabel(preview.date.iso) : "Date not available");
    fact("Format", preview.supportedSchema ? "Supported" : "Not supported");
    fact("Vault", preview.identity === "same-vault" ? "This vault" : preview.identity === "foreign-vault" ? "A different vault" : "Could not be verified");
    page.createEl("p", { text: preview.identityGuidance });

    const list = page.createDiv({ cls: "ent-cc-base-manager-list" });
    for (const base of preview.bases) {
      const row = list.createDiv({ cls: "ent-cc-base-manager-row" });
      row.createSpan({ text: base.name });
      row.createSpan({ cls: "ent-cc-picker-meta", text: this.baseSummary(base) });
      if (preview.restorable) {
        this.button(row, "Restore this base", () => this.chooseBase(base), { label: `Restore ${base.name}` });
      }
    }
    const disclosure = page.createDiv({ cls: "ent-cc-sync-recovery-callout is-warning" });
    disclosure.createEl("strong", { text: "Private content" });
    disclosure.createEl("p", { text: preview.privateContentDisclosure });
    const row = actions();
    this.button(row, "Back", () => this.go("list"));
    this.button(row, "Close", () => this.close());
    return heading;
  }

  private baseSummary(base: RecoveryCopyBasePreview): string {
    const c = base.counts;
    return [
      presetLabel(base.preset),
      base.archived ? "archived" : "active",
      `${c.collections} collections`,
      `${c.pinned} pinned`,
      `${c.savedViews} saved views`,
      `${c.indexedNotes} indexed notes`,
      `${c.linkedFolders} linked folders`,
      `${c.libraries} libraries`,
      `${c.namedSnapshots} named snapshots`,
      `${c.undoSteps} Undo and ${c.redoSteps} Redo steps (not restored)`,
    ].join(" · ");
  }

  private chooseBase(base: RecoveryCopyBasePreview): void {
    this.baseId = base.baseId;
    this.chosenName = suggestRestoredBaseName(base.name, this.callbacks.getExistingNames());
    this.go("name");
  }

  private renderName(page: HTMLElement): HTMLElement {
    this.heading("Name the restored base");
    const label = page.createEl("label", { text: "Name for the restored base", attr: { for: "ent-cc-recovery-name" } });
    label.addClass("ent-cc-sync-recovery-note");
    const input = page.createEl("input", { type: "text", attr: { id: "ent-cc-recovery-name", "aria-describedby": "ent-cc-recovery-name-problem" } });
    input.value = this.chosenName;
    const problem = page.createDiv({ cls: "ent-cc-form-error", attr: { id: "ent-cc-recovery-name-problem" } });
    const actions = page.createDiv({ cls: "ent-cc-sync-recovery-actions" });
    const check = (): string => nameProblem(input.value, this.callbacks.getExistingNames());
    const next = this.button(actions, "Continue", () => {
      this.chosenName = input.value.normalize("NFC").trim();
      if (check()) return;
      this.go("confirm");
    }, { disabled: check() !== "" });
    this.button(actions, "Back", () => this.go("preview"));
    this.button(actions, "Cancel", () => this.close());
    const sync = (): void => {
      const text = check();
      problem.setText(text);
      next.disabled = text !== "";
      next.setAttribute("aria-disabled", text === "" ? "false" : "true");
    };
    input.addEventListener("input", sync);
    sync();
    return input;
  }

  private renderConfirm(page: HTMLElement): HTMLElement {
    const heading = this.heading("Restore as a new base");
    const base = this.parsed?.preview.bases.find((candidate) => candidate.baseId === this.baseId);
    const facts = page.createDiv({ cls: "ent-cc-sync-recovery-facts" });
    const fact = (label: string, value: string): void => {
      const row = facts.createDiv({ cls: "ent-cc-sync-recovery-fact" });
      row.createSpan({ text: label });
      row.createEl("strong", { text: value });
    };
    fact("New base name", this.chosenName);
    fact("Preset", presetLabel(base?.preset ?? "generic"));
    fact("Restored from", base?.name ?? "");
    page.createEl("p", { text: "Your current knowledge bases and the active base stay as they are. No notes, folders or attachments are changed or moved." });
    page.createEl("p", { text: "Not carried over:" });
    const omitted = page.createEl("ul");
    for (const item of RECOVERY_RESTORE_OMITTED_ITEMS) omitted.createEl("li", { text: item });
    const readOnly = this.callbacks.isReadOnly();
    if (readOnly) {
      page.createDiv({ cls: "ent-cc-sync-recovery-callout is-warning" }).createEl("p", {
        text: "Read-only: restoring is unavailable while data is protected. You can still review this copy.",
      });
    }
    const actions = page.createDiv({ cls: "ent-cc-sync-recovery-actions" });
    this.button(actions, "Restore as new base", () => void this.apply(), { disabled: readOnly || this.blocked });
    this.button(actions, "Back", () => this.go("name"));
    this.button(actions, "Cancel", () => this.close());
    return heading;
  }

  private async apply(): Promise<void> {
    if (this.busy || this.blocked || this.callbacks.isReadOnly() || !this.parsed) return;
    this.setError("");
    const intentResult = createRecoveryRestoreIntent({
      parsed: this.parsed,
      selectedBaseId: this.baseId,
      existingNames: this.callbacks.getExistingNames(),
      existingBaseIds: this.callbacks.getExistingBaseIds(),
      generateIdentity: () => this.callbacks.generateIdentity(),
      chosenName: this.chosenName,
    });
    if (!intentResult.ok) {
      this.setError(intentResult.message);
      return;
    }
    this.busy = true;
    this.setStatus("Restoring…");
    let result: RecoveryApplyResult;
    try {
      result = await this.callbacks.onApply(intentResult.intent);
    } catch {
      result = { status: "uncertain", message: "The restore may not have finished." };
    }
    this.busy = false;
    if (this.closed) return;
    if (result.status === "applied") {
      this.restoredBaseId = result.baseId;
      this.restoredName = intentResult.intent.name;
      this.setStatus(`Restored as “${this.restoredName}”.`);
      this.step = "done";
      this.setError("");
      this.render();
      return;
    }
    if (result.status === "uncertain") {
      this.blocked = true;
      this.setStatus("");
      this.setError(`${result.message} Check Manage knowledge bases before trying again.`);
    } else {
      this.setStatus("");
      this.setError(`${result.message} Nothing was changed.`);
    }
    this.render();
  }

  private renderDone(page: HTMLElement): HTMLElement {
    const heading = this.heading("Base restored");
    page.createEl("p", { text: `“${this.restoredName}” was added as a new knowledge base. Your active base has not changed.` });
    const actions = page.createDiv({ cls: "ent-cc-sync-recovery-actions" });
    this.button(actions, "Open restored base", () => {
      void Promise.resolve(this.callbacks.onOpenRestored(this.restoredBaseId));
    });
    this.button(actions, "Close", () => this.close());
    return heading;
  }
}
