import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { RealRecoveryHarness } from "../browser/recovery-plugin-harness";

// The REAL EntVaultCommandCenterPlugin (src/main.ts, bundled as-is through the browser
// "obsidian" alias) over an in-memory vault, adapter and data.json. The Sync & recovery center,
// "Review kept copies…", discovery, parser, restoreKeptCopy and openRestoredKeptBase are all
// production code; only the host (files, disk, Obsidian UI classes) is synthetic. No native
// Obsidian, device, VoiceOver or two-device Sync pass is implied.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let bundle: string;
let productStyles: string;
let hostStyles: string;
const LONG_NAME = "A very long recovered knowledge base name that must wrap or truncate without scrolling sideways on a phone";

test.beforeAll(async () => {
  const [built, styles, host] = await Promise.all([
    build({
      entryPoints: [path.join(root, "tests/browser/recovery-plugin-harness.ts")],
      bundle: true, write: false, format: "iife", platform: "browser", target: "es2022",
      alias: { obsidian: path.join(root, "tests/browser/obsidian-browser.ts") },
    }),
    readFile(path.join(root, "styles.css"), "utf8"),
    readFile(path.join(root, "tests/browser/host.css"), "utf8"),
  ]);
  bundle = built.outputFiles[0]?.text ?? "";
  expect(bundle).toContain("restoreKeptCopy");
  productStyles = styles;
  hostStyles = host;
});

const errorsByPage = new WeakMap<Page, string[]>();

