import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rmdir, unlink } from "node:fs/promises";
import { createServer, type Server } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import { expect, test as base, type Page } from "@playwright/test";
import type { LibraryCoverPrivacyHarness } from "../browser/library-cover-privacy-harness";

// Real browser requests to loopback HTTPS servers; no external fixture hosts.
// This complements permission/UI runtime tests, not native Obsidian or device QA.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=", "base64");
const pageTitle = "KBCC cover privacy · synthetic HTTPS fixture";
let bundle: string;
let certificateDirectory: string | undefined;
let tls: { key: Buffer; cert: Buffer };

interface ObservedRequest {
  kind: "cover" | "redirect-final";
  url: string;
  referer: string | null;
  cookiePresent: boolean;
}

interface PrivacyFixture {
  requests: ObservedRequest[];
  coverOrigin: string;
  redirectOrigin: string;
  render: (value: string, allowed: boolean) => Promise<string>;
  revoke: () => Promise<void>;
  releasePending: () => void;
}

async function removeCertificate(): Promise<void> {
  if (!certificateDirectory) return;
  // Only these two files and their exclusively owned mkdtemp directory exist.
  for (const name of ["key.pem", "cert.pem"]) {
    await unlink(path.join(certificateDirectory, name)).catch((error: { code?: string }) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  await rmdir(certificateDirectory);
  certificateDirectory = undefined;
}

async function capture(page: Page, name: string): Promise<void> {
  const directory = process.env.KBCC_BROWSER_SCREENSHOT_DIR;
  if (!directory) return;
  if (!path.isAbsolute(directory) || directory.startsWith(`${root}${path.sep}`)) throw new Error("Evidence must stay outside the repository");
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${test.info().project.name}-privacy-${name}.png`) });
}

const test = base.extend<{ privacy: PrivacyFixture }>({
  privacy: async ({ page, context }, use) => {
    const servers: Server[] = [];
    const pending = new Set<ServerResponse>();
    const requests: ObservedRequest[] = [];
    const unexpected: string[] = [];
    const errors: string[] = [];
    const imageResponse = (response: ServerResponse): void => {
      response.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
      response.end(png);
    };
    const start = async (handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<Server> => {
      const server = createServer(tls, handler);
      servers.push(server);
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
      });
      return server;
    };
    const port = (server: Server): number => (server.address() as AddressInfo).port;
    const observe = (request: IncomingMessage, kind: ObservedRequest["kind"]): void => {
      requests.push({ kind, url: `https://${request.headers.host}${request.url}`,
        referer: request.headers.referer ?? null, cookiePresent: Boolean(request.headers.cookie) });
    };
    try {
      const redirectServer = await start((request, response) => { observe(request, "redirect-final"); imageResponse(response); });
      const redirectOrigin = `https://127.0.0.1:${port(redirectServer)}`;
      const coverServer = await start((request, response) => {
        observe(request, "cover");
        const url = new URL(request.url!, `https://${request.headers.host}`);
        if (url.pathname === "/redirect") {
          response.writeHead(302, { location: `${redirectOrigin}/final.png?token=synthetic-redirect`, "cache-control": "no-store" });
          response.end();
        } else if (url.pathname === "/pending.png") {
          pending.add(response);
          response.once("close", () => pending.delete(response));
        } else imageResponse(response);
      });
      // Different hostnames make this cross-site, even though every server binds
      // only IPv4 loopback. Redirect targets are server-owned loopback URLs too.
      const coverOrigin = `https://localhost:${port(coverServer)}`;
      const uiServer = await start((_request, response) => {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end(`<!doctype html><html><head><meta charset="utf-8"><title>${pageTitle}</title></head><body><h1>Synthetic cover privacy</h1><main></main></body></html>`);
      });
      const uiOrigin = `https://127.0.0.1:${port(uiServer)}`;
      const ports = new Set(servers.map((server) => String(port(server))));
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      await context.addCookies([{ name: "synthetic", value: "fixture-only", domain: "localhost", path: "/", secure: true, sameSite: "None" }]);
      await page.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.protocol === "https:" && ["127.0.0.1", "localhost"].includes(url.hostname) && ports.has(url.port)) {
          await route.continue();
        } else {
          unexpected.push(url.href);
          await route.abort();
        }
      });
      await page.goto(`${uiOrigin}/private-vault/synthetic-note`);
      await page.addScriptTag({ content: bundle });
      await expect(page).toHaveTitle(pageTitle);
      expect(new URL(page.url()).origin).toBe(uiOrigin);
      await expect(page.getByRole("heading", { name: "Synthetic cover privacy" })).toBeVisible();
      await expect(page.locator("vite-error-overlay, #webpack-dev-server-client-overlay, nextjs-portal")).toHaveCount(0);
      await use({ requests, coverOrigin, redirectOrigin,
        render: (value, allowed) => page.evaluate(({ value, allowed }) =>
          (window as unknown as { libraryCoverPrivacy: LibraryCoverPrivacyHarness }).libraryCoverPrivacy.render(value, allowed), { value, allowed }),
        revoke: () => page.evaluate(() => (window as unknown as { libraryCoverPrivacy: LibraryCoverPrivacyHarness }).libraryCoverPrivacy.revoke()),
        releasePending: () => { for (const response of pending) if (!response.destroyed) imageResponse(response); pending.clear(); },
      });
      expect(unexpected, "No browser request may escape the loopback fixture").toEqual([]);
      expect(errors, "No unexpected browser or page errors").toEqual([]);
    } finally {
      // Release pending responses and active TLS sockets even after failed tests
      // or partial fixture setup; no listening server survives this fixture.
      for (const response of pending) response.destroy();
      for (const server of servers) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  },
});

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, ignoreHTTPSErrors: true });

