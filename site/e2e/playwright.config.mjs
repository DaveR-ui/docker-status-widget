/**
 * Playwright config for the Docker Status release site.
 *
 * NON-GATING SCAFFOLD — this suite is deliberately NOT the merge gate yet. The
 * Pages site is new, so the workflow that runs it does so with
 * `continue-on-error`; a failure here must never block a PR on its own.
 * Promoting it to a gate is a separate, deliberate decision.
 *
 * There is no package.json in this repository and there must not be one. CI
 * installs @playwright/test into a runner-temp directory and invokes the CLI by
 * path with `--config site/e2e/playwright.config.mjs`, so this file has to be
 * self-sufficient: no plugins, no TypeScript, no imports outside node builtins
 * plus the test runner that loads it.
 *
 * The site is static and dependency-free, so the webServer is plain python3.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(here, "..");

const port = process.env.PW_PORT || "4173";
const baseURL = `http://127.0.0.1:${port}`;

export default {
  testDir: here,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL,
  },
  webServer: {
    command: `python3 -m http.server ${port} --directory "${siteRoot}"`,
    url: `${baseURL}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
};
