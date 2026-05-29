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
import { median, percentile } from "./stats.js";

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
  const phase2 = comparisons
    .filter((c) => c.phase === "2")
    .filter((c) => c.splitCount > 1);

  // Build baseline from fully-cached Phase 2 rows for retainedGainPct
  const baselineByCell = new Map();
  for (const c of phase2) {
    if (c.invalidationProfile !== "fully-cached") continue;
    const key = `${c.payloadKb}|${c.splitCount}`;
    baselineByCell.set(key, c);
  }

  const rows = phase2.map((c) => {
    const key = `${c.payloadKb}|${c.splitCount}`;
    const baseline = baselineByCell.get(key);
    const baselineDelta = baseline?.delta_ms;
    const retainedGainPct =
      c.invalidationProfile === "fully-cached"
        ? 100
        : baselineDelta && baselineDelta !== 0
          ? (c.delta_ms / baselineDelta) * 100
          : null;

    return {
      invalidationProfile: c.invalidationProfile,
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
      baselineDelta_ms: baselineDelta ?? null,
      retainedGainPct,
    };
  });

  return {
    chartType: "line",
    title: "H3 vs H1: Cache Granularity Effect Under Invalidation",
    description:
      "Each line represents a cache invalidation scenario. X-axis is chunk size (payload ÷ split count). Smaller chunks mean more granular caching. The fully-cached line is the zero-invalidation baseline. Below zero H3 is faster.",
    axes: {
      x: {
        field: "chunkSizeKb",
        label: "Chunk Size per Request (KB)",
        scale: "log",
      },
      y: { field: "delta_pct", label: "Δ% (H3 − H1)" },
      color: { field: "invalidationProfile", label: "Invalidation Profile" },
    },
    data: rows,
  };
}

function invalidationToMissPct(invalidationProfile) {
  const map = {
    "fully-cached": 0,
    "partial-purge-20pct": 20,
    "partial-purge-40pct": 40,
    "full-purge": 100,
  };
  return map[invalidationProfile] ?? null;
}

/**
 * Phase 2 parity matrix: compares H3 and H1 at different cache miss rates.
 *
 * Each cell answers: for the same scenario (payload/split/profile),
 * how much faster/slower is H3 at miss rate y vs H1 at miss rate x?
 */
function buildPhase2ParityMatrix(comparisons) {
  const phase2 = comparisons
    .filter((c) => c.phase === "2")
    .filter((c) => c.splitCount > 1)
    .map((c) => ({
      ...c,
      missPct: invalidationToMissPct(c.invalidationProfile),
    }))
    .filter((c) => c.missPct != null);

  const byScenario = new Map();
  for (const row of phase2) {
    const key = `${row.profileName}|${row.payloadKb}|${row.splitCount}`;
    if (!byScenario.has(key)) byScenario.set(key, []);
    byScenario.get(key).push(row);
  }

  const pairSamples = new Map();

  for (const rows of byScenario.values()) {
    for (const h1Row of rows) {
      for (const h3Row of rows) {
        const key = `${h1Row.missPct}|${h3Row.missPct}`;
        if (!pairSamples.has(key)) pairSamples.set(key, []);
        pairSamples.get(key).push({
          h1MissPct: h1Row.missPct,
          h3MissPct: h3Row.missPct,
          h1Ms: h1Row.median_h1,
          h3Ms: h3Row.median_h3,
          parityDeltaMs: h3Row.median_h3 - h1Row.median_h1,
          payloadKb: h1Row.payloadKb,
          splitCount: h1Row.splitCount,
          profileName: h1Row.profileName,
        });
      }
    }
  }

  const rows = [];
  for (const [key, samples] of pairSamples) {
    const [h1MissPct, h3MissPct] = key.split("|").map(Number);
    const deltas = samples.map((s) => s.parityDeltaMs);
    const h3Wins = samples.filter((s) => s.parityDeltaMs < 0).length;
    rows.push({
      h1MissPct,
      h3MissPct,
      deltaMsMedian: median(deltas),
      deltaMsP25: percentile(deltas, 25),
      deltaMsP75: percentile(deltas, 75),
      winRateH3Pct: (h3Wins / samples.length) * 100,
      sampleCount: samples.length,
    });
  }

  rows.sort((a, b) => a.h1MissPct - b.h1MissPct || a.h3MissPct - b.h3MissPct);

  return {
    chartType: "heatmap",
    title: "Phase 2 Parity Map: H3 Miss Rate vs H1 Miss Rate",
    description:
      "Each cell compares H3 at a given miss rate (y-axis) against H1 at a given miss rate (x-axis) within the same scenario cells. Values show median parity delta in ms (H3 − H1). Negative means H3 is faster.",
    axes: {
      x: { field: "h1MissPct", label: "H1 Cache Miss Rate (%)" },
      y: { field: "h3MissPct", label: "H3 Cache Miss Rate (%)" },
      color: { field: "deltaMsMedian", label: "Parity Δms (H3 − H1)" },
    },
    data: rows,
  };
}

