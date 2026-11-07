import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { RealSetupHarness } from "../browser/setup-plugin-harness";

// WF-01: the REAL plugin's setup transaction and the real openSetupWizard route
// (src/main.ts and src/view.ts bundled as-is through the browser "obsidian" alias)
// over an in-memory vault and data.json. Only the host is synthetic. Touch taps
// are browser emulation, not iPhone or iPad hardware; no native-host claim.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let bundle: string;
let productStyles: string;
let hostStyles: string;

test.beforeAll(async () => {
  const [built, styles, host] = await Promise.all([
    build({
      entryPoints: [path.join(root, "tests/browser/setup-plugin-harness.ts")],
      bundle: true, write: false, format: "iife", platform: "browser", target: "es2022",
      alias: { obsidian: path.join(root, "tests/browser/obsidian-browser.ts") },
    }),
    readFile(path.join(root, "styles.css"), "utf8"),
    readFile(path.join(root, "tests/browser/host.css"), "utf8"),
  ]);
  bundle = built.outputFiles[0]?.text ?? "";
  expect(bundle).toContain("openSetupWizard");
  productStyles = styles;
  hostStyles = host;
});

const harness = (page: Page) => ({
  state: () => page.evaluate(() => (window as unknown as { kbccRealSetupHarness: RealSetupHarness }).kbccRealSetupHarness.state()),
  open: () => page.evaluate(() => (window as unknown as { kbccRealSetupHarness: RealSetupHarness }).kbccRealSetupHarness.open()),
  undo: () => page.evaluate(() => (window as unknown as { kbccRealSetupHarness: RealSetupHarness }).kbccRealSetupHarness.undo()),
  redo: () => page.evaluate(() => (window as unknown as { kbccRealSetupHarness: RealSetupHarness }).kbccRealSetupHarness.redo()),
});

for (const size of [
  { name: "desktop", width: 1280, height: 900, touch: false },
  { name: "phone", width: 390, height: 844, touch: true },
  { name: "tablet", width: 820, height: 1180, touch: true },
]) {
  test.describe(`WF01 real setup transaction ${size.name}`, () => {
    test.use({ hasTouch: size.touch });

    test("review, Cancel/Close/Escape keep the draft, confirm saves once to disk, Undo and Redo restore exact settings", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(`about:blank#mobile=${size.touch}`);
      await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>KBCC real setup · synthetic vault</title></head><body class="theme-light${size.touch ? " is-mobile" : ""}"></body></html>`);
      await page.addStyleTag({ content: hostStyles });
      await page.addStyleTag({ content: productStyles });
      await page.addScriptTag({ content: bundle });
      await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { kbccRealSetupHarness?: RealSetupHarness }).kbccRealSetupHarness?.ready))).toBe(true);
      const host = harness(page);
      const before = await host.state();
      await host.open();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      const row = (name: string): Locator => dialog.locator(".setting-item").filter({ has: page.locator(".setting-item-name", { hasText: new RegExp(`^${name}$`, "u") }) });
      const press = async (locator: Locator): Promise<void> => { if (size.touch) await locator.tap(); else await locator.click(); };
      const finish = dialog.getByRole("button", { name: "Finish setup", exact: true });
      const reviewHeading = dialog.getByRole("heading", { name: "Review the Inbox change", exact: true });

      await row("Name this knowledge base").locator("input").fill("Browser draft");
      await dialog.locator(".ent-cc-setup-advanced summary").click();
      await row("Inbox folder").locator("input").fill("New Inbox");
      await press(finish);
      await expect(reviewHeading).toBeVisible();
      await expect(dialog.locator("[data-role=inbox-impact]")).toContainText(/^2 Inbox-only notes/u);
      expect((await host.state()).writes).toBe(0);

      for (const dismissal of ["Cancel", "Close", "Escape"] as const) {
        if (dismissal === "Escape") {
          await dialog.getByRole("button", { name: "Back to edit", exact: true }).focus();
          await page.keyboard.press("Escape");
        } else {
          await press(dialog.getByRole("button", { name: dismissal, exact: true }));
        }
        await expect(dialog.getByRole("heading", { name: "Set up your knowledge base", exact: true })).toBeVisible();
        await expect(row("Name this knowledge base").locator("input")).toHaveValue("Browser draft");
        await expect(row("Inbox folder").locator("input")).toHaveValue("New Inbox");
        expect((await host.state()).writes).toBe(0);
        await press(finish);
        await expect(reviewHeading).toBeVisible();
      }

      await press(dialog.getByRole("button", { name: "Apply Inbox change and finish setup", exact: true }));
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const after = await host.state();
      expect(after.writes).toBe(1);
      expect(after.undo).toBe(before.undo + 1);
      expect(after.settings.workspaceName).toBe("Browser draft");
      expect(after.diskSettings?.workspaceName).toBe("Browser draft");
      expect(after.diskSettings?.proposalFolder).toBe("New Inbox");
      expect(after.paths).toEqual(before.paths);

      await host.undo();
      expect((await host.state()).settings).toEqual(before.settings);
      expect((await host.state()).diskSettings).toEqual(before.settings);
      await host.redo();
      expect((await host.state()).settings).toEqual(after.settings);
      expect((await host.state()).diskSettings).toEqual(after.settings);
      expect(errors).toEqual([]);
    });
  });
}
