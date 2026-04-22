# Data Processing And Cleanup Plan

Date: 2026-04-07  
Status: Proposed, implementation-ready

## Objective

Move analysis to a reproducible pipeline that:

- Keeps raw benchmark JSON as provenance.
- Produces typed, analysis-ready derived tables.
- Computes uncertainty and statistical significance for H1 vs H3 effects.
- Emits chart-ready artifacts and a static report.

## Current State And Gaps

- Raw run data already exists in results/raw.
- insights reads legacy summary files; no formal derived schema, comparison table, or report contract yet.

Key gaps to close:

- No single source of truth for downstream analysis.
- No confidence intervals or multiple-comparison correction.
- No deterministic analysis settings (seeded resampling).

## Target Data Architecture

1. Tier 1, raw inputs:

- results/raw/\*.json (immutable provenance).

2. Tier 2, derived normalized tables:

- results/analysis/runs.json
- results/analysis/requests.json
- results/analysis/scenarios.json

3. Tier 3, statistical comparisons:

- results/analysis/comparisons.json

4. Tier 4, chart-ready artifacts:

- results/analysis/chart-phase-1-heatmap.json
- results/analysis/chart-phase-2-retention.json
- results/analysis/chart-distributions.json

5. Tier 5, report output:

- results/reports/index.html

Storage policy:

- JSON end-to-end. No format conversions between pipeline stages.
- Derived files include metadata (schemaVersion, analysisConfig) alongside data.

## Data Contracts

Required run-level fields:

- phase, protocol, profileName, cacheProfile, invalidationProfile
- payloadKb, splitCount, chunkKb
- runId, isWarmup, pageCompletionTime, requestCount
- degradedFallbackUsed, timestamp, sourceFile

Required request-level fields:

- runId, requestIndex, requestKey, method, path
- durationMs, startMs, endMs, bytesSent, bytesReceived

Required scenario-level fields:

- phase, protocol, profileName, cacheProfile, invalidationProfile
- payloadKb, splitCount, chunkKb
- measuredRunCount, warmupRunCount, medianTime, p95Time, sourceFile

Comparison-level fields:

- phase, profileName, payloadKb, splitCount, cacheProfile, invalidationProfile
- n_h1, n_h3
- median_h1, median_h3
- p95_h1, p95_h3
- delta_ms, delta_pct
- ci_lower, ci_upper
- p_value, p_value_adjusted
- significant, practically_significant

## Statistical Defaults

Primary effect definition:

- Delta in milliseconds: $\Delta = \text{median}_{h3} - \text{median}_{h1}$
- Relative effect: $\Delta\% = \frac{\Delta}{\text{median}_{h1}} \times 100$

Methods and parameters:

- Bootstrap CI: 5000 resamples, 95% percentile interval.
- Permutation test: 10000 Monte Carlo shuffles.
- Multiple testing correction: Benjamini-Hochberg within each phase.
- Reproducibility: fixed random seed (recorded in output metadata).

Decision flags:

- significant: CI excludes 0 and adjusted p-value < 0.05.
- practically_significant: significant and (|delta_pct| > 5 or |delta_ms| > 10).

Interpretation rule:

- Report effect size and CI first, significance second.

## Implementation Plan

### Stage 1: Extraction And Validation

Create:

- harness/analysis/extract-runs.js
- harness/analysis/validate.js

Responsibilities:

- Parse results/raw/\*.json to normalized tables.
- Separate warmup and measured runs cleanly.
- Fail on schema violations.
- Warn on unstable samples.

Fail conditions:

- Missing required fields.
- Empty measured run set for any scenario.
- Zero-length request arrays where requests are expected.

Warnings:

- Scenario has fewer than 3 measured runs.
- degradedFallbackUsed rate > 20%.
- CI width > 50% of median when stats are computed.

### Stage 2: Comparisons Engine

Create:

- harness/analysis/stats.js
- harness/analysis/compare.js

Responsibilities:

- Pair comparable H1/H3 scenario cells.
- Compute medians, p95, deltas, CI, and p-values.
- Apply BH correction.
- Write comparisons.json (with per-phase filtering available at query time).

### Stage 3: Chart Contracts

Create:

- harness/analysis/chart-specs.js

Responsibilities:

- Convert comparisons and run-level data into stable JSON contracts.
- Keep chart JSON format backward compatible once published.

### Stage 4: Report Builder

Create:

- harness/report/build-report.js

Responsibilities:

- Render a static report using chart JSON.
- Prefer Plotly for initial delivery speed.

Initial chart set:

1. Phase 1 heatmap of relative H3 effect.
2. Phase 2 retention under invalidation profiles.
3. Distribution panel for representative cells.

### Stage 5: CLI And Workflow Integration

Add package scripts:

```json
{
  "analyze:extract": "node harness/analysis/extract-runs.js",
  "analyze:compare": "node harness/analysis/compare.js",
  "analyze:charts": "node harness/analysis/chart-specs.js",
  "analyze": "pnpm analyze:extract && pnpm analyze:compare && pnpm analyze:charts",
  "report": "node harness/report/build-report.js"
}
```

Migration note for insights:

- Rewrite insights to read comparisons.json instead of legacy summary files.

## MVP Scope (First Deliverable)

Ship first:

1. Extraction plus validation.
2. comparisons.json with CI and adjusted p-values.
3. Phase 1 heatmap chart JSON.
4. Report page with at least one chart and interpretation text.

Defer until phase 2:

- Full chart suite polish.
- Long-term data retention/archive job.

## Operational Guidance

Reproducibility:

- Keep raw JSON immutable.
- Add schemaVersion and analysisConfig metadata to derived outputs.
- Store random seed and statistical settings with each analysis run.

Performance:

- Dataset is small enough for in-memory JSON processing.
- No external query engine needed.

Retention:

- Keep recent raw files online.
- Archive older raw batches if storage becomes a concern.

## Success Criteria

- [ ] Derived tables are generated from raw JSON with zero dropped measured rows.
- [ ] Comparisons include CI, raw p-value, and BH-adjusted p-value for each valid H1/H3 cell.
- [ ] Analysis outputs are reproducible with the same seed and inputs.
- [ ] insights reads comparisons.json directly.
- [ ] Report renders successfully from chart JSON.
- [ ] End-to-end analyze pipeline completes in practical local runtime.

## Exit Criteria

Cleanup is complete when:

- Derived JSON tables drive comparisons and reporting.
- Statistical reporting defaults are consistently applied across phases.
- Reported conclusions are based on effect size, CI, and adjusted significance.
