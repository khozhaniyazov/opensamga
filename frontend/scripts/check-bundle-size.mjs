#!/usr/bin/env node
/**
 * Bundle-size budget guard. Pure Node, no third-party deps.
 *
 * Added 2026-04-29 (v2.8). Retuned 2026-05-02 (v3.46). The intent
 * is NOT to gate merges on exact byte counts — it's to catch the
 * "ChatPage suddenly grew 40 kB" regression that lands when
 * somebody imports a heavy dep at the top level by accident.
 *
 * Run: `node scripts/check-bundle-size.mjs`
 *
 * Exits 1 with a summary if any chunk over its gzip budget.
 * Exits 0 otherwise.
 *
 * Budget tuning notes:
 *   - Budgets retuned at v3.46 to (this-script-measured-gzip + ~5%).
 *     Note that this script uses zlib gzipSync at level 9, which
 *     comes out ~2 kB smaller than what vite reports in build
 *     output (vite uses a faster default). Budgets and headroom
 *     comments below are calibrated against THIS script's output,
 *     not vite's.
 *   - The bundle has been steady (ChatPage 77-78 kB by vite,
 *     76.01 kB by this script) across 13 ships v3.32 → v3.45, which
 *     established a stable enough baseline to tighten from v2.8's
 *     intentionally-loose ~10% margins.
 *   - "index" is the main entry chunk (the app shell + router).
 *   - Vendor chunks (`*-vendor-*.js`) are pinned with ~5% headroom
 *     over their v3.46 sizes. Bumping any of these requires
 *     a comment justifying the new ceiling so accidental regressions
 *     can't sneak in via a Dependabot bump.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const DIST_ASSETS = path.resolve("dist/assets/js");

// Ordered: pattern → max gzip bytes. First match wins.
// Sizes captured at v3.46 (2026-05-02) using THIS script's
// zlib level-9 gzip. Headroom column = (max - actual) / actual.
const BUDGETS = [
  // Heaviest route + entry
  { pattern: /^ChatPage-.+\.js$/, maxGzip: 79 * 1024, label: "ChatPage" }, // 76.01 kB (3.93%)
  { pattern: /^index-.+\.js$/, maxGzip: 65 * 1024, label: "index (entry)" }, // 60.26 kB (7.87%)

  // Vendor chunks
  { pattern: /^charts-vendor-.+\.js$/, maxGzip: 110 * 1024, label: "charts-vendor" }, // 105.15 kB (4.61%)
  { pattern: /^math-vendor-.+\.js$/, maxGzip: 79 * 1024, label: "math-vendor" }, // 74.76 kB (5.67%)
  { pattern: /^markdown-vendor-.+\.js$/, maxGzip: 54 * 1024, label: "markdown-vendor" }, // 51.17 kB (5.53%)
  { pattern: /^react-core-.+\.js$/, maxGzip: 47 * 1024, label: "react-core" }, // 44.91 kB (4.65%)
  { pattern: /^react-app-.+\.js$/, maxGzip: 40 * 1024, label: "react-app" }, // 37.47 kB (6.75%)
  { pattern: /^i18n-vendor-.+\.js$/, maxGzip: 19 * 1024, label: "i18n-vendor" }, // 17.92 kB (6.03%)
  { pattern: /^http-vendor-.+\.js$/, maxGzip: 18 * 1024, label: "http-vendor" }, // 16.40 kB (9.76%)
  { pattern: /^icons-vendor-.+\.js$/, maxGzip: 11 * 1024, label: "icons-vendor" }, // 9.56 kB (15.06%)

  // Heavier route chunks worth catching
  { pattern: /^ExamsPage-.+\.js$/, maxGzip: 15 * 1024, label: "ExamsPage" }, // 14.03 kB (6.91%)
  { pattern: /^OnboardingPage-.+\.js$/, maxGzip: 11 * 1024, label: "OnboardingPage" }, // 10.15 kB (8.37%)
];

async function main() {
  let entries;
  try {
    entries = await fs.readdir(DIST_ASSETS);
  } catch (err) {
    console.error(
      `[bundle-size] Could not read ${DIST_ASSETS}. Did you run \`npm run build\` first?`,
    );
    console.error(err.message);
    process.exit(1);
  }

  const results = [];
  let hasFailure = false;

  for (const entry of entries) {
    if (!entry.endsWith(".js")) continue;
    const full = path.join(DIST_ASSETS, entry);
    const stat = await fs.stat(full);
    if (!stat.isFile()) continue;

    const buf = await fs.readFile(full);
    const gzip = gzipSync(buf, { level: 9 }).byteLength;

    for (const budget of BUDGETS) {
      if (!budget.pattern.test(entry)) continue;
      const ok = gzip <= budget.maxGzip;
      if (!ok) hasFailure = true;
      results.push({
        label: budget.label,
        file: entry,
        gzip,
        max: budget.maxGzip,
        ok,
      });
      break;
    }
  }

  if (results.length === 0) {
    console.warn(
      "[bundle-size] No tracked chunks matched. Did the chunk filenames change?",
    );
    process.exit(0);
  }

  console.log("Bundle-size budgets (gzip):");
  for (const r of results) {
    const icon = r.ok ? "OK " : "FAIL";
    const sizeKb = (r.gzip / 1024).toFixed(2);
    const maxKb = (r.max / 1024).toFixed(0);
    console.log(`  [${icon}] ${r.label.padEnd(12)} ${sizeKb} kB / ${maxKb} kB max  (${r.file})`);
  }

  if (hasFailure) {
    console.error(
      "\n[bundle-size] One or more chunks blew the budget. " +
        "Either trim the import, lazy-load it, or bump the budget in scripts/check-bundle-size.mjs " +
        "with a comment justifying the new ceiling.",
    );
    process.exit(1);
  }
  console.log("\n[bundle-size] All tracked chunks within budget.");
}

main().catch((err) => {
  console.error("[bundle-size] Unexpected failure:", err);
  process.exit(1);
});