/**
 * Phase 2 frontier: for each H1 miss rate, find the closest H3 miss-rate
 * parity point (minimum absolute delta ms) per scenario.
 */
function buildPhase2EquivalenceFrontier(comparisons) {
  const phase2 = comparisons
    .filter((c) => c.phase === "2")
    .filter((c) => c.splitCount > 1)
    .map((c) => ({
      ...c,
      missPct: invalidationToMissPct(c.invalidationProfile),
    }))
    .filter((c) => c.missPct != null);

  const byScenario = new Map();
  for (const row of phase2) {
    const key = `${row.profileName}|${row.payloadKb}|${row.splitCount}`;
    if (!byScenario.has(key)) byScenario.set(key, []);
    byScenario.get(key).push(row);
  }

  const matches = [];

  for (const rows of byScenario.values()) {
    const h1Rows = rows;
    const h3Rows = rows;

    for (const h1Row of h1Rows) {
      let best = null;
      for (const h3Row of h3Rows) {
        const parityDeltaMs = h3Row.median_h3 - h1Row.median_h1;
        const absDelta = Math.abs(parityDeltaMs);
        if (!best || absDelta < best.absDelta) {
          best = {
            h1MissPct: h1Row.missPct,
            h3MissPct: h3Row.missPct,
            parityDeltaMs,
            absDelta,
            payloadKb: h1Row.payloadKb,
            splitCount: h1Row.splitCount,
            profileName: h1Row.profileName,
          };
        }
      }
      if (best) matches.push(best);
    }
  }

  const byH1Miss = new Map();
  for (const row of matches) {
    if (!byH1Miss.has(row.h1MissPct)) byH1Miss.set(row.h1MissPct, []);
    byH1Miss.get(row.h1MissPct).push(row);
  }

  const summary = [];
  for (const [h1MissPct, rows] of byH1Miss) {
    const h3Misses = rows.map((r) => r.h3MissPct);
    const deltas = rows.map((r) => r.parityDeltaMs);
    summary.push({
      h1MissPct,
      equivalentH3MissMedian: median(h3Misses),
      equivalentH3MissP25: percentile(h3Misses, 25),
      equivalentH3MissP75: percentile(h3Misses, 75),
      residualDeltaMsMedian: median(deltas),
      sampleCount: rows.length,
    });
  }

  summary.sort((a, b) => a.h1MissPct - b.h1MissPct);
  matches.sort(
    (a, b) => a.h1MissPct - b.h1MissPct || a.h3MissPct - b.h3MissPct,
  );

  return {
    chartType: "line",
    title: "Phase 2 Equivalent-Miss Frontier",
    description:
      "For each H1 miss-rate level, this shows the H3 miss rate that most closely matches H1 latency per scenario (nearest parity by absolute delta ms). Higher-than-diagonal values indicate H3 tolerates more cache misses for similar completion time.",
    axes: {
      x: { field: "h1MissPct", label: "H1 Cache Miss Rate (%)" },
      y: {
        field: "equivalentH3MissMedian",
        label: "Equivalent H3 Miss Rate (%)",
      },
    },
    data: summary,
    points: matches,
  };
}

/**
 * Phase 2 granularity comparison: H1 with coarse chunks (split=10) at high miss rates
 * vs H3 with fine chunks (split=100) at low miss rates.
 * Demonstrates that fine-grained invalidation strategy on H3 achieves lower cache miss rates,
 * and shows whether H3 still wins despite having fewer cache misses.
 */
