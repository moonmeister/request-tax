import fs from "node:fs/promises";
import path from "node:path";
import minimist from "minimist";
import { loadScenarios, expandScenarioMatrix } from "./utils/config.js";
import { summarizeRuns } from "./utils/timing.js";
import { writeScenarioSummaryCsv } from "./utils/csv-export.js";
import {
  startStack,
  stopStack,
  applyNetem,
  clearNetem,
} from "./server-manager.js";
import { runBrowserScenario } from "./playwright/test-runner.js";
import { runEarlyHintsScenario } from "./playwright/early-hints-runner.js";

const scenarioFile = path.resolve("harness", "scenarios.json");
const rawDir = path.resolve("results", "raw");
const analysisDir = path.resolve("results", "analysis");

function scenarioId(s) {
  const cacheTag = s.cacheProfile ? `_${s.cacheProfile}` : "";
  const invalidationTag = s.invalidationProfileName
    ? `_${s.invalidationProfileName}`
    : "";
  return (
    [s.protocol, s.profileName, `${s.payloadKb}kb`, `${s.splitCount}x`].join(
      "_",
    ) +
    cacheTag +
    invalidationTag
  );
}

async function writeJson(file, payload) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

async function runSingleScenario(s, { earlyHints = false }) {
  const runs = [];
  const totalRuns = s.warmupRuns + s.measuredRuns;

  await applyNetem(s.profile.netem);

  for (let i = 0; i < totalRuns; i += 1) {
    const runner = earlyHints ? runEarlyHintsScenario : runBrowserScenario;
    const result = await runner({
      protocol: s.protocol,
      file: s.file,
      splitCount: s.splitCount,
      profile: s.profile,
      cacheTtl: s.cacheTtl || 0,
      cacheScope: s.cacheScope || null,
      invalidationProfile: s.invalidationProfileName,
      staleChunks: s.staleChunks,
    });

    runs.push({
      runId: i + 1,
      isWarmup: i < s.warmupRuns,
      pageCompletionTime: result.pageCompletionTime,
      requestCount: result.requestCount,
      entries: result.entries,
    });
  }

  await clearNetem();
  return runs;
}

async function run() {
  const cliArgs = process.argv.slice(2).filter((a) => a !== "--");
  const args = minimist(cliArgs, {
    string: ["phase", "mode"],
    boolean: ["no-start", "no-stop", "smoke"],
    default: {
      phase: "a",
      mode: "run",
      "no-start": false,
      "no-stop": false,
      smoke: false,
    },
  });

  if (args.mode === "insights") {
    console.log(
      "Insights mode currently exports from in-memory run only. Run benchmark phases first.",
    );
    return;
  }

  const cfg = await loadScenarios(scenarioFile);
  const phaseKey = args.phase;
  let scenarios = expandScenarioMatrix(cfg);

  if (phaseKey === "early-hints") {
    scenarios = scenarios.filter((s) => s.profileName === "baseline");
  }

  if (phaseKey === "a") {
    scenarios = scenarios.filter((s) =>
      [
        "baseline",
        "moderate-rtt",
        "loss-0.5pct",
        "loss-1pct",
        "loss-3pct",
      ].includes(s.profileName),
    );
  }

  if (phaseKey === "b") {
    // Phase B tests cache behavior: baseline network profile only, but with different cache policies
    scenarios = scenarios.filter((s) => s.profileName === "baseline");

    // Expand scenarios with cache profiles (off, short-ttl, long-ttl, mixed)
    const cacheProfiles = cfg.cacheProfiles || {
      off: { ttlSeconds: 0 },
      "short-ttl": { ttlSeconds: 60 },
      "long-ttl": { ttlSeconds: 3600 },
      mixed: { ttlSeconds: 300 },
    };

    const scenariosWithCache = [];
    for (const s of scenarios) {
      for (const [cacheName, cacheConfig] of Object.entries(cacheProfiles)) {
        scenariosWithCache.push({
          ...s,
          cacheProfile: cacheName,
          cacheTtl: cacheConfig.ttlSeconds,
        });
      }
    }
    scenarios = scenariosWithCache;
  }

  if (phaseKey === "c") {
    // Phase 3 tests cache invalidation behavior with mixed hit/miss patterns.
    scenarios = scenarios.filter((s) => s.profileName === "baseline");

    const phase3 = cfg.phase3 || {
      cacheTtlSeconds: 3600,
      invalidationProfiles: {
        "full-purge": { staleRatio: 1 },
        "partial-purge-20pct": { staleRatio: 0.2 },
      },
    };

    const scenariosWithInvalidation = [];
    for (const s of scenarios) {
      for (const [name, invalidation] of Object.entries(
        phase3.invalidationProfiles,
      )) {
        const staleChunks = Math.max(
          1,
          Math.min(
            s.splitCount,
            Math.ceil(s.splitCount * Number(invalidation.staleRatio || 0)),
          ),
        );
        scenariosWithInvalidation.push({
          ...s,
          cacheProfile: "invalidation",
          cacheTtl: Number(phase3.cacheTtlSeconds || 3600),
          invalidationProfileName: name,
          staleChunks,
        });
      }
    }
    scenarios = scenariosWithInvalidation;
  }

  if (args.smoke) {
    scenarios = scenarios.slice(0, 1).map((s) => ({
      ...s,
      warmupRuns: 0,
      measuredRuns: 1,
    }));
  }

  if (!args["no-start"]) {
    await startStack();
  }

  const summaryRows = [];

  try {
    for (const s of scenarios) {
      const earlyHints = phaseKey === "early-hints";

      // Keep Phase B cache comparisons isolated by using a per-scenario cache namespace.
      const scopedScenario =
        phaseKey === "b" ? { ...s, cacheScope: scenarioId(s) } : s;

      const runs = await runSingleScenario(scopedScenario, { earlyHints });
      const summary = summarizeRuns(runs);

      const payload = {
        metadata: {
          timestamp: new Date().toISOString(),
          scenario: scenarioId(s),
          phase: phaseKey,
          protocol: s.protocol,
          profileName: s.profileName,
          cacheProfile: s.cacheProfile || null,
          cacheScope: scopedScenario.cacheScope || null,
          cacheTtl: s.cacheTtl || 0,
          invalidationProfile: s.invalidationProfileName || null,
          staleChunks: s.staleChunks || 0,
          payloadKb: s.payloadKb,
          splitCount: s.splitCount,
          chunkKb: s.chunkKb,
          file: s.file,
          warmupRuns: s.warmupRuns,
          measuredRuns: s.measuredRuns,
          earlyHints,
        },
        runs,
        summary,
      };

      await writeJson(
        path.join(rawDir, `${scenarioId(s)}_${Date.now()}.json`),
        payload,
      );
      summaryRows.push({ ...s, summary });
      console.log(`completed ${scenarioId(s)} p95=${summary.p95.toFixed(2)}ms`);
    }

    await writeScenarioSummaryCsv(
      summaryRows,
      path.join(analysisDir, `phase-${phaseKey}-summary.csv`),
    );
  } finally {
    await clearNetem();
    if (!args["no-stop"]) {
      await stopStack();
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
