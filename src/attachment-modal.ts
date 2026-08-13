import { Modal, Notice, Setting, type App } from "obsidian";
import { errorMessage, type AttachmentInsertionMode, type AttachmentStorageMode } from "./model";
import { StringPickerModal } from "./modals";

export interface AttachmentImportValue {
  file: File;
  requestedFolder: string;
  insertionMode: AttachmentInsertionMode;
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

function storageLabel(mode: AttachmentStorageMode): string {
  if (mode === "fixed-folder") return "Configured vault folder";
  if (mode === "note-subfolder") return "Folder beside this note";
  if (mode === "ask") return "Choose a vault folder now";
  return "Obsidian attachment setting";
}

export class AttachmentImportModal extends Modal {
  private selectedFile: File | null = null;
  private requestedFolder: string;
  private destinationSelected: boolean;
  private insertionMode: AttachmentInsertionMode;
  private submitButton: HTMLButtonElement | null = null;

  constructor(
    app: App,
    private readonly notePath: string,
    private readonly policy: AttachmentOperationPolicy,
    private readonly availableFolders: string[],
    insertionMode: AttachmentInsertionMode,
    private readonly onSubmit: (value: AttachmentImportValue) => Promise<void>,
  ) {
    super(app);
    this.requestedFolder = policy.storageMode === "ask" ? "" : policy.configuredFolder;
    this.destinationSelected = policy.storageMode !== "ask";
    this.insertionMode = insertionMode;
  }

  onOpen(): void {
    this.modalEl.addClass("ent-cc-attachment-modal");
    this.setTitle("Attach file to note");
    this.contentEl.createEl("p", {
      cls: "setting-item-description",
      text: `Choose one local file. It will be copied into this vault and linked only from ${this.notePath}. Ordinary paste and drag-and-drop remain controlled by Obsidian.`,
    });

    const fileSetting = new Setting(this.contentEl)
      .setName("File")
      .setDesc("Maximum 100 megabytes. The original external file is not modified.");
    const input = fileSetting.controlEl.createEl("input", { type: "file" });
    input.setAttribute("aria-label", "Choose attachment file");
    input.addEventListener("change", () => {
      this.selectedFile = input.files?.item(0) ?? null;
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
      .setName("Insert link")
      .setDesc("This affects only the generated Markdown link for this upload.")
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
    this.submitButton = footer.createEl("button", { cls: "mod-cta", text: "Attach file" });
    this.submitButton.addEventListener("click", () => void this.submit());
    this.updateSubmit();
  }

  onClose(): void {
    this.contentEl.empty();
    this.selectedFile = null;
    this.submitButton = null;
  }

  private updateSubmit(): void {
    if (this.submitButton) {
      this.submitButton.disabled = !attachmentSubmitReady(
        this.selectedFile !== null,
        this.policy.storageMode,
        this.destinationSelected,
      );
    }
  }

  private async submit(): Promise<void> {
    const file = this.selectedFile;
    if (!file || !attachmentSubmitReady(true, this.policy.storageMode, this.destinationSelected)) return;
    this.submitButton?.setAttribute("disabled", "true");
    try {
      await this.onSubmit({
        file,
        requestedFolder: this.requestedFolder,
        insertionMode: this.insertionMode,
      });
      this.close();
    } catch (error) {
      new Notice(errorMessage(error, "The attachment could not be added."), 9000);
      this.submitButton?.removeAttribute("disabled");
    }
  }
}
