import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { RecoveryBrowserHarness } from "../browser/recovery-harness";

// Component and layout journey through the production Sync & recovery center and the
// production review window, over an in-memory vault. Its Apply is a recording stand-in; the
// real plugin entry and restore path are proven in recovery-real.spec.ts. No native Obsidian,
// device or two-device Sync pass is implied here.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let bundle: string;
let productStyles: string;
let hostStyles: string;
const LONG_NAME = "A very long recovered knowledge base name that must wrap or truncate without scrolling sideways on a phone";

test.beforeAll(async () => {
  const [built, styles, host] = await Promise.all([
    build({
      entryPoints: [path.join(root, "tests/browser/recovery-harness.ts")],
      bundle: true, write: false, format: "iife", platform: "browser", target: "es2022",
      alias: { obsidian: path.join(root, "tests/browser/obsidian-browser.ts") },
    }),
    readFile(path.join(root, "styles.css"), "utf8"),
    readFile(path.join(root, "tests/browser/host.css"), "utf8"),
  ]);
  bundle = built.outputFiles[0]?.text ?? "";
  expect(bundle).toContain("RecoveryCopyModal");
  productStyles = styles;
  hostStyles = host;
});

const errorsByPage = new WeakMap<Page, string[]>();

async function openHarness(page: Page, options: { mobile?: boolean; width: number; height: number; readonly?: boolean }): Promise<void> {
  const errors: string[] = [];
  errorsByPage.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" || message.type() === "warning") errors.push(message.text()); });
  await page.setViewportSize({ width: options.width, height: options.height });
  await page.goto(`about:blank#mobile=${Boolean(options.mobile)}&readonly=${Boolean(options.readonly)}`);
  await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>KBCC recovery review · synthetic vault</title></head><body class="theme-light${options.mobile ? " is-mobile" : ""}"></body></html>`);
  await page.addStyleTag({ content: hostStyles });
  await page.addStyleTag({ content: productStyles });
  await page.addScriptTag({ content: bundle });
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { kbccRecoveryHarness?: RecoveryBrowserHarness }).kbccRecoveryHarness?.ready))).toBe(true);
}

const harnessState = (page: Page) =>
  page.evaluate(() => (window as unknown as { kbccRecoveryHarness: RecoveryBrowserHarness }).kbccRecoveryHarness.state());

async function openCenter(page: Page): Promise<Locator> {
  await page.evaluate(() => (window as unknown as { kbccRecoveryHarness: RecoveryBrowserHarness }).kbccRecoveryHarness.openCenter());
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Sync & recovery center", exact: true })).toBeVisible();
  return dialog;
}

/** Real Tab presses until the target has focus. */
async function tabTo(page: Page, target: Locator, limit = 90): Promise<void> {
  for (let presses = 0; presses < limit; presses += 1) {
    if (await target.evaluate((element) => element === element.ownerDocument.activeElement)) return;
    // WebKit's Tab skips buttons unless Alt is held (the same convention as the production-view suite).
    await page.keyboard.press(test.info().project.name === "webkit" ? "Alt+Tab" : "Tab");
  }
  throw new Error("The control was not reachable with Tab.");
}

async function activate(page: Page, target: Locator): Promise<void> {
  await tabTo(page, target);
  await page.keyboard.press("Enter");
}

async function expectNoPrivatePaths(dialog: Locator): Promise<void> {
  const text = (await dialog.textContent()) ?? "";
  expect(text).not.toMatch(/Private Exports|\.obsidian|synthetic-plugin|\/Users\//);
}

async function toPreview(page: Page, name: RegExp): Promise<Locator> {
  const dialog = await openCenter(page);
  await activate(page, dialog.getByRole("button", { name: "Review kept copies…", exact: true }));
  await expect(dialog.getByRole("heading", { name: "Kept copies", exact: true })).toBeFocused();
  await expect(dialog.getByRole("status")).toContainText("candidate files");
  await activate(page, dialog.getByRole("button", { name }));
  await expect(dialog.getByRole("heading", { name: "Review this copy", exact: true })).toBeFocused();
  return dialog;
}

for (const [engine, size] of [["desktop", { width: 1280, height: 900, mobile: false }]] as const) {
  test(`keyboard journey ${engine}: Sync and recovery center → discover → preview → name → restore → open`, async ({ page }) => {
    await openHarness(page, size);
    const dialog = await toPreview(page, /^Review knowledge-base-command-center-conflict-/u);
    // Every design field is on the preview, and the private-content disclosure.
    const facts = dialog.locator("dl.ent-cc-sync-recovery-facts");
    await expect(facts).toContainText("Sync conflict rescue");
    await expect(facts).toContainText("This vault");
    await expect(facts).toContainText("Supported");
    await expect(dialog).toContainText(LONG_NAME);
    await expect(dialog).toContainText("Generic");
    await expect(dialog).toContainText("2 pinned");
    await expect(dialog).toContainText("exact vault-relative paths");
    await expect(dialog).toContainText("Clear device-local data does not remove these copies");
    await expectNoPrivatePaths(dialog);

    await activate(page, dialog.getByRole("button", { name: `Restore ${LONG_NAME}`, exact: true }));
    const input = dialog.getByRole("textbox", { name: "Name for the restored base", exact: true });
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(/\(restored\)$/u);
    await input.fill("Research workspace"); // collides with an existing base
    await expect(dialog.locator("#ent-cc-recovery-name-problem")).toContainText("already exists");
    await expect(dialog.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
    await input.fill("Recovered copy");
    await expect(dialog.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
    await activate(page, dialog.getByRole("button", { name: "Continue", exact: true }));
    await expect(dialog.getByRole("heading", { name: "Restore as a new base", exact: true })).toBeFocused();
    await expect(dialog.locator("dl.ent-cc-sync-recovery-facts")).toContainText("Recovered copy");
    expect((await harnessState(page)).applyCalls).toBe(0);

    await activate(page, dialog.getByRole("button", { name: "Restore as new base", exact: true }));
    await expect(dialog.getByRole("heading", { name: "Base restored", exact: true })).toBeFocused();
    await expect(dialog.getByRole("status")).toContainText("Restored as “Recovered copy”.");
    await expect(dialog.getByRole("alert")).toHaveText("");
    let state = await harnessState(page);
    expect(state.restored).toEqual([{ id: "base-restored-1", name: "Recovered copy", preset: "generic" }]);
    expect(state.opened, "restoring never opens the base").toEqual([]);
    expect(state.activeId).toBe("base-default");
    await expectNoPrivatePaths(dialog);

    await activate(page, dialog.getByRole("button", { name: "Open restored base", exact: true }));
    state = await harnessState(page);
    expect(state.opened).toEqual(["base-restored-1"]);
    expect(state.activeId).toBe("base-restored-1");
    expect(errorsByPage.get(page)).toEqual([]);
  });

  test(`damaged and read-only paths ${engine}`, async ({ page }) => {
    await openHarness(page, size);
    const dialog = await openCenter(page);
    await activate(page, dialog.getByRole("button", { name: "Review kept copies…", exact: true }));
    // The newest-first list ends with the damaged kept file.
    const buttons = dialog.getByRole("button", { name: /^Review data\.json\.bak-kept-2026-10-01/u });
    await activate(page, buttons);
    await expect(dialog.getByText("Preserved, not restorable", { exact: true }).first()).toBeVisible();
    await expect(dialog.getByRole("button", { name: /^Restore/u })).toHaveCount(0);
    await expect(dialog.getByRole("status")).toHaveText("Preserved, not restorable.");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await harnessState(page)).applyCalls).toBe(0);
  });

  test(`read-only viewing ${engine}: the entry is available and Apply is disabled`, async ({ page }) => {
    await openHarness(page, { ...size, readonly: true });
    const dialog = await toPreview(page, /^Review knowledge-base-command-center-conflict-/u);
    await activate(page, dialog.getByRole("button", { name: `Restore ${LONG_NAME}`, exact: true }));
    await activate(page, dialog.getByRole("button", { name: "Continue", exact: true }));
    await expect(dialog).toContainText("Read-only: restoring is unavailable");
    await expect(dialog.getByRole("button", { name: "Restore as new base", exact: true })).toBeDisabled();
    expect((await harnessState(page)).applyCalls).toBe(0);
  });
}

const layouts = [
  { name: "phone", width: 390, height: 844, mobile: true, touch: true },
  { name: "tablet", width: 820, height: 1180, mobile: true, touch: true },
] as const;

for (const layout of layouts) {
  test.describe(`${layout.name} layout`, () => {
    test.use({ hasTouch: layout.touch });

    test(`${layout.name}: facts stack, the long name never scrolls sideways, targets are tappable`, async ({ page }) => {
      await openHarness(page, layout);
      const dialog = await toPreview(page, /^Review knowledge-base-command-center-conflict-/u);
      const geometry = await dialog.evaluate((modal) => {
        const scroller = modal.querySelector<HTMLElement>(".ent-cc-sync-recovery-scroll");
        const rows = [...modal.querySelectorAll<HTMLElement>(".ent-cc-sync-recovery-fact")].map((row) => {
          const dt = row.querySelector("dt")!.getBoundingClientRect();
          const dd = row.querySelector("dd")!.getBoundingClientRect();
          return { stacked: dd.top >= dt.bottom - 1, beside: dt.right <= dd.left + 1 };
        });
        const buttons = [...modal.querySelectorAll<HTMLElement>("button")].map((button) => {
          const box = button.getBoundingClientRect();
          return { text: button.textContent, height: box.height, right: box.right };
        });
        const rootBox = modal.getBoundingClientRect();
        return {
          modalOverflow: modal.scrollWidth - modal.clientWidth,
          scrollOverflow: scroller ? scroller.scrollWidth - scroller.clientWidth : 0,
          rows, buttons, viewport: window.innerWidth, modalRight: rootBox.right,
        };
      });
      expect(geometry.modalOverflow, "no horizontal overflow in the dialog").toBeLessThanOrEqual(1);
      expect(geometry.scrollOverflow, "no horizontal overflow in the preview, even with a long base name").toBeLessThanOrEqual(1);
      expect(geometry.modalRight).toBeLessThanOrEqual(geometry.viewport + 1);
      expect(geometry.rows.length).toBeGreaterThanOrEqual(4);
      for (const row of geometry.rows) expect(row.stacked || row.beside, "label and value never run together").toBe(true);
      if (layout.width < 600) for (const row of geometry.rows) expect(row.stacked, "stacked on a phone").toBe(true);
      for (const button of geometry.buttons) {
        expect(button.height, `${button.text ?? "button"} is tappable`).toBeGreaterThanOrEqual(30);
        expect(button.right).toBeLessThanOrEqual(geometry.viewport + 1);
      }
      // The full name stays available even if the row truncates it.
      await expect(dialog.getByRole("button", { name: `Restore ${LONG_NAME}`, exact: true })).toBeVisible();
      await expect(dialog.locator(".ent-cc-base-manager-title span").first()).toHaveAttribute("title", LONG_NAME);

      await dialog.getByRole("button", { name: `Restore ${LONG_NAME}`, exact: true }).tap();
      await dialog.getByRole("textbox", { name: "Name for the restored base", exact: true }).fill("Recovered copy");
      await dialog.getByRole("button", { name: "Continue", exact: true }).tap();
      const confirm = await dialog.evaluate((modal) => ({
        overflow: modal.scrollWidth - modal.clientWidth,
        rows: [...modal.querySelectorAll<HTMLElement>(".ent-cc-sync-recovery-fact")].length,
      }));
      expect(confirm.overflow).toBeLessThanOrEqual(1);
      expect(confirm.rows).toBeGreaterThanOrEqual(3);
      await dialog.getByRole("button", { name: "Restore as new base", exact: true }).tap();
      await expect(dialog.getByRole("button", { name: "Open restored base", exact: true })).toBeVisible();
      await dialog.getByRole("button", { name: "Open restored base", exact: true }).tap();
      expect((await harnessState(page)).opened).toEqual(["base-restored-1"]);
      expect(errorsByPage.get(page)).toEqual([]);
    });
  });
}
