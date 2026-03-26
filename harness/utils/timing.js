export function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

export function summarizeRuns(runs) {
  const measured = runs
    .filter((r) => !r.isWarmup)
    .map((r) => r.pageCompletionTime);
  return {
    count: measured.length,
    p50: percentile(measured, 50),
    p95: percentile(measured, 95),
    p99: percentile(measured, 99),
    min: measured.length ? Math.min(...measured) : 0,
    max: measured.length ? Math.max(...measured) : 0,
  };
}