async function openHarness(page: Page, options: { mobile?: boolean; width: number; height: number }): Promise<void> {
  const errors: string[] = [];
  errorsByPage.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: options.width, height: options.height });
  await page.goto(`about:blank#mobile=${Boolean(options.mobile)}`);
  await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>KBCC real recovery · synthetic vault</title></head><body class="theme-light${options.mobile ? " is-mobile" : ""}"></body></html>`);
  await page.addStyleTag({ content: hostStyles });
  await page.addStyleTag({ content: productStyles });
  await page.addScriptTag({ content: bundle });
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { kbccRealRecoveryHarness?: RealRecoveryHarness }).kbccRealRecoveryHarness?.ready))).toBe(true);
}

const harness = (page: Page) => page.evaluate(() => (window as unknown as { kbccRealRecoveryHarness: RealRecoveryHarness }).kbccRealRecoveryHarness.state());

async function openCenter(page: Page): Promise<Locator> {
  await page.evaluate(() => (window as unknown as { kbccRealRecoveryHarness: RealRecoveryHarness }).kbccRealRecoveryHarness.openCenter());
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Sync & recovery center", exact: true })).toBeVisible();
  return dialog;
}

async function tabTo(page: Page, target: Locator, limit = 90): Promise<void> {
  for (let presses = 0; presses < limit; presses += 1) {
    if (await target.evaluate((element) => element === element.ownerDocument.activeElement)) return;
    // WebKit's Tab skips buttons unless Alt is held (the production-view convention).
    await page.keyboard.press(test.info().project.name === "webkit" ? "Alt+Tab" : "Tab");
  }
  throw new Error("The control was not reachable with Tab.");
}

async function press(page: Page, target: Locator, touch: boolean): Promise<void> {
  if (touch) { await target.tap(); return; }
  await tabTo(page, target);
  await page.keyboard.press("Enter");
}

async function toConfirm(page: Page, touch: boolean, name = "Recovered copy"): Promise<Locator> {
  const dialog = await openCenter(page);
  await press(page, dialog.getByRole("button", { name: "Review kept copies…", exact: true }), touch);
  await expect(dialog.getByRole("heading", { name: "Kept copies", exact: true })).toBeVisible();
  await expect(dialog.getByRole("status")).toContainText("candidate files");
  await press(page, dialog.getByRole("button", { name: /^Review knowledge-base-command-center-conflict-/u }), touch);
  await expect(dialog.getByRole("heading", { name: "Review this copy", exact: true })).toBeVisible();
  await press(page, dialog.getByRole("button", { name: `Restore ${LONG_NAME}`, exact: true }), touch);
  await dialog.getByRole("textbox", { name: "Name for the restored base", exact: true }).fill(name);
  await press(page, dialog.getByRole("button", { name: "Continue", exact: true }), touch);
  await expect(dialog.getByRole("heading", { name: "Restore as a new base", exact: true })).toBeVisible();
  return dialog;
}

const sizes = [
  { name: "desktop", width: 1280, height: 900, mobile: false, touch: false },
  { name: "phone", width: 390, height: 844, mobile: true, touch: true },
  { name: "tablet", width: 820, height: 1180, mobile: true, touch: true },
] as const;

for (const size of sizes) {
  test.describe(`real plugin ${size.name}`, () => {
    test.use({ hasTouch: size.touch });

    test(`${size.name}: center → Review kept copies → select → preview → restore → separate open (${size.touch ? "tap" : "keyboard"})`, async ({ page }) => {
      await openHarness(page, size);
      const before = await harness(page);
      expect(before.diskBeforeRestore).toBe(true);
      expect(before.diskWrites).toBe(0);
      const dialog = await toConfirm(page, size.touch);
      if (size.touch) {
        const overflow = await dialog.evaluate((modal) => modal.scrollWidth - modal.clientWidth);
        expect(overflow, "no horizontal overflow with a long base name").toBeLessThanOrEqual(1);
      }
      // Reviewing changed nothing: the disk store, the active base and the source bytes are as they were.
      let state = await harness(page);
      expect(state.diskBeforeRestore).toBe(true);
      expect(state.diskWrites).toBe(0);
      expect(state.sourcesUnchanged).toBe(true);
      expect(state.baseNames).toEqual(["Research workspace"]);

      await press(page, dialog.getByRole("button", { name: "Restore as new base", exact: true }), size.touch);
      await expect(dialog.getByRole("button", { name: "Open restored base", exact: true })).toBeVisible();
      await expect(dialog.getByRole("status")).toContainText("Restored as “Recovered copy”.");
      state = await harness(page);
      expect(state.baseNames).toEqual(["Research workspace", "Recovered copy"]);
      expect(state.diskBaseNames, "the new base was persisted to the primary store").toEqual(["Research workspace", "Recovered copy"]);
      expect(state.diskWrites).toBeGreaterThan(0);
      expect(state.activeBaseId, "the original base stays active until Open is requested").toBe(before.activeBaseId);
      expect(state.diskActiveBaseId).toBe(before.activeBaseId);
      expect(state.sourcesUnchanged, "the kept copy bytes are untouched").toBe(true);
      expect(state.notices.join("\n")).toContain("Restored “Recovered copy” as a new knowledge base. Your active base did not change.");
      await expect(dialog).not.toContainText("Private Exports");

      await press(page, dialog.getByRole("button", { name: "Open restored base", exact: true }), size.touch);
      await expect.poll(async () => (await harness(page)).activeBaseId).toBe(state.restoredIds[0]);
      expect(errorsByPage.get(page)).toEqual([]);
    });

    test(`${size.name}: cancel writes nothing`, async ({ page }) => {
      await openHarness(page, size);
      const dialog = await toConfirm(page, size.touch);
      await press(page, dialog.getByRole("button", { name: "Cancel", exact: true }), size.touch);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const state = await harness(page);
      expect(state.diskWrites).toBe(0);
      expect(state.diskBeforeRestore).toBe(true);
      expect(state.baseNames).toEqual(["Research workspace"]);
      expect(state.sourcesUnchanged).toBe(true);
    });

    test(`${size.name}: read-only refuses, before and after the preview`, async ({ page }) => {
      await openHarness(page, size);
      // Becomes read-only after the preview: the real hook refuses and writes nothing.
      const dialog = await toConfirm(page, size.touch);
      await page.evaluate(() => (window as unknown as { kbccRealRecoveryHarness: RealRecoveryHarness }).kbccRealRecoveryHarness.forceReadOnly());
      const apply = dialog.getByRole("button", { name: "Restore as new base", exact: true });
      if (await apply.isEnabled()) await press(page, apply, size.touch);
      let state = await harness(page);
      expect(state.readOnly).toBe(true);
      expect(state.diskWrites).toBe(0);
      expect(state.diskBeforeRestore).toBe(true);
      expect(state.baseNames).toEqual(["Research workspace"]);
      await expect(dialog.getByRole("button", { name: "Open restored base", exact: true })).toHaveCount(0);
      // A window opened while read-only can review, but Apply is disabled.
      await press(page, dialog.getByRole("button", { name: "Cancel", exact: true }), size.touch);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const reopened = await toConfirm(page, size.touch, "Second try");
      await expect(reopened).toContainText("Read-only: restoring is unavailable");
      await expect(reopened.getByRole("button", { name: "Restore as new base", exact: true })).toBeDisabled();
      state = await harness(page);
      expect(state.diskWrites).toBe(0);
    });
  });
}
