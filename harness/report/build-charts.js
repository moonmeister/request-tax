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
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #fff; }
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

  // Compute global zmin/zmax so all heatmaps share the same color scale
  const allDeltas = chart.data.map((d) => d.delta_pct).filter((v) => v != null);
  const globalMax = Math.max(
    Math.abs(Math.min(...allDeltas)),
    Math.abs(Math.max(...allDeltas)),
  );

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
      zmin: -globalMax,
      zmax: globalMax,
      colorbar: { title: "Δ%" },
    });

    const js = `Plotly.newPlot("chart", [${trace}], {
  margin: { t: 10, b: 50, l: 80, r: 80 },
  font: { size: 12 },
  xaxis: { title: "Requests", type: "category" },
  yaxis: { title: "Payload" },
  paper_bgcolor: "#fff",
  plot_bgcolor: "#fff",
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
  paper_bgcolor: "#fff",
  plot_bgcolor: "#fff",
}, config);`;

  return [
    {
      name: "phase-1-chunk-crossover.html",
      html: wrapChart(js, "Phase 1: Chunk Size Crossover"),
    },
  ];
}

// ─── Phase 1: Request Scaling ───────────────────────────────────────────

function buildH1ScalingFile(chart) {
  const payloads = [...new Set(chart.data.map((d) => d.payloadKb))].sort(
    (a, b) => a - b,
  );
  const colors = {
    1: "#636efa",
    10: "#00cc96",
    100: "#ffa15a",
    1000: "#ef553b",
    10000: "#ab63fa",
  };

  const traces = payloads.flatMap((payload) => {
    const rows = chart.data
      .filter((d) => d.payloadKb === payload)
      .sort((a, b) => a.splitCount - b.splitCount);
    const color = colors[payload] || "#888";
    return [
      {
        x: rows.map((d) => d.splitCount),
        y: rows.map((d) => d.median_h1),
        text: rows.map(
          (d) =>
            `${d.payloadKb}KB ÷ ${d.splitCount} = ${d.chunkSizeKb}KB/req<br>HTTP/1.1: ${d.median_h1.toFixed(0)}ms`,
        ),
        hoverinfo: "text",
        name: `${payload}KB HTTP/1.1`,
        legendgroup: `${payload}KB`,
        _proto: "h1",
        type: "scatter",
        mode: "markers+lines",
        marker: { size: 8, color },
        line: { color, width: 2 },
      },
      {
        x: rows.map((d) => d.splitCount),
        y: rows.map((d) => d.median_h3),
        text: rows.map(
          (d) =>
            `${d.payloadKb}KB ÷ ${d.splitCount} = ${d.chunkSizeKb}KB/req<br>HTTP/3: ${d.median_h3.toFixed(0)}ms`,
        ),
        hoverinfo: "text",
        name: `${payload}KB HTTP/3`,
        legendgroup: `${payload}KB`,
        _proto: "h3",
        type: "scatter",
        mode: "markers+lines",
        marker: { size: 8, symbol: "diamond", color },
        line: { color, width: 2, dash: "dash" },
      },
    ];
  });

  // URL param ?show=h1 (default), ?show=h3, or ?show=both
  const js = `
var show = new URLSearchParams(location.search).get("show") || "both";
var traces = ${JSON.stringify(traces)};
traces.forEach(function(t) {
  if (show === "both") { t.visible = true; }
  else if (show === "h3") { t.visible = t._proto === "h3" ? true : "legendonly"; }
  else { t.visible = t._proto === "h1" ? true : "legendonly"; }
  delete t._proto;
});
Plotly.newPlot("chart", traces, {
  margin: { t: 10, b: 60, l: 70, r: 20 },
  font: { size: 12 },
  xaxis: { title: "Split Count (requests)", type: "log", dtick: 1 },
  yaxis: { title: "Median Page Completion (ms)", type: "log" },
  showlegend: true,
  legend: { orientation: "h", y: -0.15 },
  paper_bgcolor: "#fff",
  plot_bgcolor: "#fff",
}, config);`;

  return [
    {
      name: "phase-1-scaling.html",
      html: wrapChart(js, "Phase 1: Request Scaling"),
    },
  ];
}

// ─── Phase 2: Retention ─────────────────────────────────────────────────

