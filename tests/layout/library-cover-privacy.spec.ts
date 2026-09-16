import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { expect, test as base, type Page } from "@playwright/test";
import type { LibraryCoverPrivacyHarness } from "../browser/library-cover-privacy-harness";

// This suite verifies the vault-only request boundary. No servers, certificates,
// OpenSSL, real external requests, or native Obsidian permission grants exist.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureUrl = "https://kbcc-fixture.invalid/library-cover-privacy";
const pageTitle = "KBCC vault-only covers · synthetic fixture";
let bundle: string;

interface PrivacyFixture {
  requests: string[];
  render: (value: string) => Promise<string>;
  seedLegacyPermission: () => Promise<void>;
  snapshot: () => Promise<ReturnType<LibraryCoverPrivacyHarness["snapshot"]>>;
}

async function capture(page: Page, name: string): Promise<void> {
  const directory = process.env.KBCC_BROWSER_SCREENSHOT_DIR;
  if (!directory) return;
  if (!path.isAbsolute(directory) || directory.startsWith(`${root}${path.sep}`)) throw new Error("Evidence must stay outside the repository");
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${test.info().project.name}-privacy-${name}.png`) });
}

const test = base.extend<{ privacy: PrivacyFixture }>({
  privacy: async ({ page }, use) => {
    const requests: string[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.route("**/*", async (route) => {
      if (route.request().url() === fixtureUrl && route.request().resourceType() === "document") {
        await route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><html><head><meta charset="utf-8"><title>${pageTitle}</title></head><body><h1>Synthetic vault-only covers</h1><main></main></body></html>` });
      } else {
        requests.push(route.request().url());
        await route.abort();
      }
    });
    await page.goto(fixtureUrl);
    await page.addScriptTag({ content: bundle });
    await expect(page).toHaveTitle(pageTitle);
    expect(page.url()).toBe(fixtureUrl);
    await expect(page.getByRole("heading", { name: "Synthetic vault-only covers" })).toBeVisible();
    await expect(page.locator("vite-error-overlay, #webpack-dev-server-client-overlay, nextjs-portal")).toHaveCount(0);
    try {
      await use({ requests,
        render: (value) => page.evaluate((value) =>
          (window as unknown as { libraryCoverPrivacy: LibraryCoverPrivacyHarness }).libraryCoverPrivacy.render(value), value),
        seedLegacyPermission: () => page.evaluate(() => (window as unknown as { libraryCoverPrivacy: LibraryCoverPrivacyHarness }).libraryCoverPrivacy.seedLegacyPermission()),
        snapshot: () => page.evaluate(() => (window as unknown as { libraryCoverPrivacy: LibraryCoverPrivacyHarness }).libraryCoverPrivacy.snapshot()),
      });
      expect(requests, "Vault-only covers never request a network resource").toEqual([]);
      expect(errors, "No unexpected browser or page errors").toEqual([]);
    } finally {
      if (!page.isClosed()) await page.evaluate(() => (window as unknown as { libraryCoverPrivacy: LibraryCoverPrivacyHarness }).libraryCoverPrivacy.dispose());
    }
  },
});

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test.beforeAll(async () => {
  const built = await build({ entryPoints: [path.join(root, "tests/browser/library-cover-privacy-harness.ts")], bundle: true,
    write: false, format: "iife", platform: "browser", target: "es2022", alias: { obsidian: path.join(root, "tests/browser/obsidian-browser.ts") } });
  bundle = built.outputFiles[0]?.text ?? "";
});

const urlInputs = [
  "https://covers.invalid/default.png", "HTTPS://covers.invalid/uppercase.png", "http://covers.invalid/cover.png",
  "//covers.invalid/cover.png", "https://fixture:synthetic@covers.invalid/cover.png",
  "https://covers.invalid/cover.%73vg", "https://covers.invalid/redirect", "https://127.0.0.1/cover.png",
  "ftp://covers.invalid/cover.png", "wss://covers.invalid/cover.png", "javascript:alert(1)",
  "data:image/png;base64,iVBORw0KGgo=", "blob:https://covers.invalid/synthetic", "app://vault/cover.png",
  "file:///synthetic/cover.png", "obsidian://open?file=cover.png", "about:blank", "custom-scheme:cover.png",
  "[[https://covers.invalid/wikilink.png]]", "![[https://covers.invalid/embed.png|Synthetic]]",
  "[cover](https://covers.invalid/cover.png)", "![cover](<https://covers.invalid/cover.png>)",
  "[cover](https%3A%2F%2Fcovers.invalid%2Fcover.png)", "[cover](%2F%2Fcovers.invalid%2Fcover.png)",
];

