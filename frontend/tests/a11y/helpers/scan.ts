import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import type { Result as AxeResult } from "axe-core";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

/**
 * Runs @axe-core/playwright against the given page, attaches a machine-readable
 * JSON artifact to the Playwright test, and appends a row to a session CSV
 * summarizing the hit counts per severity.
 *
 * We intentionally do NOT fail the test on violations. This is a reporting
 * harness, not a gate — failing the run would make it impossible to collect
 * the full violation picture across all screens in a single pass.
 */

const RESULTS_DIR = join(process.cwd(), "../test-results/a11y");
const CSV_PATH = join(RESULTS_DIR, "summary.csv");

if (!existsSync(RESULTS_DIR)) {
  mkdirSync(RESULTS_DIR, { recursive: true });
}

if (!existsSync(CSV_PATH)) {
  writeFileSync(
    CSV_PATH,
    "screen,url,critical,serious,moderate,minor,total_violations,passes,incomplete\n",
    "utf8",
  );
}

export interface ScanOptions {
  /** Short, filesystem-safe label (e.g. "library-grid"). */
  screen: string;
  /** CSS selector to scope axe to, if the page has noisy dynamic regions. */
  include?: string[];
  /** CSS selectors to exclude (e.g. third-party widgets, fonts). */
  exclude?: string[];
  /** WCAG tags to check. Defaults to wcag2a + wcag2aa + wcag21aa + best-practice. */
  tags?: string[];
}

function sanitize(s: string): string {
  return s.replace(/[^a-z0-9._-]/gi, "-");
}

function summarizeViolations(violations: AxeResult[]): {
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
} {
  const out = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const v of violations) {
    const impact = (v.impact ?? "minor") as keyof typeof out;
    if (impact in out) {
      out[impact] += v.nodes.length;
    }
  }
  return out;
}

export async function scanA11y(
  page: Page,
  testInfo: TestInfo,
  opts: ScanOptions,
): Promise<{ violations: AxeResult[]; passes: number; incomplete: number }> {
  const tags = opts.tags ?? [
    "wcag2a",
    "wcag2aa",
    "wcag21a",
    "wcag21aa",
    "best-practice",
  ];

  let builder = new AxeBuilder({ page }).withTags(tags);

  if (opts.include && opts.include.length > 0) {
    builder = builder.include(opts.include);
  }

  if (opts.exclude) {
    for (const sel of opts.exclude) {
      builder = builder.exclude(sel);
    }
  }

  const results = await builder.analyze();

  const summary = summarizeViolations(results.violations);
  const total =
    summary.critical + summary.serious + summary.moderate + summary.minor;

  // Attach the full JSON report to the test for easy drilldown.
  const jsonPath = join(
    RESULTS_DIR,
    `${sanitize(opts.screen)}.json`,
  );
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        screen: opts.screen,
        url: page.url(),
        timestamp: new Date().toISOString(),
        summary,
        total_violations: total,
        passes: results.passes.length,
        incomplete: results.incomplete.length,
        violations: results.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          tags: v.tags,
          description: v.description,
          help: v.help,
          helpUrl: v.helpUrl,
          nodes: v.nodes.map((n) => ({
            target: n.target,
            failureSummary: n.failureSummary,
            html: n.html.slice(0, 400), // cap payload
          })),
        })),
      },
      null,
      2,
    ),
    "utf8",
  );
  await testInfo.attach(`axe-${opts.screen}`, {
    path: jsonPath,
    contentType: "application/json",
  });

  // Append CSV summary row.
  writeFileSync(
    CSV_PATH,
    [
      sanitize(opts.screen),
      page.url(),
      summary.critical,
      summary.serious,
      summary.moderate,
      summary.minor,
      total,
      results.passes.length,
      results.incomplete.length,
    ].join(",") + "\n",
    { encoding: "utf8", flag: "a" },
  );

  // Surface a concise console line (ASCII-safe for Windows cmd).
  const impactStr =
    `crit=${summary.critical} ser=${summary.serious} ` +
    `mod=${summary.moderate} min=${summary.minor}`;
  console.log(`[a11y] ${opts.screen}: total=${total} ${impactStr}`);

  return {
    violations: results.violations,
    passes: results.passes.length,
    incomplete: results.incomplete.length,
  };
}
