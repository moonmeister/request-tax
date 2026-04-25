import fs from "node:fs/promises";
import path from "node:path";
import minimist from "minimist";
import { loadScenarios, expandScenarioMatrix } from "./utils/config.js";
import { summarizeRuns } from "./utils/timing.js";
import {
  startStack,
  stopStack,
  applyNetem,
  clearNetem,
  applyBackhaulNetem,
  clearBackhaulNetem,
} from "./server-manager.js";
import { runBrowserScenario } from "./playwright/test-runner.js";

const scenarioFile = path.resolve("harness", "scenarios.json");
const rawDir = path.resolve("results", "raw");

/** Find the highest existing run-N folder number, or 0 if none exist. */
async function latestRunNumber() {
  let entries;
  try {
    entries = await fs.readdir(rawDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let max = 0;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const m = e.name.match(/^run-(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

/** Resolve the target run directory based on CLI args. */
async function resolveRunDir(args) {
  if (args.run !== undefined) {
    const n = Number(args.run);
    if (!Number.isFinite(n) || n < 1)
      throw new Error("--run must be a positive integer");
    return path.join(rawDir, `run-${n}`);
  }
  if (args.resume) {
    const latest = await latestRunNumber();
    if (latest === 0)
      throw new Error("--resume: no existing run folders found");
    return path.join(rawDir, `run-${latest}`);
  }
  const next = (await latestRunNumber()) + 1;
  return path.join(rawDir, `run-${next}`);
}

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

function runScenarioId(s) {
  return scenarioId(s);
}

async function writeJson(file, payload) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

async function runSingleScenario(s) {
  const runs = [];
  const totalRuns = s.warmupRuns + s.measuredRuns;

  await applyNetem(s.profile.netem);

  for (let i = 0; i < totalRuns; i += 1) {
    const result = await runBrowserScenario({
      protocol: s.protocol,
      file: s.file,
      splitCount: s.splitCount,
      profile: s.profile,
      cacheTtl: s.cacheTtl || 0,
      cacheScope: s.cacheScope || null,
      payloadMode: s.payloadMode || "origin-proxy",
      invalidationProfile: s.invalidationProfileName,
      staleChunks: s.staleChunks,
    });

    runs.push({
      runId: i + 1,
      isWarmup: i < s.warmupRuns,
      pageCompletionTime: result.pageCompletionTime,
      requestCount: result.requestCount,
      navigationProtocol: result.navigationProtocol || null,
      fallbackUsed: !!result.fallbackUsed,
      fallbackUrl: result.fallbackUrl || null,
      fallbackReason: result.fallbackReason || null,
      entries: result.entries,
    });
  }

  await clearNetem();
  return runs;
}

async function run() {
  const cliArgs = process.argv.slice(2).filter((a) => a !== "--");
  const args = minimist(cliArgs, {
    string: ["phase", "scenario"],
    boolean: ["no-start", "no-stop", "smoke", "resume", "help"],
    default: {
      phase: "1",
      mode: "run",
      "no-start": false,
      "no-stop": false,
      smoke: false,
      resume: false,
      help: false,
    },
  });

  if (args.help) {
    console.log(`Usage: node harness/index.js [options]

Options:
  --phase <1|2>          Phase to run (default: "1")
  --scenario <id>        Filter to a specific scenario ID
  --no-start             Skip starting the Docker stack
  --no-stop              Skip stopping the Docker stack after run
  --smoke                Run one minimal run per protocol
  --resume               Resume the latest run (skip completed scenarios)
  --run <N>              Target a specific run folder (run-N)
  --measured-runs <N>    Override number of measured runs
  --warmup-runs <N>      Override number of warmup runs
  --help                 Show this help message`);
    return;
  }

  const cfg = await loadScenarios(scenarioFile);
  const phaseKey = args.phase;
  let scenarios = expandScenarioMatrix(cfg);

  if (phaseKey === "1") {
    scenarios = scenarios
      .filter((s) =>
        [
          "baseline",
          "moderate-rtt",
          "loss-0.5pct",
          "loss-1pct",
          "loss-3pct",
        ].includes(s.profileName),
      )
      .map((s) => ({ ...s, payloadMode: "edge-direct" }));
  }

  if (phaseKey === "2") {
    // Phase 2 tests cache invalidation with mixed hit/miss patterns.
    // Use moderate-rtt so origin round-trips have meaningful cost.
    scenarios = scenarios.filter((s) => s.profileName === "moderate-rtt");

    const phase2 = cfg.phase2 || {
      cacheTtlSeconds: 3600,
      invalidationProfiles: {
        "full-purge": { staleRatio: 1 },
        "partial-purge-20pct": { staleRatio: 0.2 },
      },
    };

    const scenariosWithInvalidation = [];
    for (const s of scenarios) {
      for (const [name, invalidation] of Object.entries(
        phase2.invalidationProfiles,
      )) {
        const staleRatio = Number(invalidation.staleRatio || 0);
        const staleChunks =
          staleRatio === 0
            ? 0
            : Math.max(
                1,
                Math.min(s.splitCount, Math.ceil(s.splitCount * staleRatio)),
              );
        scenariosWithInvalidation.push({
          ...s,
          cacheProfile: "invalidation",
          cacheTtl: Number(phase2.cacheTtlSeconds || 3600),
          invalidationProfileName: name,
          staleChunks,
        });
      }
    }
    scenarios = scenariosWithInvalidation;
  }

  // Filter by scenario ID if specified
  if (args.scenario) {
    scenarios = scenarios.filter((s) => {
      const base = scenarioId(s);
      const runId = runScenarioId(s);
      return args.scenario === base || args.scenario === runId;
    });
    if (scenarios.length === 0) {
      console.error(`No scenarios matched: ${args.scenario}`);
      process.exit(1);
    }
  }

  // Resolve target run directory
  const runDir = await resolveRunDir(args);
  console.log(`Target run directory: ${path.relative(process.cwd(), runDir)}`);

  // Resume: skip scenarios that already have a result file in this run folder.
  if (args.resume) {
    let existingFiles = [];
    try {
      existingFiles = await fs.readdir(runDir);
    } catch {
      // runDir doesn't exist yet, nothing to skip
    }
    const existing = new Set();
    for (const f of existingFiles) {
      if (!f.endsWith(".json")) continue;
      existing.add(f.replace(/_\d+\.json$/, ""));
    }
    const before = scenarios.length;
    scenarios = scenarios.filter((s) => !existing.has(runScenarioId(s)));
    const skipped = before - scenarios.length;
    if (skipped > 0) {
      console.log(
        `resume: skipping ${skipped}/${before} completed scenario(s), ${scenarios.length} remaining`,
      );
    }
    if (scenarios.length === 0) {
      console.log("resume: all scenarios already complete");
      return;
    }
  }

  const measuredRunsOverride =
    args["measured-runs"] !== undefined
      ? Number(args["measured-runs"])
      : undefined;
  const warmupRunsOverride =
    args["warmup-runs"] !== undefined ? Number(args["warmup-runs"]) : undefined;

  if (measuredRunsOverride !== undefined || warmupRunsOverride !== undefined) {
    if (
      measuredRunsOverride !== undefined &&
      (!Number.isFinite(measuredRunsOverride) || measuredRunsOverride < 1)
    ) {
      throw new Error("--measured-runs must be a positive integer");
    }
    if (
      warmupRunsOverride !== undefined &&
      (!Number.isFinite(warmupRunsOverride) || warmupRunsOverride < 0)
    ) {
      throw new Error("--warmup-runs must be a non-negative integer");
    }

    scenarios = scenarios.map((s) => ({
      ...s,
      measuredRuns:
        measuredRunsOverride !== undefined
          ? Math.floor(measuredRunsOverride)
          : s.measuredRuns,
      warmupRuns:
        warmupRunsOverride !== undefined
          ? Math.floor(warmupRunsOverride)
          : s.warmupRuns,
    }));
  }

  if (args.smoke) {
    const smokeScenarios = [];
    const seenProtocols = new Set();

    for (const s of scenarios) {
      if (seenProtocols.has(s.protocol)) {
        continue;
      }
      seenProtocols.add(s.protocol);
      smokeScenarios.push({
        ...s,
        warmupRuns: 0,
        measuredRuns: 1,
      });
    }

    scenarios = smokeScenarios;
  }

  if (!args["no-start"]) {
    await startStack();
  }

  // Apply constant backhaul delay only for Phase 2 (invalidation).
  // Phase 1 uses edge-direct (no origin hop).
  if (phaseKey === "2" && cfg.backhaulDelayMs > 0) {
    await applyBackhaulNetem(cfg.backhaulDelayMs);
  }

  const summaryRows = [];

  try {
    for (const s of scenarios) {
      let runs;
      runs = await runSingleScenario(s);
      const summary = summarizeRuns(runs);

      const payload = {
        metadata: {
          timestamp: new Date().toISOString(),
          scenario: runScenarioId(s),
          scenarioBase: scenarioId(s),
          phase: phaseKey,
          protocol: s.protocol,
          profileName: s.profileName,
          cacheProfile: s.cacheProfile || null,
          cacheScope: s.cacheScope || null,
          cacheTtl: s.cacheTtl || 0,
          payloadMode: s.payloadMode || "origin-proxy",
          originBypassed: (s.payloadMode || "origin-proxy") === "edge-direct",
          invalidationProfile: s.invalidationProfileName || null,
          staleChunks: s.staleChunks || 0,
          payloadKb: s.payloadKb,
          splitCount: s.splitCount,
          chunkKb: s.chunkKb,
          file: s.file,
          warmupRuns: s.warmupRuns,
          measuredRuns: s.measuredRuns,
          degradedFallbackUsed: runs.some((r) => r.fallbackUsed),
        },
        runs,
        summary,
      };

      await writeJson(
        path.join(runDir, `${runScenarioId(s)}_${Date.now()}.json`),
        payload,
      );
      summaryRows.push({ ...s, summary });
      console.log(
        `completed ${runScenarioId(s)} p95=${summary.p95.toFixed(2)}ms`,
      );
    }
  } finally {
    await clearNetem();
    await clearBackhaulNetem();
    if (!args["no-stop"]) {
      await stopStack();
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
