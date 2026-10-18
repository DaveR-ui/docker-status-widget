/**
 * End-to-end checks for the Docker Status release site.
 *
 * NON-GATING SCAFFOLD — this suite is deliberately NOT the merge gate yet. The
 * deployed site is new, so the CI job that runs it is wired with
 * `continue-on-error`; a red run here must never block a PR on its own.
 * Promoting it to a gate is a separate, deliberate decision.
 *
 * The suite is intentionally free of assumptions about the published tree:
 * `icons/` and `screenshots/` are copied in by the Pages workflow at publish
 * time and are absent from a plain checkout, so nothing here depends on them.
 */

import { pathToFileURL } from "node:url";

// This repository has no package.json and must not have one, so the runner is
// installed outside the checkout: the workflow runs
// `npm i --prefix "$RUNNER_TEMP/pw" @playwright/test@^1`. Node resolves a bare
// "@playwright/test" specifier by walking node_modules directories upwards from
// this file, and there is none above it — NODE_PATH would not help either, it is
// ignored by ESM — so the workflow hands in the absolute path to the package's
// ESM entry and this file imports that instead.
const runnerEntry = process.env.E2E_RUNNER_MODULE;
if (!runnerEntry) {
  throw new Error(
    "E2E_RUNNER_MODULE is not set — this repository has no package.json, so the " +
      "Playwright runner must be installed outside it and the absolute path to " +
      "@playwright/test/index.mjs passed in (the workflow sets it to " +
      "$RUNNER_TEMP/pw/node_modules/@playwright/test/index.mjs).",
  );
}
const { test, expect } = await import(pathToFileURL(runnerEntry).href);

const MANIFEST = "/latest.json";
// Mirrors VERSION_PATTERN in package/.../ui/dockerstatus.js: one to three numeric
// segments, no leading zeros. The widget refuses anything else, so a manifest this
// accepts but the widget would reject would make the test useless.
const VERSION_PATTERN = /^(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*)){0,2}$/;

/** Fetch and parse the release manifest through Playwright's request fixture. */
async function fetchManifest(request) {
  const response = await request.get(MANIFEST);
  expect(response.status()).toBe(200);
  return response.json();
}

/** The version written into the static HTML, read before any script runs. */
async function staticFallbackVersion(request) {
  const html = await (await request.get("/index.html")).text();
  const match = html.match(/id="latest-version"[^>]*>\s*([^<]*?)\s*</);
  expect(match, "index.html must carry a static #latest-version").not.toBeNull();
  return match[1];
}

test.describe("Docker Status site", () => {
  test("names the product and shows the install commands", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle(/Docker Status/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Docker Status");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      /Docker daemon/,
    );

    // The install snippet from the README.
    await expect(page.locator("pre code").first()).toContainText("./install.sh install");
    await expect(page.locator("pre code").first()).toContainText("./install.sh install-polkit");

    // The update check is explained and points at the manifest it serves.
    await expect(page.locator("#updates")).toContainText("latest.json");
    await expect(page.locator("#updates")).toContainText("/docker-status-widget/latest.json");
  });

  test("the version badge follows latest.json", async ({ page, request }) => {
    const manifest = await fetchManifest(request);

    await page.goto("/");

    // The inline enhancement script rewrites the badge asynchronously, so this
    // assertion retries until the rewrite lands.
    await expect(page.locator("#latest-version")).toHaveText(manifest.version);
    await expect(page.locator("#release-date")).toHaveText(manifest.released);
    await expect(page.locator("#release-notes")).toContainText(manifest.version);
    await expect(page.locator("#release-link")).toHaveAttribute("href", manifest.url);
  });

  test("the inline enhancement script runs without throwing", async ({ page }) => {
    // A 404 on an absent screenshot is a resource event, not a script fault, so
    // only uncaught exceptions count here.
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    await page.goto("/");

    await expect(page.locator("#latest-version")).toHaveText(VERSION_PATTERN);
    expect(pageErrors).toEqual([]);
  });

  test("latest.json is served as JSON with a valid version", async ({ request }) => {
    const response = await request.get(MANIFEST);

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/json");

    const manifest = await response.json();
    expect(manifest.app).toBe("io.github.daver-ui.dockerstatus");
    expect(manifest.name).toBe("Docker Status");
    expect(manifest.version).toMatch(VERSION_PATTERN);
    expect(manifest.released).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(manifest.url).toMatch(/^https:\/\/github\.com\/DaveR-ui\/docker-status-widget\//);
  });
});

test.describe("without JavaScript", () => {
  // The static HTML must stand on its own: no fetch, no rewrite, same version.
  test.use({ javaScriptEnabled: false });

  test("still names the version and the install commands", async ({ page, request }) => {
    const staticVersion = await staticFallbackVersion(request);
    expect(staticVersion).toMatch(VERSION_PATTERN);

    await page.goto("/");

    await expect(page.locator("#latest-version")).toHaveText(staticVersion);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Docker Status");
    await expect(page.locator("pre code").first()).toContainText("./install.sh install");
    await expect(page.locator("#release-notes")).toContainText(staticVersion);
  });
});
