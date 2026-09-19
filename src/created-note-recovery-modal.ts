import { App, Modal, Notice } from "obsidian";
import { errorMessage } from "./model";

/** Recovery after a successful file write: never submit the creation form again. */
export class CreatedNoteRecoveryModal extends Modal {
  constructor(app: App, private readonly path: string, private readonly reason: string,
    private readonly openNote: () => Promise<void>, private readonly organize: () => void) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("ent-cc-modal");
    this.titleEl.setText("Note created — check its placement");
    this.contentEl.createEl("p", { text: "Your Markdown file is saved. Do not create it again. Open the note or retry organization when the plugin is writable." });
    this.contentEl.createEl("p", { text: this.path, cls: "ent-cc-created-note-path", attr: { dir: "auto" } });
    this.contentEl.createEl("p", { text: this.reason, attr: { role: "status" } });
    const actions = this.contentEl.createDiv({ cls: "ent-cc-collection-actions" });
    const open = actions.createEl("button", { text: "Open saved note", type: "button" });
    open.addEventListener("click", () => { void this.openNote().catch((error: unknown) => new Notice(errorMessage(error))); });
    const organize = actions.createEl("button", { text: "Organize saved note", type: "button", cls: "mod-cta" });
    organize.addEventListener("click", () => {
      try { this.organize(); this.close(); }
      catch (error) { new Notice(errorMessage(error)); }
    });
    const close = actions.createEl("button", { text: "Close", type: "button" });
    close.addEventListener("click", () => this.close());
  }
}