test("all supplied URL schemes stay blocked and never reach a vault resolver or image src", async ({ page, privacy }) => {
  for (const value of urlInputs) {
    expect(await privacy.render(value), value).toBe("blocked");
    await expect(page.locator("img")).toHaveCount(0);
    await expect(page.locator("main")).toHaveText(/^(?:Online covers unsupported|Use a vault image link)$/u);
    await expect(page.locator("main")).not.toContainText("covers.invalid");
  }
  await page.waitForTimeout(150);
  expect(privacy.requests).toEqual([]);
  expect(await privacy.snapshot()).toEqual({ localLookups: [], resourceLookups: [], legacyReads: 0 });
  await capture(page, "url-schemes-blocked");
});

test("inert legacy enabled App-local fixture cannot restore remote loading", async ({ page, privacy }) => {
  await privacy.seedLegacyPermission();
  // This is a synthetic App-local map, not proof of native storage persistence.
  expect(await page.evaluate(() => (window as unknown as { libraryCoverPrivacy: LibraryCoverPrivacyHarness }).libraryCoverPrivacy.legacyStorageValue())).toEqual({ version: 1, externalImagesAllowed: true });
  for (const value of urlInputs) {
    expect(await privacy.render(value), value).toBe("blocked");
    await expect(page.locator("img")).toHaveCount(0);
  }
  await page.waitForTimeout(150);
  expect(privacy.requests).toEqual([]);
  expect(await privacy.snapshot()).toEqual({ localLookups: [], resourceLookups: [], legacyReads: 0 });
  await capture(page, "legacy-permission-inert");
});

test("vault paths and wikilinks load a trusted local resource while the browser is offline", async ({ page, context, privacy }) => {
  await context.setOffline(true);
  for (const value of ["Covers/Example.png", "[[Covers/Example.png]]", "![[Covers/Example.png|Synthetic cover]]", "[[Covers/Example.png#cover]]", "../Covers/Example.png", "[Example](Covers/Example.png)", "![Example](<Covers/Example.png>)"]) {
    expect(await privacy.render(value), value).toBe("ready");
    await expect(page.locator("img")).toHaveJSProperty("naturalWidth", 1);
    await expect(page.locator("img")).toHaveAttribute("src", /^data:image\/png;base64,/u);
    await expect(page.locator("img")).toHaveAttribute("loading", "lazy");
  }
  const stats = await privacy.snapshot();
  expect(stats.localLookups).toHaveLength(7);
  expect(stats.localLookups.every((call) => call.sourcePath === "Books/Synthetic private note.md")).toBe(true);
  expect(stats.resourceLookups).toEqual(Array(7).fill("Covers/Example.png"));
  expect(stats.legacyReads).toBe(0);
  expect(privacy.requests).toEqual([]);
  await capture(page, "local-cover-offline");
});

test("changing a local cover to a URL removes the image; missing and invalid local covers stay harmless", async ({ page, privacy }) => {
  await privacy.seedLegacyPermission();
  expect(await privacy.render("[[Covers/Example.png]]")).toBe("ready");
  await expect(page.locator("img")).toHaveJSProperty("naturalWidth", 1);
  expect(await privacy.render("https://covers.invalid/changed.png?token=synthetic-only")).toBe("blocked");
  await expect(page.locator("img")).toHaveCount(0);
  await expect(page.locator("main")).toHaveText("Online covers unsupported");
  for (const [value, state, label] of [
    ["[[Covers/Missing.png]]", "missing", "Image not found in vault"],
    ["[[Covers/Unsafe.svg]]", "blocked", "Unsupported image type"],
    ["/synthetic/cover.png", "blocked", "Use a vault image link"],
    ["", "empty", "Cover property is empty"],
  ]) {
    expect(await privacy.render(value), value).toBe(state);
    await expect(page.locator("img")).toHaveCount(0);
    await expect(page.locator("main")).toHaveText(label);
  }
  expect((await privacy.snapshot()).resourceLookups).toEqual(["Covers/Example.png"]);
  await page.waitForTimeout(150);
  expect(privacy.requests).toEqual([]);
  await capture(page, "safe-placeholders");
});
