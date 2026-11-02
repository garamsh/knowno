import { defineConfig, devices } from "@playwright/test";

// The specs run against a server started outside Playwright: scripts/web.sh starts the image.
const baseURL = process.env.E2E_BASE_URL;
if (!baseURL) throw new Error("E2E_BASE_URL names the server the e2e specs run against");

export default defineConfig({
  testDir: "e2e",
  forbidOnly: true,
  reporter: "list",
  use: { baseURL },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
