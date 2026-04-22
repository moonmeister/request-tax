#!/usr/bin/env node

/**
 * Generate chart-ready JSON contracts from analysis data.
 *
 * Inputs:
 *   results/analysis/comparisons.json
 *   results/analysis/runs.json
 *
 * Outputs:
 *   results/analysis/chart-phase-1-heatmap.json
 *   results/analysis/chart-phase-2-retention.json
 *   results/analysis/chart-distributions.json
 */

import fs from "node:fs/promises";
import path from "node:path";

const ANALYSIS_DIR = path.resolve("results", "analysis");

async function loadJson(name) {
  return JSON.parse(await fs.readFile(path.join(ANALYSIS_DIR, name), "utf8"));
}

function writeChart(name, data) {
  return fs.writeFile(
    path.join(ANALYSIS_DIR, name),
    JSON.stringify(data, null, 2),
  );
}

/**
 * Phase 1 heatmap: H3 relative effect by payload × split, faceted by network profile.
 * Includes early-hints phase data alongside phase 1.
 */
function buildPhase1Heatmap(comparisons) {
  const rows = comparisons
    .filter((c) => c.phase === "1" || c.phase === "early-hints")
    .map((c) => ({
      phase: c.phase,
      profileName: c.profileName,
      payloadKb: c.payloadKb,
      splitCount: c.splitCount,
      median_h1: c.median_h1,
      median_h3: c.median_h3,
      delta_ms: c.delta_ms,
      delta_pct: c.delta_pct,
      ci_lower: c.ci_lower,
      ci_upper: c.ci_upper,
      significant: c.significant,
      practically_significant: c.practically_significant,
    }));

  return {
    chartType: "heatmap",
    title: "H3 vs H1: Relative Effect by Payload and Split Count",
    description:
      "Each cell shows the percentage change in median page completion time when using H3 instead of H1. Negative values indicate H3 is faster.",
    axes: {
      x: { field: "splitCount", label: "Split Count" },
      y: { field: "payloadKb", label: "Payload (KB)" },
      facet: { field: "profileName", label: "Network Profile" },
      color: { field: "delta_pct", label: "Δ%" },
    },
    data: rows,
  };
}

/**
 * Phase 2 retention: does the H3 split advantage survive cache invalidation?
 */
function buildPhase2Retention(comparisons) {
  // Get phase 1 baseline deltas for comparison
  const baselineByCell = new Map();
  for (const c of comparisons) {
    if (c.phase !== "1" || c.profileName !== "baseline") continue;
    const key = `${c.payloadKb}|${c.splitCount}`;
    baselineByCell.set(key, c.delta_ms);
  }

  const rows = comparisons
    .filter((c) => c.phase === "2")
    .map((c) => {
      const key = `${c.payloadKb}|${c.splitCount}`;
      const baselineDelta = baselineByCell.get(key);
      const retainedGainPct =
        baselineDelta && baselineDelta !== 0
          ? (c.delta_ms / baselineDelta) * 100
          : null;

      return {
        invalidationProfile: c.invalidationProfile,
        payloadKb: c.payloadKb,
        splitCount: c.splitCount,
        median_h1: c.median_h1,
        median_h3: c.median_h3,
        delta_ms: c.delta_ms,
        delta_pct: c.delta_pct,
        ci_lower: c.ci_lower,
        ci_upper: c.ci_upper,
        significant: c.significant,
        practically_significant: c.practically_significant,
        baselineDelta_ms: baselineDelta ?? null,
        retainedGainPct,
      };
    });

  return {
    chartType: "grouped-bar",
    title: "H3 vs H1: Effect Retention Under Cache Invalidation",
    description:
      "How much of the H3 advantage from Phase 1 survives full and partial cache purges. retainedGainPct shows the ratio of the invalidation delta to the baseline delta.",
    axes: {
      x: { field: "invalidationProfile", label: "Invalidation Profile" },
      y: { field: "delta_ms", label: "Δ Median (ms)" },
      facet: { field: "payloadKb", label: "Payload (KB)" },
      group: { field: "splitCount", label: "Split Count" },
    },
    data: rows,
  };
}

/**
 * Distribution panel: raw page completion times for representative scenario cells.
 * Picks cells that span the payload/split range for phase 1 baseline.
 */