function buildRetentionFiles(chart) {
  const invalOrder = [
    "fully-cached",
    "partial-purge-20pct",
    "partial-purge-40pct",
    "full-purge",
  ];
  const colors = {
    "fully-cached": "#636efa",
    "partial-purge-20pct": "#00cc96",
    "partial-purge-40pct": "#ffa15a",
    "full-purge": "#ef553b",
  };
  const labels = {
    "fully-cached": "Fully Cached",
    "partial-purge-20pct": "20% Purged",
    "partial-purge-40pct": "40% Purged",
    "full-purge": "Full Purge",
  };

  const profiles = invalOrder.filter((p) =>
    chart.data.some((d) => d.invalidationProfile === p),
  );

  function buildTraces(rows, xField) {
    const traces = [];
    for (const profile of profiles) {
      const pr = rows
        .filter((d) => d.invalidationProfile === profile)
        .sort((a, b) => a[xField] - b[xField]);
      if (pr.length === 0) continue;
      const label = labels[profile] || profile;
      const color = colors[profile] || "#888";
      const hoverText = (d, proto) =>
        `${d.payloadKb}KB ÷ ${d.splitCount} = ${d.chunkSizeKb}KB/req<br>${proto}: ${d[proto === "H1" ? "median_h1" : "median_h3"].toFixed(0)}ms<br>${label}`;
      // H1 line (solid)
      traces.push({
        x: pr.map((d) => d[xField]),
        y: pr.map((d) => d.median_h1),
        text: pr.map((d) => hoverText(d, "H1")),
        hoverinfo: "text",
        name: `${label} – H1`,
        type: "scatter",
        mode: "markers+lines",
        marker: { size: 8, color, symbol: "circle" },
        line: { color, width: 2, dash: "solid" },
        legendgroup: profile,
      });
      // H3 line (dashed)
      traces.push({
        x: pr.map((d) => d[xField]),
        y: pr.map((d) => d.median_h3),
        text: pr.map((d) => hoverText(d, "H3")),
        hoverinfo: "text",
        name: `${label} – H3`,
        type: "scatter",
        mode: "markers+lines",
        marker: { size: 8, color, symbol: "diamond" },
        line: { color, width: 2, dash: "dash" },
        legendgroup: profile,
      });
    }
    return traces;
  }

  function chartJs(traces, xTitle, xType) {
    return `Plotly.newPlot("chart", ${JSON.stringify(traces)}, {
  margin: { t: 40, b: 50, l: 70, r: 20 },
  font: { size: 12 },
  xaxis: { title: "${xTitle}", type: "${xType}", dtick: 1 },
  yaxis: { title: "Median Page Completion (ms)", type: "log" },
  showlegend: true,
  legend: { orientation: "h", y: 1.05, yanchor: "bottom" },
  paper_bgcolor: "#fff",
  plot_bgcolor: "#fff",
}, config);`;
  }

  const files = [];

  // Overview: all data, chunk size on x-axis
  const overviewTraces = buildTraces(chart.data, "chunkSizeKb");
  files.push({
    name: "phase-2-retention.html",
    html: wrapChart(
      chartJs(overviewTraces, "Chunk Size per Request (KB)", "log"),
      "Phase 2: Cache Granularity Under Invalidation",
    ),
  });

  // Per-payload: split count on x-axis
  const payloads = [...new Set(chart.data.map((d) => d.payloadKb))].sort(
    (a, b) => a - b,
  );
  for (const payload of payloads) {
    const rows = chart.data.filter((d) => d.payloadKb === payload);
    if (rows.length === 0) continue;
    const traces = buildTraces(rows, "splitCount");
    files.push({
      name: `phase-2-retention-${payload}kb.html`,
      html: wrapChart(
        chartJs(traces, "Split Count (chunks)", "log"),
        `Phase 2: ${payload}KB – Cache Invalidation`,
      ),
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
  paper_bgcolor: "#fff",
  plot_bgcolor: "#fff",
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
  const [heatmap, crossover, h1Scaling, retention, distributions] =
    await Promise.all([
      tryLoadChart("chart-phase-1-heatmap.json"),
      tryLoadChart("chart-phase-1-chunk-crossover.json"),
      tryLoadChart("chart-phase-1-scaling.json"),
      tryLoadChart("chart-phase-2-retention.json"),
      tryLoadChart("chart-distributions.json"),
    ]);

  await fs.mkdir(CHARTS_DIR, { recursive: true });

  const allFiles = [];

  if (heatmap) allFiles.push(...buildHeatmapFiles(heatmap));
  if (crossover) allFiles.push(...buildCrossoverFile(crossover));
  if (h1Scaling) allFiles.push(...buildH1ScalingFile(h1Scaling));
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
