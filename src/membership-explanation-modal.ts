import { Modal } from "obsidian";
import {
  explainIndexMembership,
  linkedSourceLabel,
} from "./membership-explanation";
import type { PluginData, VaultRecord } from "./model";

export class MembershipExplanationModal extends Modal {
  constructor(
    app: ConstructorParameters<typeof Modal>[0],
    private readonly record: VaultRecord,
    private readonly data: PluginData,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("ent-cc-membership-explanation-modal");
    this.contentEl.addClass("ent-cc-modal", "ent-cc-membership-explanation");
    this.titleEl.setText(`Why “${this.record.title}” appears`);
    this.titleEl.setAttribute("dir", "auto");
    const explanation = explainIndexMembership(this.record, this.data);
    const hasIndexAuthority = explanation.direct
      || explanation.linkedSources.length > 0
      || explanation.protectedSource
      || (explanation.importedPlaceholder
        && this.record.portableIndexed === true
        && !this.record.libraryId);
    this.contentEl.createEl("p", {
      text: "These are independent plugin facts. A folder shown only as the storage location does not add the note to the index.",
    });
    const facts = this.contentEl.createDiv({ cls: "ent-cc-manager-list ent-cc-membership-facts" });
    const addFact = (title: string, detail: string): void => {
      const item = facts.createDiv({ cls: "ent-cc-manager-diagnostic" });
      item.createEl("strong", { text: title });
      item.createEl("p", { text: detail, attr: { dir: "auto" } });
    };
    if (explanation.direct) {
      addFact("Added directly", "This exact subject stays in the Index until you explicitly remove its direct membership.");
    }
    for (const source of explanation.linkedSources) {
      addFact("Linked folder", `${linkedSourceLabel(source)} supplies current and future Markdown notes below it.`);
    }
    if (explanation.protectedSource) {
      addFact("Protected clinical source", "The ENT clinical preset supplies this record through its protected source rules.");
    }
    if (explanation.importedPlaceholder) {
      addFact("Imported placeholder", "This is a portable blueprint subject with no linked Markdown note yet.");
    }
    if (explanation.libraryId) {
      const library = this.data.portableIndex.libraries.find((candidate) => candidate.id === explanation.libraryId);
      addFact("Library placement", library?.name ?? explanation.libraryId);
    }
    if (explanation.excluded) {
      addFact("Hidden override", "This path is explicitly excluded from the Index. The Markdown file is unchanged.");
    }
    if (explanation.collectionTitles.length > 0) {
      addFact("Collections", explanation.collectionTitles.join(" · "));
    }
    if (explanation.pinned || explanation.nextStudy) {
      addFact("Personal shortcuts", [explanation.pinned ? "Pinned" : "", explanation.nextStudy ? "My next list" : ""].filter(Boolean).join(" · "));
    }
    addFact(
      "Storage location (not membership)",
      explanation.storagePath ?? "No Markdown file exists for this placeholder.",
    );
    if (!hasIndexAuthority) {
      addFact("No active Index authority", "This record may be visible in another section, search result, or Library without belonging to the Index.");
    }
    const close = this.contentEl.createEl("button", { cls: "ent-cc-button mod-cta", text: "Close", type: "button" });
    close.addEventListener("click", () => this.close());
  }
}
