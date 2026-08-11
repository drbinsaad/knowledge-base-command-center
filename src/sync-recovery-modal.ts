import { Modal, Notice, setIcon } from "obsidian";
import type EntVaultCommandCenterPlugin from "./main";
import { formatLocalAge, type SyncRecoveryCenterSnapshot } from "./sync-recovery";

export class SyncRecoveryCenterModal extends Modal {
  private openedBaseId = "";
  private openedDataEpoch = 0;
  private staleNoticeShown = false;
  private focusTimer: number | null = null;

  constructor(private readonly plugin: EntVaultCommandCenterPlugin) {
    super(plugin.app);
  }

  onOpen(): void {
    this.openedBaseId = this.plugin.getActiveKnowledgeBaseId();
    this.openedDataEpoch = this.plugin.getDataEpoch();
    this.staleNoticeShown = false;
    this.modalEl.addClass("ent-cc-sync-recovery-modal");
    this.contentEl.addClass("ent-cc-modal", "ent-cc-sync-recovery");
    this.titleEl.setText("Sync & recovery center");
    this.render(true);
  }

  onClose(): void {
    if (this.focusTimer !== null) {
      this.contentEl.ownerDocument.defaultView?.clearTimeout(this.focusTimer);
      this.focusTimer = null;
    }
  }

  private ownsOpenedBase(): boolean {
    return this.plugin.getActiveKnowledgeBaseId() === this.openedBaseId
      && this.plugin.getDataEpoch() === this.openedDataEpoch;
  }

  private guardOpenedBase(): boolean {
    if (this.ownsOpenedBase()) return true;
    this.close();
    if (!this.staleNoticeShown) {
      this.staleNoticeShown = true;
      new Notice("Knowledge-base data changed. Reopen sync & recovery center for a current local snapshot.", 8000);
    }
    return false;
  }

  private render(focusAction = false): void {
    if (!this.guardOpenedBase()) return;
    const snapshot = this.plugin.getSyncRecoveryCenterSnapshot();
    const now = Date.now();
    this.contentEl.empty();

    const intro = this.contentEl.createDiv({ cls: "ent-cc-sync-recovery-intro" });
    intro.createEl("p", {
      text: "Local facts only. This center does not inspect Obsidian Sync, network state, remote devices, or note contents.",
    });
    const mode = intro.createDiv({
      cls: `ent-cc-sync-recovery-mode ${snapshot.readOnly ? "is-read-only" : "is-writable"}`,
      attr: { role: "status", "aria-live": "polite" },
    });
    const modeIcon = mode.createSpan({ attr: { "aria-hidden": "true" } });
    setIcon(modeIcon, snapshot.readOnly ? "shield-alert" : "shield-check");
    mode.createSpan({ text: snapshot.readOnly ? "Protected read-only" : "Writable" });

    const scroll = this.contentEl.createDiv({
      cls: "ent-cc-sync-recovery-scroll",
      attr: { role: "region", "aria-label": "Local Sync and Recovery diagnostics", tabindex: "0" },
    });
    this.renderActiveBase(scroll, snapshot);
    this.renderTimeline(scroll, snapshot, now);
    this.renderRecovery(scroll, snapshot, now);
    this.renderProtection(scroll, snapshot);
    this.renderDevice(scroll, snapshot);
    scroll.createDiv({
      cls: "ent-cc-sync-recovery-boundary",
      text: "A quiet local history is not proof that remote changes have finished. Use your sync provider's own supported status surface before switching devices.",
    });

    const actions = this.contentEl.createDiv({ cls: "ent-cc-sync-recovery-actions" });
    const recheck = this.actionButton(actions, "refresh-cw", "Recheck local facts", () => this.render());
    this.actionButton(actions, "x", "Close", () => this.close());
    if (focusAction) this.focusFromOwnerWindow(recheck);
  }

  private renderActiveBase(parent: HTMLElement, snapshot: SyncRecoveryCenterSnapshot): void {
    const section = this.section(parent, "Active knowledge base", "library-big");
    const facts = section.createEl("dl", { cls: "ent-cc-sync-recovery-facts" });
    this.fact(facts, "Name", snapshot.activeBaseName);
    this.fact(facts, "Profile", snapshot.workspaceProfile);
    this.fact(facts, "Semantic revision", snapshot.semanticRevision.toLocaleString());
    this.fact(facts, "Semantic head", snapshot.semanticHeadSummary);
    this.fact(facts, "Local commit state", snapshot.semanticCommitState === "committed"
      ? "Matches the last committed local snapshot"
      : snapshot.semanticCommitState === "pending"
        ? "Live semantic state differs from the last committed local snapshot"
        : "No committed local snapshot is available");
    section.createEl("p", {
      cls: "ent-cc-sync-recovery-note",
      text: "The head is a shortened non-secret fingerprint for comparison. Vault and knowledge-base identifiers are intentionally hidden.",
    });
  }

  private renderTimeline(parent: HTMLElement, snapshot: SyncRecoveryCenterSnapshot, now: number): void {
    const section = this.section(parent, "Local persistence timeline", "history");
    const facts = section.createEl("dl", { cls: "ent-cc-sync-recovery-facts" });
    this.fact(facts, "Last successful local organization save", formatLocalAge(snapshot.lastLocalSaveAt, now));
    const reloadOutcome = snapshot.lastExternalReloadOutcome === "applied"
      ? " · applied locally"
      : snapshot.lastExternalReloadOutcome === "blocked"
        ? " · blocked locally"
        : "";
    this.fact(facts, "Last external plugin-data reload", `${formatLocalAge(snapshot.lastExternalReloadAt, now)}${reloadOutcome}`);
    this.fact(facts, "Newest confirmed recovery export", formatLocalAge(snapshot.newestRecoveryExportAt, now));
    section.createEl("p", {
      cls: "ent-cc-sync-recovery-note",
      text: "External reload means this plugin observed and handled a local data.json change. It does not mean a sync service is online or finished.",
    });
  }

