#!/usr/bin/env node
/*
 * sync-manifest.mjs — regenerate site/latest.json from the plasmoid's metadata.json.
 *
 * THE CONTRACT
 *   package/io.github.daver-ui.dockerstatus/metadata.json is the single source of
 *   version truth. Nothing downstream of it may be authored by hand, because a
 *   hand-typed version is a second source of truth and it drifts:
 *     - site/latest.json   what the site page renders and what the widget reads
 *     - dist/latest.json   the same bytes, uploaded for GitHub Pages to serve
 *   The widget fetches
 *     https://dave-r-ui.github.io/docker-status-widget/latest.json
 *   to decide whether a newer release exists, so the page's payload and the
 *   machine endpoint are both derived from metadata.json — never from each other.
 *
 * Zero dependencies, no package.json, no npm install — plain Node, readable.
 *   node .github/scripts/sync-manifest.mjs            --write (the default):
 *                                                        write-if-diff, never a
 *                                                        needless rewrite.
 *   node .github/scripts/sync-manifest.mjs --check    read-only: does the
 *                                                        committed site/latest.json
 *                                                        still match metadata.json?
 *
 * Output: `wrote: <path>` goes to STDERR on change and nothing is printed on a
 * no-op, so STDOUT stays clean. --check prints one finding line and exits 1 on
 * drift, which is what keeps the repo copy honest between pushes.
 *
 * Shape written (key order is part of the contract):
 *   { "app", "name", "version", "released", "url" }
 *     app      metadata KPlugin.Id
 *     name     metadata KPlugin.Name
 *     version  metadata KPlugin.Version
 *     released today, ISO YYYY-MM-DD (a generation stamp, not a metadata fact)
 *     url      the release the version points at
 *
 * Run from anywhere — ROOT is the repo root resolved from this file's own
 * location, not from the cwd, the same discipline docs/validate.js carries.
 *
 * Note on module format: the .mjs extension is what the workflows and the repo
 * layout agree on, so this is an ES module (import / import.meta.url) rather
 * than the CommonJS `require` of docs/validate.js. Same zero-dependency Node,
 * same cwd-independence, same section banners.
 */
'use strict'; // ES modules are strict by default; stated so the parallel is obvious

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ----------------------------- Configuration ------------------------------

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'); // .github/scripts -> repo root
const METADATA_REL = 'package/io.github.daver-ui.dockerstatus/metadata.json';
const MANIFEST_REL = 'site/latest.json';
const RELEASES_URL = 'https://github.com/DaveR-ui/docker-status-widget/releases/latest';
const INDENT = 4; // matches metadata.json's own 4-space layout, so a diff stays quiet
const DASH = '\u2014'; // — in the finding line; escaped so the source stays pure ASCII
const CHECK_MODE = process.argv.slice(2).includes('--check');

// `released` is stamped at generation time and is not a fact metadata.json
// carries, so --check does NOT compare it: a manifest has not drifted merely
// because it was generated yesterday. Every other key IS derived from
// metadata.json and IS compared — drift means a wrong version the widget trusts.
const DERIVED_KEYS = ['app', 'name', 'version', 'url'];

// ----------------------------- Small helpers ------------------------------

function fail(message) {
  process.stderr.write(`sync-manifest: ${message}\n`);
  process.exit(1);
}

function todayISO() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Read and validate metadata.json. A missing, unparseable or version-less
 *  file is fatal here rather than in the caller: there is no sensible manifest
 *  to write when the single source of truth is unusable. */
function readMetadata() {
  const abs = join(ROOT, METADATA_REL);
  let raw;
  try {
    raw = readFileSync(abs, 'utf8');
  } catch {
    fail(`${METADATA_REL} is missing — it is the single source of version truth`);
  }
  let meta;
  try {
    meta = JSON.parse(raw);
  } catch (e) {
    fail(`${METADATA_REL} is not valid JSON: ${e.message}`);
  }
  const plugin = meta && meta.KPlugin;
  if (!plugin || typeof plugin !== 'object') {
    fail(`${METADATA_REL} carries no KPlugin object`);
  }
  for (const [key, value] of [['Id', plugin.Id], ['Name', plugin.Name], ['Version', plugin.Version]]) {
    if (typeof value !== 'string' || value.trim() === '') {
      fail(`${METADATA_REL} has no KPlugin.${key}`);
    }
  }
  return plugin;
}

/** The manifest object, in the contract's key order. */
function render(plugin) {
  return {
    app: plugin.Id,
    name: plugin.Name,
    version: plugin.Version,
    released: todayISO(),
    url: RELEASES_URL,
  };
}

function renderBytes(manifest) {
  return `${JSON.stringify(manifest, null, INDENT)}\n`;
}

// ----------------------------- --write (the default) ------------------------------

/** Write-if-diff: identical bytes mean no work and no notice, so a Pages build
 *  that has nothing to change stays quiet and the file's mtime does not churn. */
function write(plugin) {
  const next = renderBytes(render(plugin));
  const abs = join(ROOT, MANIFEST_REL);
  let current = null;
  try {
    current = readFileSync(abs, 'utf8');
  } catch {
    current = null; // absent: the first publication, so it must be created
  }
  if (current === next) return; // no-op
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, next, 'utf8');
  process.stderr.write(`wrote: ${MANIFEST_REL}\n`);
}

// ----------------------------- --check (read-only) ------------------------------

/** One finding line on drift, exit 1. On success: silence and exit 0. */
function check(plugin) {
  const rendered = render(plugin);
  const abs = join(ROOT, MANIFEST_REL);
  let committed = null;
  const diffs = [];

  try {
    committed = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    diffs.push(`unreadable or not JSON (${e.message})`);
  }

  if (diffs.length === 0 && (committed === null || typeof committed !== 'object' || Array.isArray(committed))) {
    diffs.push('not a JSON object');
  }

  if (diffs.length === 0) {
    for (const key of Object.keys(rendered)) {
      if (!(key in committed)) {
        diffs.push(`missing ${key}`);
      } else if (DERIVED_KEYS.includes(key) && committed[key] !== rendered[key]) {
        diffs.push(`${key} is ${JSON.stringify(committed[key])}, metadata.json says ${JSON.stringify(rendered[key])}`);
      }
    }
    const extra = Object.keys(committed).filter((k) => !(k in rendered));
    if (extra.length > 0) diffs.push(`unexpected keys: ${extra.join(', ')}`);
  }

  if (diffs.length > 0) {
    process.stdout.write(`${MANIFEST_REL} ${DASH} version-mismatch: ${diffs.join('; ')}\n`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = 0;
}

// ----------------------------- Main ------------------------------

function main() {
  const plugin = readMetadata();
  if (CHECK_MODE) check(plugin);
  else write(plugin);
}

main();