function buildPhase2GranularityComparison(comparisons) {
  const phase2 = comparisons
    .filter((c) => c.phase === "2" && c.payloadKb !== 10000)
    .map((c) => ({
      ...c,
      missPct: invalidationToMissPct(c.invalidationProfile),
    }))
    .filter((c) => c.missPct != null);

  // Reverse mapping: miss percentage → invalidation profile
  const missToProfile = {
    0: "fully-cached",
    20: "partial-purge-20pct",
    40: "partial-purge-40pct",
    100: "full-purge",
  };

  // Strategic pairings: H1 coarse (high miss) vs H3 fine (lower miss from same logical change)
  const pairings = [
    { h1Miss: 0, h3Miss: 0, label: "Fully-cached (control)" },
    { h1Miss: 40, h3Miss: 20, label: "H1 40% coarse vs H3 20% fine" },
    { h1Miss: 100, h3Miss: 40, label: "H1 full-purge vs H3 40% fine" },
  ];

  const rows = [];

  for (const pair of pairings) {
    const h1Profile = missToProfile[pair.h1Miss];
    const h3Profile = missToProfile[pair.h3Miss];

    for (const h1Row of phase2.filter(
      (r) => r.splitCount === 10 && r.invalidationProfile === h1Profile,
    )) {
      const h3Row = phase2.find(
        (r) =>
          r.payloadKb === h1Row.payloadKb &&
          r.splitCount === 100 &&
          r.invalidationProfile === h3Profile &&
          r.profileName === h1Row.profileName,
      );

      if (!h3Row) continue;

      const deltaMsMedian = h3Row.median_h3 - h1Row.median_h1;
      const h3Wins = deltaMsMedian < 0;

      rows.push({
        payloadKb: h1Row.payloadKb,
        comparisonLabel: pair.label,
        h1MissPct: pair.h1Miss,
        h3MissPct: pair.h3Miss,
        h1_coarse_ms: h1Row.median_h1,
        h3_fine_ms: h3Row.median_h3,
        deltaMsMedian,
        h3Wins,
        profileName: h1Row.profileName,
      });
    }
  }

  // Aggregate by (payloadKb, comparisonLabel)
  const aggregated = new Map();
  for (const row of rows) {
    const key = `${row.payloadKb}|${row.comparisonLabel}`;
    if (!aggregated.has(key))
      aggregated.set(key, {
        samples: [],
        payloadKb: row.payloadKb,
        comparisonLabel: row.comparisonLabel,
        h1MissPct: row.h1MissPct,
        h3MissPct: row.h3MissPct,
      });
    aggregated.get(key).samples.push(row);
  }

  const summary = [];
  for (const [key, agg] of aggregated) {
    const winCount = agg.samples.filter((s) => s.h3Wins).length;
    const winRate = (winCount / agg.samples.length) * 100;
    const deltas = agg.samples.map((s) => s.deltaMsMedian);
    summary.push({
      payloadKb: agg.payloadKb,
      comparisonLabel: agg.comparisonLabel,
      h1MissPct: agg.h1MissPct,
      h3MissPct: agg.h3MissPct,
      deltaMsMedian: median(deltas),
      deltaMsP25: percentile(deltas, 25),
      deltaMsP75: percentile(deltas, 75),
      h3WinRatePct: winRate,
      sampleCount: agg.samples.length,
    });
  }

  summary.sort((a, b) => a.payloadKb - b.payloadKb);

  return {
    chartType: "heatmap",
    title: "Phase 2 Granularity Wins: Fine Chunks vs Coarse Chunks",
    description:
      "Compares H1 with 10 chunks at higher miss rates vs H3 with 100 chunks at lower miss rates. H1 40% coarse-granularity invalidation vs H3 20% fine-granularity. Shows whether H3's fine-grained strategy wins despite having fewer cache misses to manage.",
    axes: {
      x: { field: "comparisonLabel", label: "Comparison" },
      y: { field: "payloadKb", label: "Payload (KB)" },
      color: { field: "h3WinRatePct", label: "H3 Fine Wins (%)" },
    },
    data: summary,
  };
}

/**
 * Chart A: Miss Rate Sensitivity — actual ms lines for H1@split=10 vs H3@split=100.
 * Shows how each protocol's completion time rises as cache miss rate increases.
 * One series per (protocol, splitCount) combo; reveals crossover point and slope difference.
 */
