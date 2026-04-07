/**
 * Validation helpers for extracted benchmark data.
 */

const REQUIRED_METADATA_FIELDS = [
  "phase",
  "protocol",
  "profileName",
  "payloadKb",
  "splitCount",
  "chunkKb",
];

const REQUIRED_RUN_FIELDS = [
  "runId",
  "isWarmup",
  "pageCompletionTime",
  "requestCount",
];

const REQUIRED_ENTRY_FIELDS = [
  "name",
  "startTime",
  "responseStart",
  "responseEnd",
  "duration",
  "nextHopProtocol",
  "transferSize",
  "decodedBodySize",
];

export function validateRawFile(data, sourceFile) {
  const errors = [];
  const warnings = [];

  // Metadata checks
  const meta = data.metadata;
  if (!meta) {
    errors.push(`${sourceFile}: missing metadata`);
    return { errors, warnings };
  }

  for (const field of REQUIRED_METADATA_FIELDS) {
    if (meta[field] === undefined || meta[field] === null) {
      // cacheProfile, invalidationProfile are nullable by design
      if (field !== "cacheProfile" && field !== "invalidationProfile") {
        errors.push(`${sourceFile}: missing metadata.${field}`);
      }
    }
  }

  // Runs checks
  if (!Array.isArray(data.runs) || data.runs.length === 0) {
    errors.push(`${sourceFile}: missing or empty runs array`);
    return { errors, warnings };
  }

  const measured = data.runs.filter((r) => !r.isWarmup);
  if (measured.length === 0) {
    errors.push(`${sourceFile}: no measured runs`);
  } else if (measured.length < 3) {
    warnings.push(`${sourceFile}: only ${measured.length} measured runs (< 3)`);
  }

  for (const run of data.runs) {
    for (const field of REQUIRED_RUN_FIELDS) {
      if (run[field] === undefined || run[field] === null) {
        errors.push(
          `${sourceFile}: run ${run.runId ?? "?"} missing field ${field}`,
        );
      }
    }

    if (!Array.isArray(run.entries)) {
      errors.push(
        `${sourceFile}: run ${run.runId ?? "?"} missing entries array`,
      );
    } else if (run.entries.length === 0 && meta.splitCount > 0) {
      errors.push(
        `${sourceFile}: run ${run.runId ?? "?"} has zero entries but splitCount=${meta.splitCount}`,
      );
    } else {
      for (let i = 0; i < run.entries.length; i++) {
        for (const field of REQUIRED_ENTRY_FIELDS) {
          if (
            run.entries[i][field] === undefined ||
            run.entries[i][field] === null
          ) {
            errors.push(
              `${sourceFile}: run ${run.runId} entry[${i}] missing ${field}`,
            );
          }
        }
      }
    }
  }

  // Fallback rate check
  const fallbackCount = measured.filter((r) => r.fallbackUsed).length;
  if (measured.length > 0 && fallbackCount / measured.length > 0.2) {
    warnings.push(
      `${sourceFile}: ${((fallbackCount / measured.length) * 100).toFixed(0)}% degraded fallback usage`,
    );
  }

  return { errors, warnings };
}
