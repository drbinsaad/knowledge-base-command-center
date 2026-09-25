import { Modal, Notice, Setting, type App } from "obsidian";
import { errorMessage, type AttachmentInsertionMode, type AttachmentStorageMode } from "./model";
import { StringPickerModal } from "./modals";
import {
  AttachmentLinkInsertionError,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_FILES,
  attachmentCanPreview,
  formatAttachmentSize,
  type AttachmentDisplayMode,
} from "./attachment";

export interface AttachmentImportValue {
  file: File;
  requestedFolder: string;
  insertionMode: AttachmentInsertionMode;
  /** How each link is shown. Omitted: Obsidian's generated link is inserted unchanged. */
  display?: AttachmentDisplayMode;
}

/** One Attach file submission: the same folder, placement, and display for every file. */
export interface AttachmentBatchValue extends Omit<AttachmentImportValue, "file"> {
  files: readonly File[];
}

export interface AttachmentOperationPolicy {
  expectedBaseId: string;
  expectedDataEpoch: number;
  storageMode: AttachmentStorageMode;
  configuredFolder: string;
  marker: string;
  heading: string;
}

export function attachmentSubmitReady(
  fileSelected: boolean,
  storageMode: AttachmentStorageMode,
  destinationSelected: boolean,
): boolean {
  return fileSelected && (storageMode !== "ask" || destinationSelected);
}

/** Explain why a chosen set of files cannot be attached, or return null when it can. */
export function attachmentSelectionProblem(files: readonly Pick<File, "name" | "size">[]): string | null {
  if (files.length > MAX_ATTACHMENT_FILES) {
    return `Choose at most ${MAX_ATTACHMENT_FILES} files at a time. You chose ${files.length}.`;
  }
  const tooLarge = files.filter((file) => file.size > MAX_ATTACHMENT_BYTES);
  if (tooLarge.length === 1) return `${tooLarge[0]?.name ?? "One file"} is larger than 100 MB. Remove it or choose a smaller file.`;
  if (tooLarge.length > 1) return `${tooLarge.length} files are larger than 100 MB. Choose smaller files.`;
  return null;
}

function storageLabel(mode: AttachmentStorageMode): string {
  if (mode === "fixed-folder") return "Configured vault folder";
  if (mode === "note-subfolder") return "Folder beside this note";
  if (mode === "ask") return "Choose a vault folder now";
  return "Obsidian attachment setting";
}

export class AttachmentImportModal extends Modal {
  private selectedFiles: File[] = [];
  private requestedFolder: string;
  private destinationSelected: boolean;
  private insertionMode: AttachmentInsertionMode;
  private display: AttachmentDisplayMode = "auto";
  private submitting = false;
  private submitButton: HTMLButtonElement | null = null;
  private selectionEl: HTMLElement | null = null;

  constructor(
    app: App,
    private readonly notePath: string,
    private readonly policy: AttachmentOperationPolicy,
    private readonly availableFolders: string[],
    insertionMode: AttachmentInsertionMode,
    private readonly onSubmit: (value: AttachmentBatchValue) => Promise<void>,
  ) {
    super(app);
    this.requestedFolder = policy.storageMode === "ask" ? "" : policy.configuredFolder;
    this.destinationSelected = policy.storageMode !== "ask";
    this.insertionMode = insertionMode;
  }

