import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/layout",
  testMatch: "**/*.spec.ts",
  outputDir: "output/playwright/test-results",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never", outputFolder: "output/playwright/report" }]]
    : "line",
  use: {
    browserName: "chromium",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
});
