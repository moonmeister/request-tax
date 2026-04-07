#!/usr/bin/env node

/**
 * Build a static HTML report from chart-ready JSON artifacts.
 *
 * Input:  results/analysis/chart-*.json
 * Output: results/reports/index.html
 */

import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import minimist from "minimist";

const ANALYSIS_DIR = path.resolve("results", "analysis");
const REPORTS_DIR = path.resolve("results", "reports");

async function loadChart(name) {
  return JSON.parse(await fs.readFile(path.join(ANALYSIS_DIR, name), "utf8"));
}

function buildHeatmapTraces(chart) {
  const profiles = [...new Set(chart.data.map((d) => d.profileName))].sort();
  const subplots = [];

  for (const profile of profiles) {
    const rows = chart.data.filter((d) => d.profileName === profile);
    const payloads = [...new Set(rows.map((d) => d.payloadKb))].sort(
      (a, b) => a - b,
    );
    const splits = [...new Set(rows.map((d) => d.splitCount))].sort(
      (a, b) => a - b,
    );

    const z = [];
    const text = [];
    for (const p of payloads) {
      const zRow = [];
      const tRow = [];
      for (const s of splits) {
        const cell = rows.find((d) => d.payloadKb === p && d.splitCount === s);
        if (cell) {
          zRow.push(cell.delta_pct);
          const sig = cell.practically_significant
            ? "★"
            : cell.significant
              ? "●"
              : "";
          tRow.push(
            `${cell.delta_pct.toFixed(1)}%<br>${cell.delta_ms.toFixed(1)}ms<br>CI [${cell.ci_lower.toFixed(1)}, ${cell.ci_upper.toFixed(1)}] ${sig}`,
          );
        } else {
          zRow.push(null);
          tRow.push("");
        }
      }
      z.push(zRow);
      text.push(tRow);
    }

    subplots.push({
      profile,
      trace: {
        z,
        x: splits.map((s) => (s === 1 ? "1 request" : `${s} requests`)),
        y: payloads.map((p) => `${p}KB`),
        text,
        hoverinfo: "text",
        type: "heatmap",
        colorscale: [
          [0, "#1a9850"],
          [0.5, "#ffffbf"],
          [1, "#d73027"],
        ],
        zmid: 0,
        colorbar: { title: "Δ%" },
      },
    });
  }

  return subplots;
}

function buildDecompositionTraces(chart) {
  const payloads = [...new Set(chart.data.map((d) => d.payloadKb))].sort(
    (a, b) => a - b,
  );
  const cacheOrder = ["origin-no-cache", "edge-cache-hit", "edge-direct"];
  const subplots = [];

  for (const payload of payloads) {
    const rows = chart.data
      .filter((d) => d.payloadKb === payload)
      .sort(
        (a, b) =>
          cacheOrder.indexOf(a.cacheProfile) -
          cacheOrder.indexOf(b.cacheProfile),
      );

    const splits = [...new Set(rows.map((d) => d.splitCount))].sort(
      (a, b) => a - b,
    );
    const traces = [];

    for (const split of splits) {
      const splitRows = rows.filter((d) => d.splitCount === split);
      traces.push({
        x: splitRows.map((d) => d.cacheProfile),
        y: splitRows.map((d) => d.delta_ms),
        error_y: {
          type: "data",
          symmetric: false,
          array: splitRows.map((d) => d.ci_upper - d.delta_ms),
          arrayminus: splitRows.map((d) => d.delta_ms - d.ci_lower),
        },
        name: `${split}x`,
        type: "scatter",
        mode: "markers",
        marker: { size: 10 },
      });
    }

    subplots.push({ payload, traces });
  }

  return subplots;
}

function buildRetentionTraces(chart) {
  const payloads = [...new Set(chart.data.map((d) => d.payloadKb))].sort(
    (a, b) => a - b,
  );
  const invalOrder = [
    "full-purge",
    "partial-purge-20pct",
    "partial-purge-40pct",
  ];
  const subplots = [];

  for (const payload of payloads) {
    const rows = chart.data.filter((d) => d.payloadKb === payload);
    const splits = [...new Set(rows.map((d) => d.splitCount))].sort(
      (a, b) => a - b,
    );
    const traces = [];

    for (const split of splits) {
      const splitRows = rows
        .filter((d) => d.splitCount === split)
        .sort(
          (a, b) =>
            invalOrder.indexOf(a.invalidationProfile) -
            invalOrder.indexOf(b.invalidationProfile),
        );

      traces.push({
        x: splitRows.map((d) => d.invalidationProfile),
        y: splitRows.map((d) => d.delta_ms),
        error_y: {
          type: "data",
          symmetric: false,
          array: splitRows.map((d) => d.ci_upper - d.delta_ms),
          arrayminus: splitRows.map((d) => d.delta_ms - d.ci_lower),
        },
        name: `${split}x`,
        type: "scatter",
        mode: "markers+lines",
        marker: { size: 8 },
      });
    }

    subplots.push({ payload, traces });
  }

  return subplots;
}

function buildDistributionTraces(chart) {
  return chart.data.map((panel) => ({
    label: panel.label,
    traces: [
      {
        y: panel.h1.values,
        name: "H1",
        type: "box",
        boxpoints: "outliers",
        marker: { color: "#636efa" },
      },
      {
        y: panel.h3.values,
        name: "H3",
        type: "box",
        boxpoints: "outliers",
        marker: { color: "#ef553b" },
      },
    ],
  }));
}

