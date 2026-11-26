import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";
import type { NoteOpeningHarness } from "../browser/note-opening-harness";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let bundle: string;
let styles: string;
test.use({ hasTouch: true });
test.beforeAll(async () => {
  const [built, host, product] = await Promise.all([
    build({ entryPoints: [path.join(root, "tests/browser/note-opening-harness.ts")], bundle: true, write: false,
      format: "iife", platform: "browser", target: "es2022", alias: { obsidian: path.join(root, "tests/browser/obsidian-browser.ts") } }),
    readFile(path.join(root, "tests/browser/host.css"), "utf8"),
    readFile(path.join(root, "styles.css"), "utf8"),
  ]);
  bundle = built.outputFiles[0]?.text ?? "";
  styles = `${host}\n${product}\n[hidden] { display: none !important; }`;
});

async function openScene(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto("about:blank#mobile=true&count=8");
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body class="theme-light is-mobile"><main id="kbcc-view" class="view-content"></main></body></html>');
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({ content: bundle });
  await page.waitForFunction(() => (window as unknown as { kbccNoteOpening: NoteOpeningHarness }).kbccNoteOpening.ready);
  await expect(page.locator(".ent-cc-shell")).toBeVisible();
  const search = page.locator('.ent-cc-search-box input[type="search"]');
  await search.fill("Research note 003");
  const row = page.locator(".ent-cc-subject-title").filter({ hasText: "Research note 003" }).first();
  await expect(row).toBeVisible();
  await row.tap();
  await expect(page.getByRole("button", { name: "Open note", exact: true })).toBeVisible();
}

const state = (page: Page) => page.evaluate(() => (window as unknown as { kbccNoteOpening: NoteOpeningHarness }).kbccNoteOpening.state());

// Representative CSS viewport sizes; no claim of exact hardware dimensions.
for (const [label, width, height] of [["narrow", 390, 844], ["wide mobile", 890, 626], ["tablet", 1024, 768]] as const) {
  test(`${label}: tapping Open note reveals the note despite background-tab preference`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await openScene(page, width, height);
    await page.getByRole("button", { name: "Open note", exact: true }).tap();
    await expect(page.getByRole("region", { name: "Synthetic note tab" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Research note 003", exact: true })).toBeVisible();
    const opened = await state(page);
    expect(opened.activePath).toBe("Research/Research note 003.md");
    expect(opened.openCount).toBe(1);
    expect(opened.leafRequests).toEqual(["tab"]);
    expect(opened.writes).toBe(0);
    expect(opened.route).toMatchObject({ routes: [{ notePath: "Research/Research note 003.md", view: { query: "Research note 003", selectedPath: "Research/Research note 003.md", detailVisible: true } }] });
    await page.getByRole("button", { name: "Return to command center" }).tap();
    await expect(page.getByRole("button", { name: "Open note", exact: true })).toBeVisible();
    expect((await state(page)).selectedPath).toBe("Research/Research note 003.md");
    expect(errors).toEqual([]);
  });
}

test("resize while inspecting preserves selection and a working Open note action", async ({ page }) => {
  await openScene(page, 390, 844);
  for (const size of [{ width: 890, height: 626 }, { width: 626, height: 890 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await expect(page.getByRole("button", { name: "Open note", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await page.getByRole("button", { name: "Open note", exact: true }).tap();
  await expect(page.getByRole("heading", { name: "Research note 003", exact: true })).toBeVisible();
});

test("a failed open keeps the subject usable and a subsequent tap succeeds", async ({ page }) => {
  await openScene(page, 390, 844);
  await page.evaluate(() => (window as unknown as { kbccNoteOpening: NoteOpeningHarness }).kbccNoteOpening.failNextOpen(true));
  await page.getByRole("button", { name: "Open note", exact: true }).tap();
  await expect(page.getByRole("button", { name: "Open note", exact: true })).toBeVisible();
  expect((await state(page)).activePath).toBeNull();
  await page.evaluate(() => (window as unknown as { kbccNoteOpening: NoteOpeningHarness }).kbccNoteOpening.failNextOpen(false));
  await page.getByRole("button", { name: "Open note", exact: true }).tap();
  await expect(page.getByRole("heading", { name: "Research note 003", exact: true })).toBeVisible();
  expect((await state(page)).openCount).toBe(1);
});
