import { BasesView, QueryController, setIcon } from "obsidian";

export class EntHierarchyBasesView extends BasesView {
  type = "ent-hierarchy";

  constructor(controller: QueryController, private readonly containerEl: HTMLElement) {
    super(controller);
  }

  onDataUpdated(): void {
    this.containerEl.empty();
    this.containerEl.addClass("ent-cc-bases-view");
    const records = this.data.data.map((entry) => {
      const frontmatter = this.app.metadataCache.getFileCache(entry.file)?.frontmatter ?? {};
      const folder = entry.file.parent?.name.replace(/^\d+\s+/, "") || "Unassigned";
      return {
        file: entry.file,
        title: typeof frontmatter.title === "string" ? frontmatter.title : entry.file.basename,
        domain: typeof frontmatter.domain === "string" ? frontmatter.domain : folder,
        id: typeof frontmatter.curriculum_id === "string" ? frontmatter.curriculum_id : "",
        priority: typeof frontmatter.priority === "string" ? frontmatter.priority : "",
      };
    });

    const groups = new Map<string, typeof records>();
    for (const record of records) groups.set(record.domain, [...(groups.get(record.domain) ?? []), record]);

    for (const [domain, grouped] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const section = this.containerEl.createDiv({ cls: "ent-cc-base-group" });
      const heading = section.createDiv({ cls: "ent-cc-base-heading" });
      setIcon(heading.createSpan(), "folder-tree");
      heading.createSpan({ text: domain });
      heading.createSpan({ text: String(grouped.length), cls: "ent-cc-base-count" });
      for (const record of grouped.sort((a, b) => (a.id || "ZZZ").localeCompare(b.id || "ZZZ", undefined, { numeric: true }) || a.title.localeCompare(b.title))) {
        const row = section.createEl("button", { cls: "ent-cc-base-record" });
        row.createSpan({ text: record.title, cls: "ent-cc-base-record-title" });
        row.createSpan({ text: record.id, cls: "ent-cc-base-record-id" });
        if (record.priority) row.createSpan({ text: record.priority, cls: "ent-cc-priority" });
        row.addEventListener("click", () => void this.app.workspace.getLeaf("tab").openFile(record.file));
      }
    }
  }
}