test.beforeAll(async () => {
  certificateDirectory = await mkdtemp(path.join(tmpdir(), "kbcc-cover-privacy-tls-"));
  try {
    const key = path.join(certificateDirectory, "key.pem");
    const cert = path.join(certificateDirectory, "cert.pem");
    // OpenSSL is a test-host prerequisite (standard macOS/Linux CI tooling), not
    // a runtime dependency. Certificates/private keys are never committed.
    await promisify(execFile)("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
      "-subj", "/CN=localhost", "-keyout", key, "-out", cert], { timeout: 15000 });
    await chmod(key, 0o600);
    tls = { key: await readFile(key), cert: await readFile(cert) };
    const built = await build({ entryPoints: [path.join(root, "tests/browser/library-cover-privacy-harness.ts")], bundle: true,
      write: false, format: "iife", platform: "browser", target: "es2022", alias: { obsidian: path.join(root, "tests/browser/obsidian-browser.ts") } });
    bundle = built.outputFiles[0]?.text ?? "";
  } catch (error) {
    await removeCertificate();
    throw error;
  }
});

test.afterAll(async () => { await removeCertificate(); });

test("denied and unsafe cover values never issue image requests", async ({ page, privacy }) => {
  for (const [value, allowed, state] of [
    [`${privacy.coverOrigin}/default.png`, false, "external-blocked"],
    [`${privacy.coverOrigin}/changed.png?synthetic=only`, false, "external-blocked"],
    [`${privacy.coverOrigin}/cover.svg`, true, "blocked"],
    [`${privacy.coverOrigin}/cover.%73vg`, true, "blocked"],
    [`${privacy.coverOrigin}/cover.%73%76%67z`, true, "blocked"],
    [`http://localhost:${new URL(privacy.coverOrigin).port}/cover.png`, true, "blocked"],
    [`https://synthetic:fixture@localhost:${new URL(privacy.coverOrigin).port}/cover.png`, true, "blocked"],
  ] as const) {
    expect(await privacy.render(value, allowed)).toBe(state);
    await expect(page.locator("img")).toHaveCount(0);
  }
  await page.waitForTimeout(150);
  expect(privacy.requests).toHaveLength(0);
  await capture(page, "denied-values");
});

test("harness-supplied permission preserves URL and suppresses actual Referer through HTTPS redirect", async ({ page, privacy }, testInfo) => {
  const imageUrl = `${privacy.coverOrigin}/cover.png?token=synthetic-only`;
  expect(await privacy.render(imageUrl, true)).toBe("ready");
  await expect(page.locator("img")).toHaveJSProperty("naturalWidth", 1);
  expect(privacy.requests).toHaveLength(1);
  expect(privacy.requests[0].url).toBe(imageUrl);
  expect(privacy.requests[0].referer).toBeNull();
  await privacy.render(`${privacy.coverOrigin}/redirect`, true);
  await expect(page.locator("img")).toHaveJSProperty("naturalWidth", 1);
  expect(privacy.requests.map((request) => request.kind)).toEqual(["cover", "cover", "redirect-final"]);
  expect(privacy.requests[2].url).toBe(`${privacy.redirectOrigin}/final.png?token=synthetic-redirect`);
  expect(privacy.requests.every((request) => request.referer === null)).toBe(true);
  // Browser cookie policy differs (Chromium may send this cookie; WebKit may
  // withhold it). Record observed transport; never promise cookie suppression.
  await testInfo.attach("synthetic-cookie-and-header-observation", {
    body: Buffer.from(JSON.stringify({ engine: testInfo.project.name, requests: privacy.requests }, null, 2)), contentType: "application/json",
  });
  await capture(page, "allowed-redirect");
});

test("revocation strips a loaded source and changed properties stay blocked", async ({ page, privacy }) => {
  await privacy.render(`${privacy.coverOrigin}/loaded.png`, true);
  await expect(page.locator("img")).toHaveJSProperty("naturalWidth", 1);
  const removedImage = await page.locator("img").elementHandle();
  expect(removedImage).not.toBeNull();
  await privacy.revoke();
  expect(await removedImage.getAttribute("src")).toBeNull();
  await expect(page.locator("img")).toHaveCount(0);
  expect(await privacy.render(`${privacy.coverOrigin}/changed-after-revoke.png`, false)).toBe("external-blocked");
  await expect(page.locator("main")).toHaveText("External cover blocked");
  await page.waitForTimeout(150);
  expect(privacy.requests).toHaveLength(1);
  await removedImage.dispose();
  await capture(page, "revoked");
});

test("in-flight revocation removes source without claiming to recall the request already received", async ({ page, privacy }) => {
  await privacy.render(`${privacy.coverOrigin}/pending.png`, true);
  await expect.poll(() => privacy.requests.length).toBe(1);
  expect(new URL(privacy.requests[0].url).pathname).toBe("/pending.png");
  const removedImage = await page.locator("img").elementHandle();
  expect(removedImage).not.toBeNull();
  await privacy.revoke();
  expect(await removedImage.getAttribute("src")).toBeNull();
  await expect(page.locator("img")).toHaveCount(0);
  privacy.releasePending();
  expect(await privacy.render(`${privacy.coverOrigin}/pending-replacement.png`, false)).toBe("external-blocked");
  await expect(page.locator("main")).toHaveText("External cover blocked");
  await page.waitForTimeout(150);
  expect(privacy.requests).toHaveLength(1);
  await expect(page.locator("img")).toHaveCount(0);
  await removedImage.dispose();
  await capture(page, "pending-revoked");
});
