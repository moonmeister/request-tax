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

// ─── Phase 1: H3 Performance ────────────────────────────────────────────

function buildH3PerformanceFiles(chart) {
  const profiles = [...new Set(chart.data.map((d) => d.profileName))].sort();
  const payloads = [...new Set(chart.data.map((d) => d.payloadKb))].sort(
    (a, b) => a - b,
  );
  const payloadColors = {
    1: "#636efa",
    10: "#00cc96",
    100: "#ffa15a",
    1000: "#ef553b",
    10000: "#ab63fa",
  };

  const files = [];

  for (const profile of profiles) {
    const rows = chart.data.filter((d) => d.profileName === profile);

    const traces = payloads.map((payload) => {
      const pr = rows
        .filter((d) => d.payloadKb === payload)
        .sort((a, b) => a.splitCount - b.splitCount);
      const color = payloadColors[payload] || "#888";
      return {
        x: pr.map((d) => d.splitCount),
        y: pr.map((d) => d.median_h3),
        text: pr.map(
          (d) =>
            `${d.payloadKb}KB ÷ ${d.splitCount} = ${d.chunkSizeKb}KB/req<br>HTTP/3: ${d.median_h3.toFixed(1)}ms`,
        ),
        hoverinfo: "text",
        name: `${payload}KB`,
        type: "scatter",
        mode: "markers+lines",
        marker: { size: 8, color },
        line: { color, width: 2 },
      };
    });

    const js = `Plotly.newPlot("chart", ${JSON.stringify(traces)}, {
  margin: { t: 50, b: 60, l: 70, r: 20 },
  font: { size: 13 },
  xaxis: { title: "Split Count (requests)", type: "log", dtick: 1 },
  yaxis: { title: "Median Page Completion (ms)", type: "log" },
  title: { text: "HTTP/3 Download Time — ${profile}", font: { size: 15 } },
  showlegend: true,
  legend: { orientation: "h", y: -0.15 },
  paper_bgcolor: "#fff",
  plot_bgcolor: "#fff",
}, config);`;

    files.push({
      name: `phase-1-h3-performance-${profile}.html`,
      html: wrapChart(js, `Phase 1: HTTP/3 Performance — ${profile}`),
    });
  }

  return files;
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

// ─── Phase 2: Parity Map ───────────────────────────────────────────────

function buildPhase2ParityFiles(chart) {
  const xValues = [...new Set(chart.data.map((d) => d.h1MissPct))].sort(
    (a, b) => a - b,
  );
  const yValues = [...new Set(chart.data.map((d) => d.h3MissPct))].sort(
    (a, b) => a - b,
  );

  // Use string labels so Plotly treats the axis as categorical (equal cell sizes)
  const xLabels = xValues.map((v) => `H1 ${v}%`);
  const yLabels = yValues.map((v) => `H3 ${v}%`);

  const z = [];
  const text = [];
  for (const y of yValues) {
    const zRow = [];
    const tRow = [];
    for (const x of xValues) {
      const cell = chart.data.find(
        (d) => d.h1MissPct === x && d.h3MissPct === y,
      );
      if (!cell) {
        zRow.push(null);
        tRow.push("no data");
      } else {
        // Color by win rate: 100% = H3 always faster, 0% = H1 always faster
        zRow.push(cell.winRateH3Pct);
        tRow.push(
          `H1 miss: ${x}%  →  H3 miss: ${y}%<br>H3 faster in ${cell.winRateH3Pct.toFixed(0)}% of scenarios<br>Median Δ: ${cell.deltaMsMedian.toFixed(0)}ms (H3 − H1)<br>n=${cell.sampleCount} scenarios`,
        );
      }
    }
    z.push(zRow);
    text.push(tRow);
  }

  // Annotate each cell with its win-rate percentage
  const annotations = [];
  for (let yi = 0; yi < yValues.length; yi++) {
    for (let xi = 0; xi < xValues.length; xi++) {
      const cell = chart.data.find(
        (d) => d.h1MissPct === xValues[xi] && d.h3MissPct === yValues[yi],
      );
      if (!cell) continue;
      annotations.push({
        x: xLabels[xi],
        y: yLabels[yi],
        text: `${cell.winRateH3Pct.toFixed(0)}%`,
        showarrow: false,
        font: {
          size: 14,
          color: cell.winRateH3Pct > 55 ? "#fff" : "#333",
          weight: 700,
        },
      });
    }
  }

  const trace = {
    type: "heatmap",
    x: xLabels,
    y: yLabels,
    z,
    text,
    hoverinfo: "text",
    zmin: 0,
    zmax: 100,
    zmid: 50,
    colorscale: [
      [0, "#d73027"],
      [0.5, "#f7f7f7"],
      [1, "#1a9850"],
    ],
    colorbar: { title: "H3 wins (%)", ticksuffix: "%" },
  };

  const js = `Plotly.newPlot("chart", ${JSON.stringify([trace])}, {
  margin: { t: 40, b: 60, l: 90, r: 100 },
  font: { size: 13 },
  xaxis: { title: "H1 Cache Miss Rate", type: "category" },
  yaxis: { title: "H3 Cache Miss Rate", type: "category" },
  annotations: ${JSON.stringify(annotations)},
  paper_bgcolor: "#fff",
  plot_bgcolor: "#fff",
}, config);`;

  return [
    {
      name: "phase-2-parity-map.html",
      html: wrapChart(js, "Phase 2: H3 vs H1 Parity Map"),
    },
  ];
}

// ─── Phase 2: Equivalence Frontier ─────────────────────────────────────

function buildPhase2FrontierFiles(chart) {
  const summary = [...chart.data].sort((a, b) => a.h1MissPct - b.h1MissPct);
  const points = [...(chart.points || [])].sort(
    (a, b) => a.h1MissPct - b.h1MissPct || a.h3MissPct - b.h3MissPct,
  );

  const cloud = {
    type: "scatter",
    mode: "markers",
    name: "Scenario parity points",
    x: points.map((p) => p.h1MissPct),
    y: points.map((p) => p.h3MissPct),
    marker: { color: "#9ecae1", size: 8, opacity: 0.45 },
    text: points.map(
      (p) =>
        `${p.payloadKb}KB ÷ ${p.splitCount}<br>H1 miss ${p.h1MissPct}% ↔ H3 miss ${p.h3MissPct}%<br>Residual Δ: ${p.parityDeltaMs.toFixed(1)}ms`,
    ),
    hoverinfo: "text",
  };

  const lower = {
    type: "scatter",
    mode: "lines",
    name: "IQR lower",
    x: summary.map((s) => s.h1MissPct),
    y: summary.map((s) => s.equivalentH3MissP25),
    line: { width: 0 },
    hoverinfo: "skip",
    showlegend: false,
  };

  const upper = {
    type: "scatter",
    mode: "lines",
    name: "IQR band",
    x: summary.map((s) => s.h1MissPct),
    y: summary.map((s) => s.equivalentH3MissP75),
    fill: "tonexty",
    fillcolor: "rgba(31,119,180,0.18)",
    line: { width: 0 },
    text: summary.map(
      (s) =>
        `H1 miss ${s.h1MissPct}%<br>H3 equivalent median ${s.equivalentH3MissMedian.toFixed(1)}%<br>IQR ${s.equivalentH3MissP25.toFixed(1)}% to ${s.equivalentH3MissP75.toFixed(1)}%<br>Residual median Δ ${s.residualDeltaMsMedian.toFixed(1)}ms<br>n=${s.sampleCount}`,
    ),
    hoverinfo: "text",
    showlegend: false,
  };

  const medianLine = {
    type: "scatter",
    mode: "markers+lines",
    name: "Equivalent H3 miss (median)",
    x: summary.map((s) => s.h1MissPct),
    y: summary.map((s) => s.equivalentH3MissMedian),
    marker: { color: "#1f77b4", size: 9 },
    line: { color: "#1f77b4", width: 3 },
    text: summary.map(
      (s) =>
        `H1 miss ${s.h1MissPct}%<br>H3 equivalent median ${s.equivalentH3MissMedian.toFixed(1)}%<br>IQR ${s.equivalentH3MissP25.toFixed(1)}% to ${s.equivalentH3MissP75.toFixed(1)}%<br>Residual median Δ ${s.residualDeltaMsMedian.toFixed(1)}ms<br>n=${s.sampleCount}`,
    ),
    hoverinfo: "text",
  };

  const js = `Plotly.newPlot("chart", ${JSON.stringify([cloud, lower, upper, medianLine])}, {
  margin: { t: 40, b: 60, l: 70, r: 20 },
  font: { size: 12 },
  xaxis: { title: "H1 Cache Miss Rate (%)", range: [-3, 103], tickmode: "array", tickvals: [0, 20, 40, 100] },
  yaxis: { title: "Equivalent H3 Miss Rate (%)", range: [-3, 103], tickmode: "array", tickvals: [0, 20, 40, 100] },
  shapes: [{ type: "line", x0: 0, x1: 100, y0: 0, y1: 100, line: { color: "#666", width: 2, dash: "dot" } }],
  annotations: [{ x: 15, y: 90, text: "Above diagonal: H3 tolerates more misses", showarrow: false, font: { size: 11, color: "#444" } }],
  showlegend: true,
  legend: { orientation: "h", y: 1.1, yanchor: "bottom" },
  paper_bgcolor: "#fff",
  plot_bgcolor: "#fff",
}, config);`;

  return [
    {
      name: "phase-2-equivalence-frontier.html",
      html: wrapChart(js, "Phase 2: Equivalent-Miss Frontier"),
    },
  ];
}

// ─── Phase 2: Granularity Comparison ───────────────────────────────────

function buildPhase2GranularityFiles(chart) {
  const comparisons = [...new Set(chart.data.map((d) => d.comparisonLabel))];
  const payloads = [...new Set(chart.data.map((d) => d.payloadKb))].sort(
    (a, b) => a - b,
  );

  const comparisonLabels = comparisons;
  const payloadLabels = payloads.map((p) => `${p}KB`);

  const z = [];
  const text = [];
  for (const payload of payloads) {
    const zRow = [];
    const tRow = [];
    for (const comparison of comparisons) {
      const cell = chart.data.find(
        (d) => d.payloadKb === payload && d.comparisonLabel === comparison,
      );
      if (!cell) {
        zRow.push(null);
        tRow.push("no data");
      } else {
        zRow.push(cell.h3WinRatePct);
        tRow.push(
          `${payload}KB payload, ${comparison}<br>H3 (100 chunks) wins in ${cell.h3WinRatePct.toFixed(0)}% of profiles<br>Median Δ: ${cell.deltaMsMedian.toFixed(0)}ms (H3 − H1)<br>n=${cell.sampleCount} profiles`,
        );
      }
    }
    z.push(zRow);
    text.push(tRow);
  }

  const annotations = [];
  for (let pi = 0; pi < payloads.length; pi++) {
    for (let ci = 0; ci < comparisons.length; ci++) {
      const cell = chart.data.find(
        (d) =>
          d.payloadKb === payloads[pi] && d.comparisonLabel === comparisons[ci],
      );
      if (!cell) continue;
      annotations.push({
        x: comparisonLabels[ci],
        y: payloadLabels[pi],
        text: `${cell.h3WinRatePct.toFixed(0)}%`,
        showarrow: false,
        font: {
          size: 14,
          color: cell.h3WinRatePct > 55 ? "#fff" : "#333",
          weight: 700,
        },
      });
    }
  }

  const trace = {
    type: "heatmap",
    x: comparisonLabels,
    y: payloadLabels,
    z,
    text,
    hoverinfo: "text",
    zmin: 0,
    zmax: 100,
    zmid: 50,
    colorscale: [
      [0, "#d73027"],
      [0.5, "#f7f7f7"],
      [1, "#1a9850"],
    ],
    colorbar: { title: "H3 fine wins (%)", ticksuffix: "%" },
  };

  const js = `Plotly.newPlot("chart", ${JSON.stringify([trace])}, {
  margin: { t: 40, b: 100, l: 70, r: 100 },
  font: { size: 13 },
  xaxis: { title: "Comparison: H1 coarse (high miss) vs H3 fine (lower miss)", type: "category" },
  yaxis: { title: "Payload Size", type: "category" },
  annotations: ${JSON.stringify(annotations)},
  paper_bgcolor: "#fff",
  plot_bgcolor: "#fff",
}, config);`;

  return [
    {
      name: "phase-2-granularity-comparison.html",
      html: wrapChart(
        js,
        "Phase 2: Granularity Comparison (H1 coarse vs H3 fine)",
      ),
    },
  ];
}

// ─── Phase 2: Miss Rate Sensitivity ─────────────────────────────────────

function buildPhase2MissSensitivityFiles(chart) {
  const payloads = [...new Set(chart.data.map((d) => d.payloadKb))].sort(
    (a, b) => a - b,
  );

  const profileColors = {
    "H1 split=10": "#636efa",
    "H3 split=100": "#ef553b",
  };

  const files = [];

  for (const payload of payloads) {
    const rows = chart.data
      .filter((d) => d.payloadKb === payload)
      .sort((a, b) => a.missPct - b.missPct);

    const h1Rows = rows.filter((d) => d.splitCount === 10);
    const h3Rows = rows.filter((d) => d.splitCount === 100);

    const traces = [
      {
        x: h1Rows.map((d) => d.missPct),
        y: h1Rows.map((d) => d.median_h1),
        mode: "lines+markers",
        name: "H1 (10 chunks, coarse)",
        line: { color: "#636efa", width: 2 },
        marker: { size: 8 },
        hovertemplate:
          "H1 coarse<br>Miss: %{x}%<br>Time: %{y:.0f}ms<extra></extra>",
      },
      {
        x: h3Rows.map((d) => d.missPct),
        y: h3Rows.map((d) => d.median_h3),
        mode: "lines+markers",
        name: "H3 (100 chunks, fine)",
        line: { color: "#ef553b", width: 2 },
        marker: { size: 8 },
        hovertemplate:
          "H3 fine<br>Miss: %{x}%<br>Time: %{y:.0f}ms<extra></extra>",
      },
    ];

    const js = `Plotly.newPlot("chart", ${JSON.stringify(traces)}, {
  margin: { t: 50, b: 60, l: 70, r: 20 },
  font: { size: 13 },
  xaxis: { title: "Cache Miss Rate (%)", tickvals: [0, 20, 40, 100], ticktext: ["0%", "20%", "40%", "100%"] },
  yaxis: { title: "Page Completion Time (ms)" },
  title: { text: "Miss Rate Sensitivity — ${payload}KB payload", font: { size: 15 } },
  showlegend: true,
  paper_bgcolor: "#fff",
  plot_bgcolor: "#fff",
}, config);`;

    files.push({
      name: `phase-2-miss-sensitivity-${payload}kb.html`,
      html: wrapChart(js, `Phase 2: Miss Rate Sensitivity — ${payload}KB`),
    });
  }

  return files;
}

// ─── Phase 2: Split Count Effect ────────────────────────────────────────

function buildPhase2SplitEffectFiles(chart) {
  const payloads = [...new Set(chart.data.map((d) => d.payloadKb))].sort(
    (a, b) => a - b,
  );

  const profileColors = {
    "fully-cached": "#1a9850",
    "partial-purge-20pct": "#91cf60",
    "partial-purge-40pct": "#fee08b",
    "full-purge": "#d73027",
  };
  const profileLabels = {
    "fully-cached": "0% miss (fully cached)",
    "partial-purge-20pct": "20% miss",
    "partial-purge-40pct": "40% miss",
    "full-purge": "100% miss (full purge)",
  };

  const files = [];

  for (const payload of payloads) {
    const rows = chart.data
      .filter((d) => d.payloadKb === payload)
      .sort((a, b) => a.splitCount - b.splitCount);
    const profiles = [...new Set(rows.map((d) => d.invalidationProfile))];

    const traces = profiles.map((prof) => {
      const profRows = rows
        .filter((d) => d.invalidationProfile === prof)
        .sort((a, b) => a.splitCount - b.splitCount);
      return {
        x: profRows.map((d) => d.splitCount),
        y: profRows.map((d) => d.h3_h1_ratio),
        mode: "lines+markers",
        name: profileLabels[prof] || prof,
        line: { color: profileColors[prof] || "#888", width: 2 },
        marker: { size: 8 },
        hovertemplate: `${profileLabels[prof] || prof}<br>Split: %{x}<br>H3/H1 ratio: %{y:.3f}<extra></extra>`,
      };
    });

    // Add parity reference line
    traces.push({
      x: [1, 10, 100, 1000],
      y: [1, 1, 1, 1],
      mode: "lines",
      name: "Parity (H3 = H1)",
      line: { color: "#999", width: 1, dash: "dot" },
      hoverinfo: "skip",
    });

    const js = `Plotly.newPlot("chart", ${JSON.stringify(traces)}, {
  margin: { t: 50, b: 60, l: 80, r: 20 },
  font: { size: 13 },
  xaxis: { title: "Split Count (chunks)", type: "log", tickvals: [1, 10, 100, 1000], ticktext: ["1", "10", "100", "1000"] },
  yaxis: { title: "H3 / H1 time ratio (< 1.0 = H3 faster)" },
  title: { text: "H3/H1 Ratio by Split Count — ${payload}KB payload", font: { size: 15 } },
  showlegend: true,
  paper_bgcolor: "#fff",
  plot_bgcolor: "#fff",
}, config);`;

    files.push({
      name: `phase-2-split-effect-${payload}kb.html`,
      html: wrapChart(js, `Phase 2: Split Count Effect — ${payload}KB`),
    });
  }

  return files;
}

// ─── Phase 2: Granularity Delta Heatmap ─────────────────────────────────

function buildPhase2GranularityDeltaFiles(chart) {
  const comparisons = [...new Set(chart.data.map((d) => d.comparisonLabel))];
  const payloads = [...new Set(chart.data.map((d) => d.payloadKb))].sort(
    (a, b) => a - b,
  );

  const payloadLabels = payloads.map((p) => `${p}KB`);

  const z = [];
  const text = [];
  const maxAbs = Math.max(...chart.data.map((d) => Math.abs(d.deltaMsMedian)));

  for (const payload of payloads) {
    const zRow = [];
    const tRow = [];
    for (const cmp of comparisons) {
      const cell = chart.data.find(
        (d) => d.payloadKb === payload && d.comparisonLabel === cmp,
      );
      if (!cell) {
        zRow.push(null);
        tRow.push("no data");
        continue;
      }
      zRow.push(cell.deltaMsMedian);
      const dir = cell.deltaMsMedian < 0 ? "H3 faster" : "H1 faster";
      tRow.push(
        `${payload}KB — ${cmp.replace(/\n/g, " ")}<br>H1 (coarse): ${cell.h1_ms.toFixed(0)}ms<br>H3 (fine): ${cell.h3_ms.toFixed(0)}ms<br>Δ: ${cell.deltaMsMedian > 0 ? "+" : ""}${cell.deltaMsMedian.toFixed(0)}ms (${dir})`,
      );
    }
    z.push(zRow);
    text.push(tRow);
  }

  const annotations = [];
  for (let pi = 0; pi < payloads.length; pi++) {
    for (let ci = 0; ci < comparisons.length; ci++) {
      const cell = chart.data.find(
        (d) =>
          d.payloadKb === payloads[pi] && d.comparisonLabel === comparisons[ci],
      );
      if (!cell) continue;
      const val = cell.deltaMsMedian;
      const label = `${val > 0 ? "+" : ""}${val.toFixed(0)}ms`;
      annotations.push({
        x: comparisons[ci],
        y: payloadLabels[pi],
        text: label,
        showarrow: false,
        font: {
          size: 12,
          color: Math.abs(val) > maxAbs * 0.5 ? "#fff" : "#333",
          weight: 700,
        },
      });
    }
  }

  const trace = {
    type: "heatmap",
    x: comparisons,
    y: payloadLabels,
    z,
    text,
    hoverinfo: "text",
    zmin: -maxAbs,
    zmax: maxAbs,
    zmid: 0,
    colorscale: [
      [0, "#1a9850"],
      [0.5, "#f7f7f7"],
      [1, "#d73027"],
    ],
    colorbar: { title: "H3 − H1 (ms)", ticksuffix: "ms" },
  };

  const js = `Plotly.newPlot("chart", ${JSON.stringify([trace])}, {
  margin: { t: 40, b: 120, l: 70, r: 120 },
  font: { size: 13 },
  xaxis: { title: "H1 coarse miss % vs H3 fine miss %", type: "category" },
  yaxis: { title: "Payload Size", type: "category" },
  annotations: ${JSON.stringify(annotations)},
  paper_bgcolor: "#fff",
  plot_bgcolor: "#fff",
}, config);`;

  return [
    {
      name: "phase-2-granularity-delta.html",
      html: wrapChart(
        js,
        "Phase 2: Granularity Strategy — Speed Difference (ms)",
      ),
    },
  ];
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
  const [heatmap, crossover, h1Scaling, h3Performance, distributions] =
    await Promise.all([
      tryLoadChart("chart-phase-1-heatmap.json"),
      tryLoadChart("chart-phase-1-chunk-crossover.json"),
      tryLoadChart("chart-phase-1-scaling.json"),
      tryLoadChart("chart-phase-1-h3-performance.json"),
      tryLoadChart("chart-distributions.json"),
    ]);

  await fs.mkdir(CHARTS_DIR, { recursive: true });

  const allFiles = [];

  if (heatmap) allFiles.push(...buildHeatmapFiles(heatmap));
  if (crossover) allFiles.push(...buildCrossoverFile(crossover));
  if (h1Scaling) allFiles.push(...buildH1ScalingFile(h1Scaling));
  if (h3Performance) allFiles.push(...buildH3PerformanceFiles(h3Performance));
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
