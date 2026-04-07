/**
 * Statistical primitives for benchmark analysis.
 *
 * - Seeded PRNG for reproducibility
 * - Median, percentile
 * - Bootstrap confidence interval for difference of medians
 * - Permutation test for difference of medians
 * - Benjamini-Hochberg FDR correction
 */

// --- Seeded PRNG (xoshiro128**) ---

function xoshiro128ss(a, b, c, d) {
  return function () {
    const t = b << 9;
    let r = a * 5;
    r = ((r << 7) | (r >>> 25)) * 9;
    c ^= a;
    d ^= b;
    b ^= c;
    a ^= d;
    c ^= t;
    d = (d << 11) | (d >>> 21);
    return (r >>> 0) / 4294967296;
  };
}

function seedHash(seed) {
  let h = 1779033703 ^ seed;
  const next = () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
  return [next(), next(), next(), next()];
}

export function createRng(seed = 42) {
  const [a, b, c, d] = seedHash(seed);
  return xoshiro128ss(a, b, c, d);
}

// --- Basic stats ---

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// --- Bootstrap CI for difference of medians ---

function resample(arr, rng) {
  const out = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    out[i] = arr[Math.floor(rng() * arr.length)];
  }
  return out;
}

/**
 * Bootstrap 95% CI for median(b) - median(a).
 * Returns { ci_lower, ci_upper, observed }.
 */
export function bootstrapCiDelta(a, b, { nResamples = 5000, rng } = {}) {
  rng = rng || createRng();
  const observed = median(b) - median(a);
  const deltas = new Array(nResamples);

  for (let i = 0; i < nResamples; i++) {
    deltas[i] = median(resample(b, rng)) - median(resample(a, rng));
  }

  deltas.sort((x, y) => x - y);
  const lo = Math.floor(nResamples * 0.025);
  const hi = Math.floor(nResamples * 0.975);

  return {
    observed,
    ci_lower: deltas[lo],
    ci_upper: deltas[hi],
  };
}

// --- Permutation test for difference of medians ---

/**
 * Two-sided permutation test.
 * Returns p-value: proportion of permutations where |delta| >= |observed|.
 */
export function permutationTest(a, b, { nPermutations = 10000, rng } = {}) {
  rng = rng || createRng();
  const observed = Math.abs(median(b) - median(a));
  const pooled = [...a, ...b];
  const nA = a.length;
  let extremeCount = 0;

  for (let i = 0; i < nPermutations; i++) {
    // Fisher-Yates partial shuffle to pick nA elements
    const perm = [...pooled];
    for (let j = 0; j < nA; j++) {
      const k = j + Math.floor(rng() * (perm.length - j));
      [perm[j], perm[k]] = [perm[k], perm[j]];
    }
    const permA = perm.slice(0, nA);
    const permB = perm.slice(nA);
    const permDelta = Math.abs(median(permB) - median(permA));
    if (permDelta >= observed) extremeCount++;
  }

  return extremeCount / nPermutations;
}

// --- Benjamini-Hochberg FDR correction ---

/**
 * Adjusts an array of p-values using BH step-up procedure.
 * Returns array of adjusted p-values in original order.
 */
export function benjaminiHochberg(pValues) {
  const n = pValues.length;
  const indexed = pValues.map((p, i) => ({ p, i }));
  indexed.sort((a, b) => a.p - b.p);

  const adjusted = new Array(n);
  let cumMin = 1;

  for (let rank = n; rank >= 1; rank--) {
    const { p, i } = indexed[rank - 1];
    const corrected = (p * n) / rank;
    cumMin = Math.min(cumMin, corrected);
    adjusted[i] = Math.min(cumMin, 1);
  }

  return adjusted;
}
