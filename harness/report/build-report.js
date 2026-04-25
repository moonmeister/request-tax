#!/usr/bin/env node

/**
 * Build a static HTML report from chart HTML files and analysis data.
 *
 * Prereq: run build-charts.js first to generate results/charts/*.html
 * Input:  results/charts/manifest.json, results/analysis/comparisons.json
 * Output: results/reports/index.html
 */

import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import minimist from "minimist";

const ANALYSIS_DIR = path.resolve("results", "analysis");
const CHARTS_DIR = path.resolve("results", "charts");
const REPORTS_DIR = path.resolve("results", "reports");

async function loadJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function chartIframe(filename, height = "400px") {
  return `<iframe src="../charts/${filename}" style="width:100%;height:${height};border:none;" loading="lazy"></iframe>`;
}

function generateHtml(manifest, comparisons) {
  const total = comparisons.data.length;
  const sig = comparisons.data.filter((c) => c.significant).length;
  const pract = comparisons.data.filter(
    (c) => c.practically_significant,
  ).length;
  const config = comparisons.meta.analysisConfig;
  const meanDelta =
    total > 0
      ? (comparisons.data.reduce((s, c) => s + c.delta_pct, 0) / total).toFixed(
          1,
        ) + "%"
      : "–";

  // Group charts by prefix
  const heatmapOrder = [
    "phase-1-heatmap-baseline",
    "phase-1-heatmap-moderate-rtt",
    "phase-1-heatmap-loss-0.5pct",
    "phase-1-heatmap-loss-1pct",
    "phase-1-heatmap-loss-3pct",
  ];
  const heatmaps = manifest
    .filter((f) => f.startsWith("phase-1-heatmap-"))
    .sort((a, b) => {
      const aBase = a.replace(".html", "");
      const bBase = b.replace(".html", "");
      const ai = heatmapOrder.indexOf(aBase);
      const bi = heatmapOrder.indexOf(bBase);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  const crossover = manifest.filter((f) =>
    f.startsWith("phase-1-chunk-crossover"),
  );
  const h1Scaling = manifest.filter((f) =>
    f.startsWith("phase-1-scaling"),
  );
  const retentions = manifest.filter((f) => f.startsWith("phase-2-retention"));
  const dists = manifest.filter((f) => f.startsWith("distribution-"));

  function chartLabel(filename) {
    const base = filename.replace(/\.html$/, "");
    // Phase 1 heatmaps: "phase-1-heatmap-baseline" → "baseline"
    if (base.startsWith("phase-1-heatmap-"))
      return base.replace("phase-1-heatmap-", "");
    // Phase 1 crossover
    if (base === "phase-1-chunk-crossover") return "chunk crossover";
    // Phase 1 scaling
    if (base === "phase-1-scaling") return "request scaling";
    // Phase 2 retention per-payload: "phase-2-retention-1000kb" → "1000kb payload"
    if (base.startsWith("phase-2-retention-"))
      return base.replace("phase-2-retention-", "") + " payload";
    // Phase 2 retention overview
    if (base === "phase-2-retention") return "overview";
    // Distributions: "distribution-10kb-1-chunks" → "10kb × 1 chunks"
    if (base.startsWith("distribution-")) {
      const m = base.match(/distribution-(\d+kb)-(\d+)-chunks/);
      if (m) return `${m[1]} × ${m[2]} chunks`;
      return base.replace("distribution-", "");
    }
    return base.replace(/-/g, " ");
  }

  function chartGrid(files, height = "400px") {
    return `<div class="chart-grid">\n${files
      .map((f) => {
        const label = chartLabel(f);
        return `  <div class="chart-cell">\n    <h3>${label}</h3>\n    ${chartIframe(f, height)}\n  </div>`;
      })
      .join("\n")}\n</div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Request Tax – Benchmark Report</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #fafafa; color: #222; line-height: 1.5; padding: 2rem; max-width: 1400px; margin: 0 auto; }
  h1 { font-size: 1.8rem; margin-bottom: 0.5rem; }
  h2 { font-size: 1.3rem; margin: 2rem 0 0.5rem; border-bottom: 2px solid #ddd; padding-bottom: 0.3rem; }
  h3 { font-size: 1.1rem; margin: 1rem 0 0.3rem; color: #555; text-transform: capitalize; }
  p, .note { margin: 0.5rem 0; color: #555; font-size: 0.9rem; }
  .summary { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 1rem 1.5rem; margin: 1rem 0; display: flex; gap: 2rem; flex-wrap: wrap; }
  .summary .stat { text-align: center; }
  .summary .stat .value { font-size: 1.8rem; font-weight: 700; color: #333; }
  .summary .stat .label { font-size: 0.8rem; color: #888; text-transform: uppercase; }
  .chart-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(500px, 1fr)); gap: 1rem; margin: 1rem 0; }
  .chart-cell { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 1rem; }
  .config { font-size: 0.8rem; color: #999; margin-top: 2rem; border-top: 1px solid #eee; padding-top: 1rem; }
</style>
</head>
<body>

<h1>Request Tax – H1 vs H3 Benchmark Report</h1>
<p>Generated ${new Date().toISOString().slice(0, 10)}</p>
<p>All deltas are computed as <strong>H3 − H1</strong>. Negative values mean H3 is faster; positive values mean H1 is faster.</p>

<div class="summary">
  <div class="stat"><div class="value">${total}</div><div class="label">Comparisons</div></div>
  <div class="stat"><div class="value">${sig}</div><div class="label">Significant</div></div>
  <div class="stat"><div class="value">${pract}</div><div class="label">Practically Significant</div></div>
  <div class="stat"><div class="value">${meanDelta}</div><div class="label">Mean Δ%</div></div>
</div>

${
  heatmaps.length > 0
    ? `<h2>Phase 1 – Request Granularity Heatmap</h2>
<p>★ = practically significant, ● = statistically significant</p>
${chartGrid(heatmaps, "400px")}`
    : ""
}

${
  crossover.length > 0
    ? `<h2>Phase 1 – Chunk Size Crossover</h2>
<div class="chart-cell" style="margin: 1rem 0;">
  ${chartIframe(crossover[0], "500px")}
</div>`
    : ""
}

${
  h1Scaling.length > 0
    ? `<h2>Phase 1 – HTTP Request Scaling</h2>
<p>Shows how page completion time grows with split count for each payload size. Demonstrates the per-request overhead tax.</p>
<div class="chart-cell" style="margin: 1rem 0;">
  ${chartIframe(h1Scaling[0], "500px")}
</div>`
    : ""
}

${
  retentions.length > 0
    ? `<h2>Phase 2 – Invalidation Retention</h2>
${chartGrid(retentions, "400px")}`
    : ""
}

${
  dists.length > 0
    ? `<h2>Distributions – Representative Scenarios</h2>
${chartGrid(dists, "350px")}`
    : ""
}

<div class="config">
  <strong>Analysis config:</strong>
  seed=${config.seed},
  bootstrap=${config.bootstrapResamples} resamples,
  permutation=${config.permutationIterations} iterations,
  CI=${config.ciLevel * 100}%,
  α=${config.significanceAlpha},
  correction=${config.correction},
  practical thresholds: |Δ%|&gt;${config.practicalThresholds.deltaPctMin} or |Δms|&gt;${config.practicalThresholds.deltaMsMin}
</div>

</body>
</html>`;
}

async function main() {
  const [manifest, comparisons] = await Promise.all([
    loadJson(path.join(CHARTS_DIR, "manifest.json")),
    loadJson(path.join(ANALYSIS_DIR, "comparisons.json")),
  ]);

  const html = generateHtml(manifest, comparisons);

  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const outPath = path.join(REPORTS_DIR, "index.html");
  await fs.writeFile(outPath, html);

  console.log(`✓ Report written to results/reports/index.html`);

  const argv = minimist(process.argv.slice(2));
  if (argv.open) {
    const cmd =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "start"
          : "xdg-open";
    exec(`${cmd} ${outPath}`);
  }
}

main();
