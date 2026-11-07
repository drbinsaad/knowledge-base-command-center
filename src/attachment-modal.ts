import { Modal, Notice, Setting, type App } from "obsidian";
import { errorMessage, type AttachmentInsertionMode, type AttachmentStorageMode } from "./model";
import { StringPickerModal } from "./modals";
import {
  AttachmentLinkInsertionError,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_FILES,
  attachmentCanPreview,
  canonicalAttachmentFolder,
  noteAttachmentFolder,
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

/**
 * Where the files will go, for the selected policy. Obsidian may add a
 * collision suffix, so a final filename is never promised.
 */
export function attachmentDestinationSummary(
  policy: Pick<AttachmentOperationPolicy, "storageMode" | "configuredFolder">,
  notePath: string,
  requestedFolder: string,
  destinationSelected: boolean,
): string {
  const place = (folder: string): string => folder ? `the folder ${folder}` : "the vault root";
  if (policy.storageMode === "fixed-folder") {
    return `Configured folder: files are copied into ${place(canonicalAttachmentFolder(policy.configuredFolder))}. A repeated name gets a number added.`;
  }
  if (policy.storageMode === "note-subfolder") {
    return `Beside this note: files are copied into ${place(noteAttachmentFolder(notePath))}. A repeated name gets a number added.`;
  }
  if (policy.storageMode === "ask") {
    return destinationSelected
      ? `Chosen now: files are copied into ${place(canonicalAttachmentFolder(requestedFolder))}. A repeated name gets a number added.`
      : "Choose a vault folder or the vault root below before attaching.";
  }
  return "Obsidian attachment setting: Obsidian chooses the folder and any number added to a repeated name when each file is copied.";
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
  private storageSetting: Setting | null = null;
  private statusEl: HTMLElement | null = null;
  private cancelButton: HTMLButtonElement | null = null;
  /** Set once files were copied but not linked: this batch can never be submitted again. */
  private copiedWithoutLinks = false;

  constructor(
    app: App,
    private readonly notePath: string,
    private readonly policy: AttachmentOperationPolicy,
    private readonly availableFolders: string[],
    insertionMode: AttachmentInsertionMode,
    /** True only while the selected note owns the active Markdown editor. */
    private readonly cursorAvailable: boolean,
    private readonly onSubmit: (value: AttachmentBatchValue) => Promise<void>,
  ) {
    super(app);
    this.requestedFolder = policy.storageMode === "ask" ? "" : policy.configuredFolder;
    this.destinationSelected = policy.storageMode !== "ask";
    this.insertionMode = insertionMode === "cursor" && !cursorAvailable ? "end" : insertionMode;
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
      this.clearProblem();
      this.renderSelection();
      this.updateSubmit();
    });

    this.storageSetting = new Setting(this.contentEl)
      .setName("Storage")
      .setDesc(this.destinationText());

    if (this.policy.storageMode === "ask") {
      const destination = new Setting(this.contentEl)
        .setName("Destination folder")
        .setDesc("Choose a folder or vault root.")
        .addButton((button) => button.setButtonText("Choose…").onClick(() => {
          new StringPickerModal(this.app, this.availableFolders, "Choose attachment folder", "Search vault folders…", (folder) => {
            this.requestedFolder = folder;
            this.destinationSelected = true;
            destination.setDesc(folder || "Vault root");
            this.destinationChanged();
          }).open();
        }))
        .addButton((button) => button.setButtonText("Use vault root").onClick(() => {
          this.requestedFolder = "";
          this.destinationSelected = true;
          destination.setDesc("Vault root");
          this.destinationChanged();
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
        })
        .selectEl.setAttribute("aria-label", "Show in note"));

    const insertOptions: Record<string, string> = this.cursorAvailable
      ? { cursor: "At the current cursor" }
      : {};
    Object.assign(insertOptions, {
      marker: "At the configured marker",
      heading: "Under the configured heading",
      end: "At the end of the note",
    });
    new Setting(this.contentEl)
      .setName("Insert link")
      .setDesc(this.cursorAvailable
        ? "This affects only the links for this upload."
        : "This affects only the links for this upload. Cursor insertion appears only while this note is open in the editor.")
      .addDropdown((dropdown) => dropdown
        .addOptions(insertOptions)
        .setValue(this.insertionMode)
        .onChange((value) => {
          this.insertionMode = value as AttachmentInsertionMode;
          this.clearProblem();
        })
        .selectEl.setAttribute("aria-label", "Insert link"));

    this.statusEl = this.contentEl.createDiv({ cls: "ent-cc-attachment-status" });
    this.statusEl.setAttribute("role", "alert");
    const footer = this.contentEl.createDiv({ cls: "ent-cc-modal-footer ent-cc-attachment-footer" });
    const cancel = footer.createEl("button", { text: this.copiedWithoutLinks ? "Close" : "Cancel" });
    this.cancelButton = cancel;
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
    this.storageSetting = null;
    this.statusEl = null;
    this.cancelButton = null;
  }

  private destinationText(): string {
    return attachmentDestinationSummary(this.policy, this.notePath, this.requestedFolder, this.destinationSelected);
  }

  private destinationChanged(): void {
    this.clearProblem();
    this.storageSetting?.setDesc(this.destinationText());
    this.updateSubmit();
  }

  private statusContainer(): HTMLElement {
    if (!this.statusEl) {
      this.statusEl = this.contentEl.createDiv({ cls: "ent-cc-attachment-status" });
      this.statusEl.setAttribute("role", "alert");
    }
    return this.statusEl;
  }

  private clearProblem(): void {
    if (this.copiedWithoutLinks) return;
    this.statusEl?.empty();
  }

  /** A persistent inline alert for a failure before any file was copied; the draft stays editable. */
  private showProblem(message: string): void {
    const status = this.statusContainer();
    status.empty();
    status.createEl("p", { cls: "mod-warning", text: message });
    const dismiss = status.createEl("button", { text: "Dismiss" });
    dismiss.addEventListener("click", () => this.clearProblem());
  }

  /** Files exist in the vault but are not linked: show where, and never offer another copy. */
  private showCopiedWithoutLinks(error: AttachmentLinkInsertionError): void {
    this.copiedWithoutLinks = true;
    const status = this.statusContainer();
    status.empty();
    status.createEl("p", { cls: "mod-warning", text: "Files copied; links were not inserted. Do not attach them again." });
    status.createEl("p", { text: error.message });
    if (error.copiedPaths.length > 0) {
      const list = status.createEl("ul");
      for (const path of error.copiedPaths) list.createEl("li", { text: path }).setAttribute("dir", "auto");
    }
    this.cancelButton?.setText("Close");
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
    this.submitButton.disabled = this.submitting || this.copiedWithoutLinks || !attachmentSubmitReady(
      count > 0 && attachmentSelectionProblem(this.selectedFiles) === null,
      this.policy.storageMode,
      this.destinationSelected,
    );
  }

  private async submit(): Promise<void> {
    const files = [...this.selectedFiles];
    if (this.submitting || this.copiedWithoutLinks || files.length === 0
      || attachmentSelectionProblem(files) !== null
      || !attachmentSubmitReady(true, this.policy.storageMode, this.destinationSelected)) return;
    this.submitting = true;
    this.clearProblem();
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
      // Copied files stay in the vault; a retry from this form would copy them
      // again, so keep the paths on screen and lock this batch.
      if (error instanceof AttachmentLinkInsertionError) this.showCopiedWithoutLinks(error);
      else this.showProblem(errorMessage(error, "The attachment could not be added."));
    } finally {
      this.submitting = false;
      this.updateSubmit();
    }
  }
}