function buildPhase2MissRateSensitivity(comparisons) {
  const phase2 = comparisons
    .filter((c) => c.phase === "2" && c.payloadKb !== 10000)
    .map((c) => ({
      ...c,
      missPct: invalidationToMissPct(c.invalidationProfile),
    }))
    .filter((c) => c.missPct != null);

  // Only include split=10 (H1 coarse reference) and split=100 (H3 fine reference)
  const rows = phase2
    .filter((c) => c.splitCount === 10 || c.splitCount === 100)
    .map((c) => ({
      payloadKb: c.payloadKb,
      splitCount: c.splitCount,
      missPct: c.missPct,
      median_h1: c.median_h1,
      median_h3: c.median_h3,
      chunkSizeKb: c.payloadKb / c.splitCount,
    }))
    .sort(
      (a, b) =>
        a.payloadKb - b.payloadKb ||
        a.splitCount - b.splitCount ||
        a.missPct - b.missPct,
    );

  return {
    chartType: "line",
    title: "Phase 2: Miss Rate Sensitivity (H1 coarse vs H3 fine)",
    description:
      "Shows how page completion time rises as cache miss rate increases, comparing H1 with 10 large chunks vs H3 with 100 small chunks. The slope of each line shows sensitivity to cache pressure. Crossover points reveal where finer granularity pays off.",
    axes: {
      x: { field: "missPct", label: "Cache Miss Rate (%)" },
      y: { field: "time_ms", label: "Page Completion Time (ms)" },
      color: { field: "series", label: "Protocol × Split" },
      facet: { field: "payloadKb", label: "Payload (KB)" },
    },
    data: rows,
  };
}

/**
 * Chart B: Split Count Effect — H3/H1 time ratio as split count increases.
 * One line per invalidation profile. Shows multiplexing leverage.
 */
function buildPhase2SplitCountEffect(comparisons) {
  const phase2 = comparisons
    .filter((c) => c.phase === "2" && c.payloadKb !== 10000)
    .map((c) => ({
      ...c,
      missPct: invalidationToMissPct(c.invalidationProfile),
    }))
    .filter((c) => c.missPct != null);

  const rows = phase2
    .map((c) => ({
      payloadKb: c.payloadKb,
      splitCount: c.splitCount,
      missPct: c.missPct,
      invalidationProfile: c.invalidationProfile,
      median_h1: c.median_h1,
      median_h3: c.median_h3,
      h3_h1_ratio: c.median_h3 / c.median_h1,
      delta_ms: c.delta_ms,
      delta_pct: c.delta_pct,
    }))
    .sort((a, b) => a.payloadKb - b.payloadKb || a.splitCount - b.splitCount);

  return {
    chartType: "line",
    title: "Phase 2: H3/H1 Speed Ratio by Split Count",
    description:
      "Shows how the H3 vs H1 ratio changes as split count increases. Below 1.0 means H3 is faster. Lines per invalidation profile reveal whether cache pressure amplifies or diminishes H3's advantage at higher chunk counts.",
    axes: {
      x: {
        field: "splitCount",
        label: "Split Count (number of chunks)",
        scale: "log",
      },
      y: { field: "h3_h1_ratio", label: "H3/H1 Time Ratio (< 1 = H3 faster)" },
      color: { field: "invalidationProfile", label: "Invalidation Profile" },
      facet: { field: "payloadKb", label: "Payload (KB)" },
    },
    data: rows,
  };
}

/**
 * Chart C: Granularity delta heatmap — same layout as before but showing actual ms delta.
 * Replaces win-rate % with median ms difference so magnitude is visible.
 */
