import { Modal, setIcon, type App } from "obsidian";
import type { UpdateAnnouncement } from "./update-announcement";

let nextDescriptionId = 1;

export class UpdateAnnouncementModal extends Modal {
  private readonly descriptionId = `ent-cc-whats-new-intro-${nextDescriptionId++}`;
  private readonly highlightsId = `${this.descriptionId}-highlights`;

  constructor(
    app: App,
    private readonly announcement: UpdateAnnouncement,
    private readonly onClosed: () => void = () => undefined,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("ent-cc-whats-new-modal");
    this.contentEl.addClass("ent-cc-modal", "ent-cc-whats-new");
    this.titleEl.setText(this.announcement.title);
    this.modalEl.setAttribute("aria-describedby", this.descriptionId);

    const body = this.contentEl.createDiv({
      cls: "ent-cc-whats-new-body",
      attr: { role: "region", "aria-label": `Version ${this.announcement.version} highlights`, tabindex: "0" },
    });
    const badge = body.createDiv({ cls: "ent-cc-whats-new-badge" });
    const badgeIcon = badge.createSpan({ attr: { "aria-hidden": "true" } });
    setIcon(badgeIcon, "sparkles");
    badge.createSpan({ text: `Updated to ${this.announcement.version}` });
    body.createEl("p", {
      cls: "ent-cc-whats-new-intro",
      text: this.announcement.intro,
      attr: { id: this.descriptionId },
    });

    const heading = body.createEl("h3", { text: "Highlights" });
    const highlights = body.createEl("ul", { attr: { "aria-labelledby": this.highlightsId } });
    heading.setAttribute("id", this.highlightsId);
    for (const highlight of this.announcement.highlights) highlights.createEl("li", { text: highlight });

    const actions = this.contentEl.createDiv({ cls: "ent-cc-whats-new-actions" });
    const releaseLink = actions.createEl("a", {
      cls: "ent-cc-button ent-cc-whats-new-release-link",
      attr: {
        href: this.announcement.releaseUrl,
        target: "_blank",
        rel: "noopener noreferrer",
        "aria-label": `Read the complete ${this.announcement.version} release notes on GitHub (opens in your browser)`,
      },
    });
    setIcon(releaseLink.createSpan({ attr: { "aria-hidden": "true" } }), "external-link");
    releaseLink.createSpan({ text: "Read complete release notes" });
    const close = actions.createEl("button", { cls: "ent-cc-button mod-cta", type: "button", text: "Continue" });
    close.addEventListener("click", () => this.close());
    // Obsidian owns initial modal focus and focus restoration. In particular,
    // do not jump VoiceOver past the title/context or summon the iOS keyboard.
  }

  onClose(): void {
    this.contentEl.empty();
    this.onClosed();
  }
}