  onOpen(): void {
    this.modalEl.addClass("ent-cc-attachment-modal");
    this.setTitle("Attach files to note");
    this.contentEl.createEl("p", {
      cls: "setting-item-description",
      text: `Choose one or more files of any type: PDF, Word, PowerPoint, Excel, images, audio, video, ZIP, and more. Each file is copied into this vault and linked from ${this.notePath}. Your original files are not changed.`,
    });

    const fileSetting = new Setting(this.contentEl)
      .setName("Files")
      .setDesc(`Up to ${MAX_ATTACHMENT_FILES} files at a time, each up to 100 MB.`);
    const input = fileSetting.controlEl.createEl("input", { type: "file" });
    input.multiple = true;
    input.setAttribute("aria-label", "Choose files to attach");
    this.selectionEl = this.contentEl.createDiv({ cls: "ent-cc-attachment-selection" });
    this.selectionEl.setAttribute("aria-live", "polite");
    input.addEventListener("change", () => {
      this.selectedFiles = Array.from(input.files ?? []);
      this.renderSelection();
      this.updateSubmit();
    });

    new Setting(this.contentEl)
      .setName("Storage")
      .setDesc(storageLabel(this.policy.storageMode));

    if (this.policy.storageMode === "ask") {
      const destination = new Setting(this.contentEl)
        .setName("Destination folder")
        .setDesc("Choose a folder or vault root.")
        .addButton((button) => button.setButtonText("Choose…").onClick(() => {
          new StringPickerModal(this.app, this.availableFolders, "Choose attachment folder", "Search vault folders…", (folder) => {
            this.requestedFolder = folder;
            this.destinationSelected = true;
            destination.setDesc(folder || "Vault root");
            this.updateSubmit();
          }).open();
        }))
        .addButton((button) => button.setButtonText("Use vault root").onClick(() => {
          this.requestedFolder = "";
          this.destinationSelected = true;
          destination.setDesc("Vault root");
          this.updateSubmit();
        }));
    }

    new Setting(this.contentEl)
      .setName("Show in note")
      .setDesc("Previews appear inside the note. Other files appear as links that open in their own app.")
      .addDropdown((dropdown) => dropdown
        .addOptions({
          auto: "Preview images, PDF, audio, and video; link the rest",
          embed: "Embed every file",
          link: "Link only",
        })
        .setValue(this.display)
        .onChange((value) => {
          this.display = value as AttachmentDisplayMode;
          this.renderSelection();
        }));

    new Setting(this.contentEl)
      .setName("Insert link")
      .setDesc("This affects only the links for this upload.")
      .addDropdown((dropdown) => dropdown
        .addOptions({
          cursor: "At the current cursor",
          marker: "At the configured marker",
          heading: "Under the configured heading",
          end: "At the end of the note",
        })
        .setValue(this.insertionMode)
        .onChange((value) => { this.insertionMode = value as AttachmentInsertionMode; }));

    const footer = this.contentEl.createDiv({ cls: "ent-cc-modal-footer ent-cc-attachment-footer" });
    const cancel = footer.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    this.submitButton = footer.createEl("button", { cls: "mod-cta", text: "Attach" });
    this.submitButton.addEventListener("click", () => void this.submit());
    this.updateSubmit();
  }

  onClose(): void {
    this.contentEl.empty();
    this.selectedFiles = [];
    this.submitButton = null;
    this.selectionEl = null;
  }

  private renderSelection(): void {
    const container = this.selectionEl;
    if (!container) return;
    container.empty();
    if (this.selectedFiles.length === 0) return;
    const list = container.createEl("ul");
    for (const file of this.selectedFiles) {
      const preview = this.display === "embed" || (this.display === "auto" && attachmentCanPreview(file.name));
      const status = file.size > MAX_ATTACHMENT_BYTES ? "too large" : preview ? "preview" : "link";
      const item = list.createEl("li", { text: `${file.name} · ${formatAttachmentSize(file.size)} · ${status}` });
      item.setAttribute("dir", "auto");
    }
    const problem = attachmentSelectionProblem(this.selectedFiles);
    if (problem) container.createEl("p", { cls: "mod-warning", text: problem });
  }

  private updateSubmit(): void {
    const count = this.selectedFiles.length;
    if (!this.submitButton) return;
    this.submitButton.setText(count > 1 ? `Attach ${count} files` : "Attach file");
    this.submitButton.disabled = this.submitting || !attachmentSubmitReady(
      count > 0 && attachmentSelectionProblem(this.selectedFiles) === null,
      this.policy.storageMode,
      this.destinationSelected,
    );
  }

  private async submit(): Promise<void> {
    const files = [...this.selectedFiles];
    if (this.submitting || files.length === 0
      || attachmentSelectionProblem(files) !== null
      || !attachmentSubmitReady(true, this.policy.storageMode, this.destinationSelected)) return;
    this.submitting = true;
    this.updateSubmit();
    try {
      await this.onSubmit({
        files,
        requestedFolder: this.requestedFolder,
        insertionMode: this.insertionMode,
        display: this.display,
      });
      this.close();
    } catch (error) {
      new Notice(errorMessage(error, "The attachment could not be added."), 9000);
      // Copied files stay in the vault; a retry from this form would copy them again.
      if (error instanceof AttachmentLinkInsertionError) this.close();
    } finally {
      this.submitting = false;
      this.updateSubmit();
    }
  }
}