function buildPhase2GranularityDelta(comparisons) {
  const phase2 = comparisons
    .filter((c) => c.phase === "2" && c.payloadKb !== 10000)
    .map((c) => ({
      ...c,
      missPct: invalidationToMissPct(c.invalidationProfile),
    }))
    .filter((c) => c.missPct != null);

  const missToProfile = {
    0: "fully-cached",
    20: "partial-purge-20pct",
    40: "partial-purge-40pct",
    100: "full-purge",
  };

  const pairings = [
    { h1Miss: 0, h3Miss: 0, label: "0% vs 0%\n(control)" },
    { h1Miss: 40, h3Miss: 20, label: "H1 40% vs\nH3 20%" },
    { h1Miss: 100, h3Miss: 40, label: "H1 100% vs\nH3 40%" },
    { h1Miss: 100, h3Miss: 20, label: "H1 100% vs\nH3 20%" },
  ];

  const rows = [];
  for (const pair of pairings) {
    const h1Profile = missToProfile[pair.h1Miss];
    const h3Profile = missToProfile[pair.h3Miss];

    for (const h1Row of phase2.filter(
      (r) => r.splitCount === 10 && r.invalidationProfile === h1Profile,
    )) {
      const h3Row = phase2.find(
        (r) =>
          r.payloadKb === h1Row.payloadKb &&
          r.splitCount === 100 &&
          r.invalidationProfile === h3Profile &&
          r.profileName === h1Row.profileName,
      );
      if (!h3Row) continue;

      const deltaMsMedian = h3Row.median_h3 - h1Row.median_h1;
      rows.push({
        payloadKb: h1Row.payloadKb,
        comparisonLabel: pair.label,
        h1MissPct: pair.h1Miss,
        h3MissPct: pair.h3Miss,
        h1_ms: h1Row.median_h1,
        h3_ms: h3Row.median_h3,
        deltaMsMedian,
      });
    }
  }

  rows.sort((a, b) => a.payloadKb - b.payloadKb);

  return {
    chartType: "heatmap",
    title: "Phase 2: Granularity Strategy — Actual Speed Difference (ms)",
    description:
      "Compares H1 at 10 coarse chunks (higher miss rate) vs H3 at 100 fine chunks (lower miss rate). Color shows actual ms difference: green = H3 faster, red = H1 faster. Cell text shows H3 ms − H1 ms, revealing magnitude not just direction.",
    axes: {
      x: { field: "comparisonLabel", label: "H1 miss % vs H3 miss %" },
      y: { field: "payloadKb", label: "Payload (KB)" },
      color: { field: "deltaMsMedian", label: "H3 − H1 (ms)" },
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

/**
 * Phase 1 H1 scaling: shows how H1 page completion time grows with split count,
 * one line per payload size. Baseline profile only. Demonstrates the request tax
 * — the cost of many small requests over H1 — independent of H3 comparison.
 */
function buildPhase1H1Scaling(comparisons) {
  const rows = comparisons
    .filter((c) => c.phase === "1" && c.profileName === "baseline")
    .map((c) => ({
      payloadKb: c.payloadKb,
      splitCount: c.splitCount,
      chunkSizeKb: c.payloadKb / c.splitCount,
      median_h1: c.median_h1,
      median_h3: c.median_h3,
    }))
    .sort((a, b) => a.splitCount - b.splitCount || a.payloadKb - b.payloadKb);

  return {
    chartType: "line",
    title: "HTTP Request Scaling by Split Count",
    description:
      "Shows how page completion time scales with the number of requests (split count) for each total payload size under baseline network conditions. Demonstrates the per-request overhead tax.",
    axes: {
      x: { field: "splitCount", label: "Split Count (requests)", scale: "log" },
      y: {
        field: "median_h1",
        label: "Median Page Completion (ms)",
        scale: "log",
      },
      color: { field: "payloadKb", label: "Total Payload (KB)" },
    },
    data: rows,
  };
}

/**
 * Phase 1 H3 performance: absolute H3 page completion times across all
 * network profiles, payload sizes, and split counts.
 * Shows how fast a total payload downloads over HTTP/3 under various conditions.
 */
function buildPhase1H3Performance(comparisons) {
  const rows = comparisons
    .filter((c) => c.phase === "1")
    .map((c) => ({
      profileName: c.profileName,
      payloadKb: c.payloadKb,
      splitCount: c.splitCount,
      chunkSizeKb: c.payloadKb / c.splitCount,
      median_h3: c.median_h3,
      p95_h3: c.p95_h3,
    }))
    .sort(
      (a, b) =>
        a.payloadKb - b.payloadKb ||
        a.splitCount - b.splitCount ||
        a.profileName.localeCompare(b.profileName),
    );

  return {
    chartType: "line",
    title: "HTTP/3 Payload Download Performance (Phase 1)",
    description:
      "Shows HTTP/3 page completion time for each total payload size as split count increases, faceted by network profile. Demonstrates the cost of splitting a payload into more requests under HTTP/3 multiplexing.",
    axes: {
      x: { field: "splitCount", label: "Split Count (requests)", scale: "log" },
      y: { field: "median_h3", label: "Median Page Completion (ms)" },
      color: { field: "payloadKb", label: "Total Payload (KB)" },
      facet: { field: "profileName", label: "Network Profile" },
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
    ["chart-phase-1-scaling.json", buildPhase1H1Scaling(comparisons)],
    [
      "chart-phase-1-h3-performance.json",
      buildPhase1H3Performance(comparisons),
    ],
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