function generateHtml(
  heatmap,
  decomposition,
  retention,
  distributions,
  comparisons,
) {
  const heatmapSubplots = buildHeatmapTraces(heatmap);
  const decompSubplots = buildDecompositionTraces(decomposition);
  const retentionSubplots = buildRetentionTraces(retention);
  const distPanels = buildDistributionTraces(distributions);

  // Summary stats
  const total = comparisons.data.length;
  const sig = comparisons.data.filter((c) => c.significant).length;
  const pract = comparisons.data.filter(
    (c) => c.practically_significant,
  ).length;
  const config = comparisons.meta.analysisConfig;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Request Tax – Benchmark Report</title>
<script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #fafafa; color: #222; line-height: 1.5; padding: 2rem; max-width: 1400px; margin: 0 auto; }
  h1 { font-size: 1.8rem; margin-bottom: 0.5rem; }
  h2 { font-size: 1.3rem; margin: 2rem 0 0.5rem; border-bottom: 2px solid #ddd; padding-bottom: 0.3rem; }
  h3 { font-size: 1.1rem; margin: 1rem 0 0.3rem; color: #555; }
  p, .note { margin: 0.5rem 0; color: #555; font-size: 0.9rem; }
  .summary { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 1rem 1.5rem; margin: 1rem 0; display: flex; gap: 2rem; flex-wrap: wrap; }
  .summary .stat { text-align: center; }
  .summary .stat .value { font-size: 1.8rem; font-weight: 700; color: #333; }
  .summary .stat .label { font-size: 0.8rem; color: #888; text-transform: uppercase; }
  .chart-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(500px, 1fr)); gap: 1rem; margin: 1rem 0; }
  .chart-cell { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 1rem; }
  .chart-cell .plot { width: 100%; height: 350px; }
  .legend-note { font-size: 0.8rem; color: #888; margin-top: 0.5rem; }
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
  <div class="stat"><div class="value">${comparisons.data.length > 0 ? (comparisons.data.reduce((s, c) => s + c.delta_pct, 0) / comparisons.data.length).toFixed(1) + "%" : "–"}</div><div class="label">Mean Δ%</div></div>
</div>

<h2>Phase A – Request Granularity Heatmap</h2>
<p>${heatmap.description}</p>
<p class="legend-note">★ = practically significant, ● = statistically significant</p>
<div class="chart-grid">
${heatmapSubplots
  .map(
    (sp, i) => `
  <div class="chart-cell">
    <h3>${sp.profile}</h3>
    <div class="plot" id="heatmap-${i}"></div>
  </div>`,
  )
  .join("")}
</div>

<h2>Phase B – Cache Layer Decomposition</h2>
<p>${decomposition.description}</p>
<div class="chart-grid">
${decompSubplots
  .map(
    (sp, i) => `
  <div class="chart-cell">
    <h3>${sp.payload}KB</h3>
    <div class="plot" id="decomp-${i}"></div>
  </div>`,
  )
  .join("")}
</div>

<h2>Phase C – Invalidation Retention</h2>
<p>${retention.description}</p>
<div class="chart-grid">
${retentionSubplots
  .map(
    (sp, i) => `
  <div class="chart-cell">
    <h3>${sp.payload}KB</h3>
    <div class="plot" id="retention-${i}"></div>
  </div>`,
  )
  .join("")}
</div>

<h2>Distributions – Representative Scenarios</h2>
<p>${distributions.description}</p>
<div class="chart-grid">
${distPanels
  .map(
    (p, i) => `
  <div class="chart-cell">
    <h3>${p.label}</h3>
    <div class="plot" id="dist-${i}"></div>
  </div>`,
  )
  .join("")}
</div>

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

<script>
const plotConfig = { responsive: true, displayModeBar: false };
const defaultLayout = { margin: { t: 20, b: 40, l: 60, r: 20 }, font: { size: 11 } };

// Heatmaps
${heatmapSubplots
  .map(
    (sp, i) =>
      `Plotly.newPlot("heatmap-${i}", [${JSON.stringify(sp.trace)}], {...defaultLayout, margin: { t: 20, b: 50, l: 70, r: 80 }, xaxis: { title: "Requests", type: "category" }, yaxis: { title: "Payload" }}, plotConfig);`,
  )
  .join("\n")}

// Decomposition
${decompSubplots
  .map(
    (sp, i) =>
      `Plotly.newPlot("decomp-${i}", ${JSON.stringify(sp.traces)}, {...defaultLayout, yaxis: { title: "Δ median (ms)", zeroline: true }, showlegend: true, legend: { orientation: "h", y: -0.2 }}, plotConfig);`,
  )
  .join("\n")}

// Retention
${retentionSubplots
  .map(
    (sp, i) =>
      `Plotly.newPlot("retention-${i}", ${JSON.stringify(sp.traces)}, {...defaultLayout, yaxis: { title: "Δ median (ms)", zeroline: true }, showlegend: true, legend: { orientation: "h", y: -0.2 }}, plotConfig);`,
  )
  .join("\n")}

// Distributions
${distPanels
  .map(
    (p, i) =>
      `Plotly.newPlot("dist-${i}", ${JSON.stringify(p.traces)}, {...defaultLayout, yaxis: { title: "Page completion (ms)" }, showlegend: true}, plotConfig);`,
  )
  .join("\n")}
</script>
</body>
</html>`;
}

async function main() {
  const [heatmap, decomposition, retention, distributions, comparisons] =
    await Promise.all([
      loadChart("chart-phase-a-heatmap.json"),
      loadChart("chart-phase-b-decomposition.json"),
      loadChart("chart-phase-c-retention.json"),
      loadChart("chart-distributions.json"),
      loadChart("comparisons.json"),
    ]);

  const html = generateHtml(
    heatmap,
    decomposition,
    retention,
    distributions,
    comparisons,
  );

  const outPath = path.join(REPORTS_DIR, "index.html");
  await fs.mkdir(REPORTS_DIR, { recursive: true });
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
