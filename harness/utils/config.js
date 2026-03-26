import fs from "node:fs/promises";

export async function loadScenarios(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export function repetitionsForPayloadKb(repetitions, payloadKb) {
  if (payloadKb <= 100) return repetitions.small;
  if (payloadKb <= 1000) return repetitions.medium;
  return repetitions.large;
}

export function expandScenarioMatrix(cfg) {
  const scenarios = [];

  for (const payloadKb of cfg.payloads) {
    const splitCounts = cfg.splitStrategies[String(payloadKb)] || [1];
    for (const splitCount of splitCounts) {
      const chunkKb = Math.floor(payloadKb / splitCount);
      const file = cfg.fixtureMap[String(chunkKb)];
      if (!file) {
        throw new Error(
          `No fixture mapped for chunk ${chunkKb}KB (payload=${payloadKb}, split=${splitCount})`,
        );
      }

      for (const protocol of cfg.protocols) {
        for (const [profileName, profile] of Object.entries(cfg.profiles)) {
          scenarios.push({
            payloadKb,
            splitCount,
            chunkKb,
            file,
            protocol,
            profileName,
            profile,
            warmupRuns: cfg.warmupRuns,
            measuredRuns: repetitionsForPayloadKb(cfg.repetitions, payloadKb),
          });
        }
      }
    }
  }

  return scenarios;
}