  private renderRecovery(parent: HTMLElement, snapshot: SyncRecoveryCenterSnapshot, now: number): void {
    const section = this.section(parent, "Conflict and recovery artifacts", "archive-restore");
    if (!snapshot.artifactInspectionAvailable) {
      section.createDiv({
        cls: "ent-cc-sync-recovery-callout is-warning",
        attr: { role: "status" },
        text: "The public Vault API could not inspect the local export folder, so artifact counts are unavailable.",
      });
    } else {
      const facts = section.createEl("dl", { cls: "ent-cc-sync-recovery-facts" });
      const countPrefix = snapshot.conflictRescueCountIsLowerBound ? "At least " : "";
      this.fact(facts, "Conflict-rescue files", `${countPrefix}${snapshot.conflictRescueCount.toLocaleString()}`);
      this.fact(
        facts,
        snapshot.conflictRescueCountIsLowerBound ? "Newest inspected conflict rescue" : "Newest conflict rescue",
        formatLocalAge(snapshot.newestConflictRescueAt, now),
      );
    }
    if (snapshot.activeBaseConcurrentEditAt !== null) {
      const count = snapshot.activeBaseConcurrentEditCount;
      section.createDiv({
        cls: "ent-cc-sync-recovery-callout is-warning",
        attr: { role: "alert" },
        text: `${count} concurrent semantic edit${count === 1 ? "" : "s"} involving the active base ${count === 1 ? "was" : "were"} detected ${formatLocalAge(snapshot.activeBaseConcurrentEditAt, now).toLowerCase()}. A losing complete envelope was offered to private conflict rescue before deterministic merging.`,
      });
    } else {
      section.createDiv({
        cls: "ent-cc-sync-recovery-callout",
        text: "No same-base concurrent edit is recorded for the active base on this device. This is historical local evidence, not a live safety signal.",
      });
    }
    section.createEl("p", {
      cls: "ent-cc-sync-recovery-note",
      text: "Counts use only the documented conflict-rescue filename pattern and file modification times. The scan is capped at 2,000 direct export-folder entries; when capped, counts are lower bounds. File names, full paths, JSON contents, and note bodies are not displayed or read.",
    });
  }

  private renderProtection(parent: HTMLElement, snapshot: SyncRecoveryCenterSnapshot): void {
    const section = this.section(parent, "Protection state", "shield");
    const facts = section.createEl("dl", { cls: "ent-cc-sync-recovery-facts" });
    this.fact(facts, "Organization mode", snapshot.readOnly ? "Protected read-only" : "Writable");
    this.fact(facts, "Reason", snapshot.readOnlyReason);
    this.fact(facts, "Sticky until restart", snapshot.stickyUntilRestart ? "Yes" : "No");
    if (snapshot.readOnly) {
      section.createDiv({
        cls: "ent-cc-sync-recovery-callout is-warning",
        attr: { role: "alert" },
        text: "Do not force a write. Preserve plugin data and private recovery material, then follow the documented recovery steps.",
      });
    }
  }

  private renderDevice(parent: HTMLElement, snapshot: SyncRecoveryCenterSnapshot): void {
    const section = this.section(parent, "This device", "monitor-smartphone");
    const facts = section.createEl("dl", { cls: "ent-cc-sync-recovery-facts" });
    this.fact(facts, "Runtime", snapshot.deviceProfile);
    this.fact(facts, "Obsidian configuration", snapshot.configProfile);
    this.fact(facts, "Device-local view state", snapshot.deviceLocalStateProfile);
    section.createEl("p", {
      cls: "ent-cc-sync-recovery-note",
      text: "These labels use only Obsidian's public platform, vault, and vault-scoped local-storage interfaces. Custom configuration names remain hidden.",
    });
  }

  private section(parent: HTMLElement, title: string, icon: string): HTMLElement {
    const section = parent.createEl("section", { cls: "ent-cc-sync-recovery-section" });
    const heading = section.createEl("h3");
    const iconEl = heading.createSpan({ attr: { "aria-hidden": "true" } });
    setIcon(iconEl, icon);
    heading.createSpan({ text: title });
    return section;
  }

  private fact(parent: HTMLElement, label: string, value: string): void {
    const row = parent.createDiv({ cls: "ent-cc-sync-recovery-fact" });
    row.createEl("dt", { text: label });
    row.createEl("dd", { text: value });
  }

  private actionButton(parent: HTMLElement, icon: string, label: string, action: () => void): HTMLButtonElement {
    const button = parent.createEl("button", { cls: "ent-cc-button", type: "button" });
    const iconEl = button.createSpan({ attr: { "aria-hidden": "true" } });
    setIcon(iconEl, icon);
    button.createSpan({ text: label });
    button.addEventListener("click", () => {
      if (label !== "Close" && !this.guardOpenedBase()) return;
      action();
    });
    return button;
  }

  private focusFromOwnerWindow(element: HTMLElement): void {
    const ownerWindow = this.contentEl.ownerDocument.defaultView;
    if (!ownerWindow) {
      element.focus();
      return;
    }
    let firedSynchronously = false;
    const timer = ownerWindow.setTimeout(() => {
      firedSynchronously = true;
      this.focusTimer = null;
      if (this.ownsOpenedBase() && this.contentEl.contains(element)) element.focus();
    }, 0);
    if (!firedSynchronously) this.focusTimer = timer;
  }
}