function buildDistributions(runs) {
  // Representative cells: baseline profile, phase 1/early-hints, spread of payloads and splits
  const targets = [
    { payloadKb: 10, splitCount: 1 },
    { payloadKb: 10, splitCount: 10 },
    { payloadKb: 100, splitCount: 1 },
    { payloadKb: 100, splitCount: 100 },
    { payloadKb: 1000, splitCount: 1 },
    { payloadKb: 1000, splitCount: 100 },
    { payloadKb: 10000, splitCount: 1 },
    { payloadKb: 10000, splitCount: 100 },
  ];

  const panels = [];

  for (const { payloadKb, splitCount } of targets) {
    const cellRuns = runs.filter(
      (r) =>
        r.profileName === "baseline" &&
        (r.phase === "1" || r.phase === "early-hints") &&
        r.payloadKb === payloadKb &&
        r.splitCount === splitCount &&
        !r.cacheProfile &&
        !r.invalidationProfile,
    );

    const h1Times = cellRuns
      .filter((r) => r.protocol === "h1")
      .map((r) => r.pageCompletionTime);
    const h3Times = cellRuns
      .filter((r) => r.protocol === "h3")
      .map((r) => r.pageCompletionTime);

    if (h1Times.length === 0 && h3Times.length === 0) continue;

    panels.push({
      payloadKb,
      splitCount,
      label: `${payloadKb}KB × ${splitCount} chunks`,
      h1: { n: h1Times.length, values: h1Times },
      h3: { n: h3Times.length, values: h3Times },
    });
  }

  return {
    chartType: "box",
    title: "Page Completion Time Distributions",
    description:
      "Raw run-level distributions for representative baseline scenarios. Useful for assessing variance and outliers alongside aggregate comparisons.",
    data: panels,
  };
}

/**
 * Phase 1 chunk-size crossover: shows H3 Δ% as a function of per-request
 * chunk size (payload / splitCount), with one line per network profile.
 * Makes the crossover point where H3 flips from faster to slower immediately
 * visible — the real driver is individual chunk size, not payload or split
 * count in isolation.
 */
function buildPhase1ChunkCrossover(comparisons) {
  const rows = comparisons
    .filter((c) => c.phase === "1")
    .map((c) => ({
      profileName: c.profileName,
      payloadKb: c.payloadKb,
      splitCount: c.splitCount,
      chunkSizeKb: c.payloadKb / c.splitCount,
      median_h1: c.median_h1,
      median_h3: c.median_h3,
      delta_ms: c.delta_ms,
      delta_pct: c.delta_pct,
      ci_lower: c.ci_lower,
      ci_upper: c.ci_upper,
      significant: c.significant,
      practically_significant: c.practically_significant,
    }))
    .sort((a, b) => a.chunkSizeKb - b.chunkSizeKb);

  return {
    chartType: "line",
    title: "H3 vs H1: Effect by Per-Request Chunk Size",
    description:
      "Each point shows the percentage change in median completion time (H3 − H1) as a function of the individual chunk size sent per request (payload ÷ split count). Lines are grouped by network profile. The zero line marks parity; below zero H3 is faster, above zero H1 is faster. This reveals that chunk size — not total payload or request count alone — is the primary driver of H3's advantage.",
    axes: {
      x: {
        field: "chunkSizeKb",
        label: "Chunk Size per Request (KB)",
        scale: "log",
      },
      y: { field: "delta_pct", label: "Δ% (H3 − H1)" },
      color: { field: "profileName", label: "Network Profile" },
    },
    data: rows,
  };
}

async function main() {
  const [comparisonsFile, runsFile] = await Promise.all([
    loadJson("comparisons.json"),
    loadJson("runs.json"),
  ]);

  const comparisons = comparisonsFile.data;
  const runs = runsFile.data;

  const charts = [
    ["chart-phase-1-heatmap.json", buildPhase1Heatmap(comparisons)],
    [
      "chart-phase-1-chunk-crossover.json",
      buildPhase1ChunkCrossover(comparisons),
    ],
    ["chart-phase-2-retention.json", buildPhase2Retention(comparisons)],
    ["chart-distributions.json", buildDistributions(runs)],
  ];

  await Promise.all(charts.map(([name, data]) => writeChart(name, data)));

  for (const [name, data] of charts) {
    const count = Array.isArray(data.data) ? data.data.length : 0;
    console.log(`  ${name}: ${count} rows`);
  }

  console.log(`✓ ${charts.length} chart files written`);
}

main();
