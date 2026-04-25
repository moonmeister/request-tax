#!/usr/bin/env node

/**
 * Compare H1 vs H3 for each scenario cell.
 *
 * Input:  results/analysis/runs.json  (from extract-runs.js)
 * Output: results/analysis/comparisons.json
 *
 * Each comparison pairs an H1 and H3 cell that share the same
 * phase, profileName, payloadKb, splitCount, cacheProfile, and invalidationProfile.
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  createRng,
  median,
  percentile,
  bootstrapCiDelta,
  permutationTest,
  benjaminiHochberg,
} from "./stats.js";

const ANALYSIS_DIR = path.resolve("results", "analysis");
const SEED = 42;
const BOOTSTRAP_RESAMPLES = 5000;
const PERMUTATION_ITERS = 10000;

function cellKey(run) {
  // Normalize equivalent phase labels so runs are merged
  const phase = run.phase === "c" ? "2" : run.phase === "a" ? "1" : run.phase;
  return [
    phase,
    run.profileName,
    run.payloadKb,
    run.splitCount,
    run.cacheProfile ?? "",
    run.invalidationProfile ?? "",
  ].join("|");
}

async function main() {
  const runsPath = path.join(ANALYSIS_DIR, "runs.json");
  const runsFile = JSON.parse(await fs.readFile(runsPath, "utf8"));
  const runs = runsFile.data;

  // Group runs by cell key + protocol
  const cells = new Map();
  for (const run of runs) {
    const key = cellKey(run);
    if (!cells.has(key)) cells.set(key, { h1: [], h3: [] });
    const bucket = cells.get(key);
    if (run.protocol === "h1") bucket.h1.push(run.pageCompletionTime);
    else if (run.protocol === "h3") bucket.h3.push(run.pageCompletionTime);
  }

  // Build comparisons for cells that have both protocols
  const comparisons = [];
  const rng = createRng(SEED);

  for (const [key, { h1, h3 }] of cells) {
    if (h1.length === 0 || h3.length === 0) continue;

    const [
      phase,
      profileName,
      payloadKb,
      splitCount,
      cacheProfile,
      invalidationProfile,
    ] = key.split("|");

    const med_h1 = median(h1);
    const med_h3 = median(h3);
    const p95_h1 = percentile(h1, 95);
    const p95_h3 = percentile(h3, 95);
    const delta_ms = med_h3 - med_h1;
    const delta_pct = med_h1 !== 0 ? (delta_ms / med_h1) * 100 : 0;

    const { ci_lower, ci_upper } = bootstrapCiDelta(h1, h3, {
      nResamples: BOOTSTRAP_RESAMPLES,
      rng,
    });

    const p_value = permutationTest(h1, h3, {
      nPermutations: PERMUTATION_ITERS,
      rng,
    });

    comparisons.push({
      phase,
      profileName,
      payloadKb: Number(payloadKb),
      splitCount: Number(splitCount),
      cacheProfile: cacheProfile || null,
      invalidationProfile: invalidationProfile || null,
      n_h1: h1.length,
      n_h3: h3.length,
      median_h1: med_h1,
      median_h3: med_h3,
      p95_h1,
      p95_h3,
      delta_ms,
      delta_pct,
      ci_lower,
      ci_upper,
      p_value,
      p_value_adjusted: null, // filled after BH
      significant: false,
      practically_significant: false,
    });
  }

  // Apply BH correction within each phase
  const phases = [...new Set(comparisons.map((c) => c.phase))];
  for (const phase of phases) {
    const subset = comparisons.filter((c) => c.phase === phase);
    const rawP = subset.map((c) => c.p_value);
    const adjusted = benjaminiHochberg(rawP);

    for (let i = 0; i < subset.length; i++) {
      subset[i].p_value_adjusted = adjusted[i];

      const ciExcludesZero = subset[i].ci_lower > 0 || subset[i].ci_upper < 0;
      subset[i].significant = ciExcludesZero && adjusted[i] < 0.05;

      subset[i].practically_significant =
        subset[i].significant &&
        (Math.abs(subset[i].delta_pct) > 5 ||
          Math.abs(subset[i].delta_ms) > 10);
    }
  }

  // Write output
  const output = {
    meta: {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      analysisConfig: {
        seed: SEED,
        bootstrapResamples: BOOTSTRAP_RESAMPLES,
        permutationIterations: PERMUTATION_ITERS,
        ciLevel: 0.95,
        significanceAlpha: 0.05,
        practicalThresholds: {
          deltaPctMin: 5,
          deltaMsMin: 10,
        },
        correction: "benjamini-hochberg",
      },
    },
    data: comparisons,
  };

  await fs.writeFile(
    path.join(ANALYSIS_DIR, "comparisons.json"),
    JSON.stringify(output, null, 2),
  );

  const sigCount = comparisons.filter((c) => c.significant).length;
  const practCount = comparisons.filter(
    (c) => c.practically_significant,
  ).length;

  console.log(
    `✓ ${comparisons.length} comparisons: ${sigCount} significant, ${practCount} practically significant`,
  );
}

main();
