#!/usr/bin/env node

/**
 * Generate self-contained Plotly chart HTML files from analysis JSON artifacts.
 *
 * Input:  results/analysis/chart-*.json
 * Output: results/charts/*.html  (one HTML per subplot)
 *
 * Each output is a standalone HTML page that can be opened directly,
 * embedded via <iframe>, or screenshot for export.
 *
 * Run: node harness/report/build-charts.js
 */

import fs from "node:fs/promises";
import path from "node:path";

const ANALYSIS_DIR = path.resolve("results", "analysis");
const CHARTS_DIR = path.resolve("results", "charts");

async function loadChart(name) {
  return JSON.parse(await fs.readFile(path.join(ANALYSIS_DIR, name), "utf8"));
}

async function tryLoadChart(name) {
  try {
    return await loadChart(name);
  } catch {
    return null;
  }
}

// ─── Standalone HTML wrapper ────────────────────────────────────────────

function wrapChart(plotlyJs, title = "") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<script src="https://cdn.plot.ly/plotly-2.35.2.min.js"><\/script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  #chart { width: 100vw; height: 100vh; }
</style>
</head>
<body>
<div id="chart"></div>
<script>
const config = { responsive: true, displayModeBar: false };
${plotlyJs}
<\/script>
</body>
</html>`;
}

async function writeChartFile(name, html) {
  const outPath = path.join(CHARTS_DIR, name);
  await fs.writeFile(outPath, html);
  return name;
}

// ─── Phase 1: Heatmaps ─────────────────────────────────────────────────

function buildHeatmapFiles(chart) {
  const profiles = [...new Set(chart.data.map((d) => d.profileName))].sort();
  const files = [];

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

    const trace = JSON.stringify({
      z,
      text,
      hoverinfo: "text",
      type: "heatmap",
      x: splits.map((s) => (s === 1 ? "1 request" : `${s} requests`)),
      y: payloads.map((p) => `${p}KB`),
      colorscale: [
        [0, "#1a9850"],
        [0.5, "#ffffbf"],
        [1, "#d73027"],
      ],
      zmid: 0,
      colorbar: { title: "Δ%" },
    });

    const js = `Plotly.newPlot("chart", [${trace}], {
  margin: { t: 10, b: 50, l: 80, r: 80 },
  font: { size: 12 },
  xaxis: { title: "Requests", type: "category" },
  yaxis: { title: "Payload" },
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(0,0,0,0)",
}, config);`;

    const name = `phase-1-heatmap-${profile}.html`;
    files.push({ name, html: wrapChart(js, `Phase 1: ${profile}`) });
  }
  return files;
}

// ─── Phase 1: Chunk-size crossover ──────────────────────────────────────

function buildCrossoverFile(chart) {
  const profiles = [...new Set(chart.data.map((d) => d.profileName))].sort();
  const colors = {
    baseline: "#636efa",
    "moderate-rtt": "#00cc96",
    "loss-0.5pct": "#ffa15a",
    "loss-1pct": "#ef553b",
    "loss-3pct": "#ab63fa",
  };

  const traces = profiles.map((profile) => {
    const rows = chart.data
      .filter((d) => d.profileName === profile)
      .sort((a, b) => a.chunkSizeKb - b.chunkSizeKb);
    return {
      x: rows.map((d) => d.chunkSizeKb),
      y: rows.map((d) => d.delta_pct),
      text: rows.map(
        (d) =>
          `${d.payloadKb}KB ÷ ${d.splitCount} = ${d.chunkSizeKb}KB/req<br>Δ${d.delta_pct.toFixed(1)}%<br>H1: ${d.median_h1.toFixed(0)}ms  H3: ${d.median_h3.toFixed(0)}ms`,
      ),
      hoverinfo: "text",
      name: profile,
      type: "scatter",
      mode: "markers+lines",
      marker: { size: 8, color: colors[profile] || "#888" },
      line: { color: colors[profile] || "#888", width: 2 },
    };
  });

  const js = `Plotly.newPlot("chart", ${JSON.stringify(traces)}, {
  margin: { t: 10, b: 60, l: 70, r: 20 },
  font: { size: 12 },
  xaxis: { title: "Chunk Size per Request (KB)", type: "log", dtick: 1 },
  yaxis: { title: "Δ% (H3 − H1)", zeroline: true, zerolinewidth: 2, zerolinecolor: "#888" },
  showlegend: true,
  legend: { orientation: "h", y: -0.15 },
  shapes: [{ type: "line", x0: 0, x1: 1, xref: "paper", y0: 0, y1: 0, line: { color: "#888", width: 2, dash: "dash" } }],
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(0,0,0,0)",
}, config);`;

  return [
    {
      name: "phase-1-chunk-crossover.html",
      html: wrapChart(js, "Phase 1: Chunk Size Crossover"),
    },
  ];
}

// ─── Phase 2: Retention ─────────────────────────────────────────────────

function buildRetentionFiles(chart) {
  const payloads = [...new Set(chart.data.map((d) => d.payloadKb))].sort(
    (a, b) => a - b,
  );
  const invalOrder = [
    "full-purge",
    "partial-purge-20pct",
    "partial-purge-40pct",
  ];
  const files = [];

  for (const payload of payloads) {
    const rows = chart.data.filter((d) => d.payloadKb === payload);
    const splits = [...new Set(rows.map((d) => d.splitCount))].sort(
      (a, b) => a - b,
    );

    const traces = splits.map((split) => {
      const sr = rows
        .filter((d) => d.splitCount === split)
        .sort(
          (a, b) =>
            invalOrder.indexOf(a.invalidationProfile) -
            invalOrder.indexOf(b.invalidationProfile),
        );
      return {
        x: sr.map((d) => d.invalidationProfile),
        y: sr.map((d) => d.delta_ms),
        error_y: {
          type: "data",
          symmetric: false,
          array: sr.map((d) => d.ci_upper - d.delta_ms),
          arrayminus: sr.map((d) => d.delta_ms - d.ci_lower),
        },
        name: `${split}x`,
        type: "scatter",
        mode: "markers+lines",
        marker: { size: 8 },
      };
    });

    const js = `Plotly.newPlot("chart", ${JSON.stringify(traces)}, {
  margin: { t: 10, b: 50, l: 70, r: 20 },
  font: { size: 12 },
  yaxis: { title: "Δ median (ms)", zeroline: true },
  showlegend: true,
  legend: { orientation: "h", y: -0.15 },
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(0,0,0,0)",
}, config);`;

    files.push({
      name: `phase-2-retention-${payload}kb.html`,
      html: wrapChart(js, `Phase 2: ${payload}KB`),
    });
  }
  return files;
}

// ─── Distributions ──────────────────────────────────────────────────────

function buildDistributionFiles(chart) {
  const files = [];

  for (const panel of chart.data) {
    const safeName = panel.label.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
    const traces = [
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
    ];

    const js = `Plotly.newPlot("chart", ${JSON.stringify(traces)}, {
  margin: { t: 10, b: 40, l: 60, r: 20 },
  font: { size: 12 },
  yaxis: { title: "Page completion (ms)" },
  showlegend: true,
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(0,0,0,0)",
}, config);`;

    files.push({
      name: `distribution-${safeName}.html`,
      html: wrapChart(js, panel.label),
    });
  }
  return files;
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  const [heatmap, crossover, retention, distributions] = await Promise.all([
    tryLoadChart("chart-phase-1-heatmap.json"),
    tryLoadChart("chart-phase-1-chunk-crossover.json"),
    tryLoadChart("chart-phase-2-retention.json"),
    tryLoadChart("chart-distributions.json"),
  ]);

  await fs.mkdir(CHARTS_DIR, { recursive: true });

  const allFiles = [];

  if (heatmap) allFiles.push(...buildHeatmapFiles(heatmap));
  if (crossover) allFiles.push(...buildCrossoverFile(crossover));
  if (retention) allFiles.push(...buildRetentionFiles(retention));
  if (distributions) allFiles.push(...buildDistributionFiles(distributions));

  // Write a manifest so consumers know what's available
  const manifest = allFiles.map((f) => f.name);
  await Promise.all([
    ...allFiles.map((f) => writeChartFile(f.name, f.html)),
    fs.writeFile(
      path.join(CHARTS_DIR, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    ),
  ]);

  console.log(`✓ ${allFiles.length} chart(s) written to results/charts/`);
  for (const f of allFiles) {
    console.log(`  ${f.name}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
