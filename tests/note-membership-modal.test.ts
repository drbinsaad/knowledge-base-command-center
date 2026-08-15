import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NoteMembershipModal } from "../src/note-membership-modal";
import type { NoteOrganizerMembershipSummary } from "../src/note-organizer-surfaces";
import { asHtmlElement, createFakeDom } from "./support/fake-dom";

function summary(): NoteOrganizerMembershipSummary {
  return {
    path: "Notes/Airway.md",
    currentBaseId: "base-current",
    currentBaseOrganized: true,
    currentBaseHasPrimary: true,
    currentBaseCollectionOnly: false,
    otherBaseCount: 1,
    totalBaseCount: 2,
    collectionOnlyBaseCount: 1,
    brokenBaseCount: 0,
    currentBase: null,
    bases: [
      {
        baseId: "base-current", baseName: "ENT", current: true,
        primary: { kind: "index", label: "Knowledge Index" },
        collectionTitles: ["Exam review"], collectionOnly: false, organized: true,
        provenance: ["direct"], linkedSourcePaths: [], portableSubjectIds: [], hidden: false,
        hasReference: true, issues: [], broken: false,
      },
      {
        baseId: "base-other", baseName: "Research", current: false,
        primary: { kind: "none" }, collectionTitles: ["Read later"], collectionOnly: true,
        organized: true, provenance: [], linkedSourcePaths: [], portableSubjectIds: [], hidden: false,
        hasReference: true, issues: [], broken: false,
      },
    ],
    indicator: {
      id: "kbcc-note-membership", state: "organized-current", icon: "circle-check", color: "success",
      label: "KBCC: Organized in ENT", tooltip: "Organized in two knowledge bases.",
      ariaLabel: "Organized in two knowledge bases. Activate to review or change memberships.",
      classNames: ["ent-cc-note-membership-indicator", "ent-cc-note-membership-organized-current"],
      preferredSurfaces: ["editor-header", "status-bar"], interactive: true,
    },
  };
}

test("membership detail separates current primary placement and collection-only bases", () => {
  const dom = createFakeDom();
  const root = dom.document.body.createDiv();
  const title = root.createEl("h2");
  const content = root.createDiv();
  let organized: readonly string[] = [];
  const modal = new NoteMembershipModal({
    app: {} as never,
    getNoteOrganizerMembershipSummary: () => summary(),
    noteOrganizerRestrictionReason: () => null,
    openNoteOrganizer: (paths) => { organized = paths; },
  }, "Notes/Airway.md");
  Object.assign(modal, {
    modalEl: asHtmlElement(root),
    titleEl: asHtmlElement(title),
    contentEl: asHtmlElement(content),
  });
  modal.onOpen();

  const titleId = title.getAttribute("id");
  assert.ok(titleId);
  assert.equal(root.getAttribute("role"), "dialog");
  assert.equal(root.getAttribute("aria-modal"), "true");
  assert.equal(root.getAttribute("aria-labelledby"), titleId);
  const describedBy = root.getAttribute("aria-describedby")?.split(/\s+/u) ?? [];
  assert.equal(describedBy.length, 2);
  for (const id of describedBy) assert.ok(content.querySelector(`[id="${id}"]`));

  assert.match(content.textContent, /ENT/u);
  assert.match(content.textContent, /Knowledge Index/u);
  assert.match(content.textContent, /Exam review/u);
  assert.match(content.textContent, /Research/u);
  assert.match(content.textContent, /Collections only/u);
  assert.match(content.textContent, /Markdown file and its folder stay unchanged/u);
  assert.equal(content.querySelector(".ent-cc-note-membership-summary-icon")?.getAttribute("aria-hidden"), "true");
  assert.equal(content.querySelector(".ent-cc-note-membership-summary-text strong")?.getAttribute("dir"), "auto");
  const list = content.querySelector(".ent-cc-note-membership-base-list");
  assert.equal(list?.getAttribute("tabindex"), "0", "the bounded membership list is keyboard-scrollable");
  list?.focus();
  assert.equal(dom.document.activeElement, list);
  const organize = content.querySelector(".mod-cta");
  assert.ok(organize);
  (organize as unknown as { click(): void }).click();
  assert.deepEqual(organized, ["Notes/Airway.md"]);
});

test("membership detail disables Organizer for protected notes and explains why", () => {
  const dom = createFakeDom();
  const root = dom.document.body.createDiv();
  const title = root.createEl("h2");
  const content = root.createDiv();
  let organizerOpened = false;
  const reason = "This note is in a protected source or Obsidian configuration area and cannot be organized by KBCC.";
  const modal = new NoteMembershipModal({
    app: {} as never,
    getNoteOrganizerMembershipSummary: () => ({ ...summary(), path: ".obsidian/Private.md" }),
    noteOrganizerRestrictionReason: () => reason,
    openNoteOrganizer: () => { organizerOpened = true; },
  }, ".obsidian/Private.md");
  Object.assign(modal, {
    modalEl: asHtmlElement(root),
    titleEl: asHtmlElement(title),
    contentEl: asHtmlElement(content),
  });
  modal.onOpen();

  const organize = content.querySelector(".mod-cta") as unknown as {
    disabled: boolean;
    getAttribute(name: string): string | null;
    click(): void;
  } | null;
  assert.ok(organize);
  assert.equal(organize.disabled, true);
  assert.match(organize.getAttribute("aria-describedby") ?? "", /restriction/u);
  assert.equal(organize.getAttribute("title"), reason);
  assert.match(content.textContent, /protected source or Obsidian configuration area/iu);
  organize.click();
  assert.equal(organizerOpened, false, "the disabled surface has no defensive click action in reduced DOM hosts");
});

test("membership detail CSS keeps controls touch-sized and large-text/mobile layouts bounded", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(css, /\.ent-cc-note-membership-detail\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?flex-direction:\s*column;/u);
  assert.match(css, /\.ent-cc-note-membership-base-list:focus-visible\s*\{[\s\S]*?outline:\s*2px solid/u);
  assert.match(css, /\.ent-cc-note-membership-base-heading\s*\{[\s\S]*?flex-wrap:\s*wrap;/u);
  assert.match(css, /\.ent-cc-note-membership-actions \.ent-cc-button\s*\{[\s\S]*?min-height:\s*44px;/u);
  assert.match(css, /@media \(max-width: 760px\), \(pointer: coarse\)[\s\S]*?\.ent-cc-note-membership-actions \.ent-cc-button\s*\{[\s\S]*?width:\s*100%;/u);
});
