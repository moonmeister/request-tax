import fs from "node:fs/promises";
import path from "node:path";

export async function writeScenarioSummaryCsv(rows, outFile) {
  const hasCache = rows.some((r) => r.cacheProfile);
  const hasInvalidation = rows.some((r) => r.invalidationProfileName);

  const header = [
    "protocol",
    "profile",
    "payload_kb",
    "split_count",
    "chunk_kb",
  ];

  if (hasCache) {
    header.push("cache_profile", "cache_ttl_s");
  }

  if (hasInvalidation) {
    header.push("invalidation_profile", "stale_chunks");
  }

  header.push("count", "p50_ms", "p95_ms", "p99_ms", "min_ms", "max_ms");

  const lines = [header.join(",")];
  for (const row of rows) {
    const values = [
      row.protocol,
      row.profileName,
      row.payloadKb,
      row.splitCount,
      row.chunkKb,
    ];

    if (hasCache) {
      values.push(
        row.cacheProfile || "",
        row.cacheTtl !== undefined ? row.cacheTtl : "",
      );
    }

    if (hasInvalidation) {
      values.push(row.invalidationProfileName || "", row.staleChunks || "");
    }

    values.push(
      row.summary.count,
      row.summary.p50.toFixed(2),
      row.summary.p95.toFixed(2),
      row.summary.p99.toFixed(2),
      row.summary.min.toFixed(2),
      row.summary.max.toFixed(2),
    );

    lines.push(values.join(","));
  }

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, lines.join("\n") + "\n", "utf8");
}
