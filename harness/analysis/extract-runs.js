#!/usr/bin/env node

/**
 * Extract tidy run-level and scenario-level data from raw benchmark JSON files.
 *
 * Outputs:
 *   results/analysis/runs.json      – one entry per run (warmup excluded)
 *   results/analysis/requests.json  – one entry per request per run
 *   results/analysis/scenarios.json – one entry per scenario file
 */

import fs from "node:fs/promises";
import path from "node:path";
import { validateRawFile } from "./validate.js";

const RAW_DIR = path.resolve("results", "raw");
const OUT_DIR = path.resolve("results", "analysis");

/** Recursively collect all .json files under a directory. */
async function collectJsonFiles(dir) {
  const results = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectJsonFiles(full)));
    } else if (entry.name.endsWith(".json")) {
      results.push(full);
    }
  }
  return results;
}

function median(sorted) {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(sorted, p) {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

async function main() {
  const filePaths = await collectJsonFiles(RAW_DIR);

  if (filePaths.length === 0) {
    console.error("No raw JSON files found in", RAW_DIR);
    process.exit(1);
  }

  const allRuns = [];
  const allRequests = [];
  const allScenarios = [];
  const allErrors = [];
  const allWarnings = [];

  for (const filePath of filePaths) {
    const file = path.relative(RAW_DIR, filePath);
    const data = JSON.parse(await fs.readFile(filePath, "utf8"));
    const { errors, warnings } = validateRawFile(data, file);

    allErrors.push(...errors);
    allWarnings.push(...warnings);

    if (errors.length > 0) continue;

    const meta = data.metadata;
    const measured = data.runs.filter((r) => !r.isWarmup);
    const warmup = data.runs.filter((r) => r.isWarmup);

    // Build scenario entry
    const times = measured
      .map((r) => r.pageCompletionTime)
      .sort((a, b) => a - b);
    allScenarios.push({
      phase: meta.phase,
      protocol: meta.protocol,
      profileName: meta.profileName,
      cacheProfile: meta.cacheProfile || null,
      invalidationProfile: meta.invalidationProfile || null,
      payloadKb: meta.payloadKb,
      splitCount: meta.splitCount,
      chunkKb: meta.chunkKb,
      measuredRunCount: measured.length,
      warmupRunCount: warmup.length,
      medianTime: median(times),
      p95Time: percentile(times, 95),
      sourceFile: file,
    });

    // Build run and request entries
    for (const run of measured) {
      const runKey = `${file}:${run.runId}`;

      allRuns.push({
        phase: meta.phase,
        protocol: meta.protocol,
        profileName: meta.profileName,
        cacheProfile: meta.cacheProfile || null,
        invalidationProfile: meta.invalidationProfile || null,
        payloadKb: meta.payloadKb,
        splitCount: meta.splitCount,
        chunkKb: meta.chunkKb,
        runId: runKey,
        isWarmup: false,
        pageCompletionTime: run.pageCompletionTime,
        requestCount: run.requestCount,
        degradedFallbackUsed: run.fallbackUsed || false,
        timestamp: meta.timestamp,
        sourceFile: file,
      });

      for (let i = 0; i < run.entries.length; i++) {
        const entry = run.entries[i];
        allRequests.push({
          runId: runKey,
          requestIndex: i,
          requestKey: entry.name,
          method: "GET",
          path: new URL(entry.name).pathname,
          durationMs: entry.duration,
          startMs: entry.startTime,
          endMs: entry.responseEnd,
          bytesSent: 0,
          bytesReceived: entry.transferSize,
        });
      }
    }
  }

  // Report validation results
  if (allWarnings.length > 0) {
    console.warn(`\n⚠ ${allWarnings.length} warning(s):`);
    for (const w of allWarnings) console.warn(`  ${w}`);
  }

  if (allErrors.length > 0) {
    console.error(`\n✗ ${allErrors.length} validation error(s):`);
    for (const e of allErrors) console.error(`  ${e}`);
    process.exit(1);
  }

  // Write outputs
  await fs.mkdir(OUT_DIR, { recursive: true });

  const meta = {
    schemaVersion: 1,
    extractedAt: new Date().toISOString(),
    rawFileCount: filePaths.length,
  };

  await Promise.all([
    fs.writeFile(
      path.join(OUT_DIR, "runs.json"),
      JSON.stringify({ meta, data: allRuns }, null, 2),
    ),
    fs.writeFile(
      path.join(OUT_DIR, "requests.json"),
      JSON.stringify({ meta, data: allRequests }),
    ),
    fs.writeFile(
      path.join(OUT_DIR, "scenarios.json"),
      JSON.stringify({ meta, data: allScenarios }, null, 2),
    ),
  ]);

  console.log(
    `✓ Extracted ${allRuns.length} runs, ${allRequests.length} requests, ${allScenarios.length} scenarios from ${filePaths.length} files`,
  );
}

main();
