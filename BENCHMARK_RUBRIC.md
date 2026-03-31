# Benchmark Rubric

This rubric defines what each benchmark phase is testing, what changes between phases, and what each phase is expected to show.

## Goal

Evaluate whether modern transport shifts the main optimization problem away from request-count minimization and toward cacheability and invalidation strategy.

## Phase Overview

| Phase                                  | Core Question                                                 | What Stays Constant                                          | What Changes                                                  | Expected Signal                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Phase A: Network + Protocol Resilience | How do H1 and H3 diverge as network quality degrades?         | Same payload sizes, split counts, and request pattern        | Network profile (baseline, RTT, loss) and protocol (h1 vs h3) | H3 should open a meaningful lead as RTT/loss worsens; H1 may remain competitive or win on clean-network, large-bundle cases |
| Phase B: Cache Controls                | How much of the observed gain comes from caching versus removing backend haul? | Baseline network profile; same protocol/payload/split matrix | Delivery profile (`origin-no-cache`, `edge-cache-hit`, `edge-direct`) | Separates true cache-hit benefit from simple backend-hop elimination, so H3 gains are not blindly attributed to caching |
| Phase C: Invalidation Cost             | Under realistic churn, does cache-friendly H3 beat coarse H1 bundling? | Baseline network profile; cache-enabled context; same matrix | Invalidation profile (full purge vs partial stale ratios)     | Realism check: as content churn increases, cache-optimized H3 should retain more value than large-bundle H1 if the thesis holds |

## What Changes Between Phases

1. Phase A changes transport conditions and compares protocol behavior.
2. Phase B holds transport steady and changes the delivery/control profile.
3. Phase C holds transport steady and changes cache freshness pressure.

## How To Interpret Results

1. Phase A should show a meaningful H3 advantage under degraded network conditions, not a modest one.
2. Phase A may still show H1 winning on clean networks when payloads are bundled into large transfers.
3. Phase B should show whether an apparent cache win is truly cache-driven or mostly the result of removing backend haul.
4. Phase C is the realism phase: if the thesis is correct, invalidation pressure should favor cache-optimized H3 over coarse H1 bundling even on an otherwise good network.

## Thesis Under Test

This benchmark is testing the following narrative:

1. H3 is generally more resilient than H1 in real-world network conditions, especially as RTT and loss increase.
2. H1 can still look better on clean networks when large bundles minimize request overhead.
3. Caching can recover the small clean-network penalty of finer-grained delivery, but that claim must be separated from any gain caused by removing an upstream HTTP/1.1 bottleneck.
4. Once invalidation and churn are introduced, cache-friendly granularity should outperform coarse bundling, making cache strategy more important than request-count minimization.

## Phase B Required Value For This Thesis

Phase B is not primarily about finding the perfect TTL.

Its required value is to separate three effects that would otherwise be conflated: origin-backed no-cache behavior, origin-backed cache-hit behavior, and backend-free edge delivery.

Specifically, Phase B should show:

1. `edge-cache-hit` materially outperforms `origin-no-cache`.
2. `edge-direct` establishes the ceiling for removing backend haul entirely.
3. The difference between `edge-cache-hit` and `edge-direct` shows whether the Phase B gain is mostly backend elimination or still leaves meaningful transport effects on the client-edge hop.

## Phase B Pass Criteria

Use these pass checks when deciding whether Phase B supports the narrative:

1. Effect-size check: `edge-cache-hit` clearly improves on `origin-no-cache` across the matrix.
2. Attribution check: `edge-cache-hit` and `edge-direct` are compared directly so backend-hop elimination is not misattributed to cache.
3. Robustness check: the pattern is present across both protocols and across low/high split strategies.
4. Priority check: once backend effects are isolated, cache-friendly granularity still looks viable even if H1 wins some pristine-network bundle cases.

If these checks pass, the narrative is supported:

1. Protocol evolution reduced request-count pressure.
2. Phase B gains are not being blindly over-credited to cache when they are actually caused by removing backend haul.
3. Cache strategy is now the primary optimization target.
4. Invalidation strategy (Phase C) determines how much of that cache gain is retained.

## TTL Interpretation Note

Phase B uses a deliberately very long TTL for `edge-cache-hit` so expiry is effectively out of scope during benchmark runs.

That is intentional for this thesis: the primary question is attribution of performance gains, not fine-grained expiry timing behavior.

## Practical Conclusion Template

Use this structure when presenting findings:

1. Historically: optimization focused on protocol/request-count constraints.
2. Now: H3 reduces the cost of many requests, especially under real-world network degradation, while H1 may still reward coarse bundling on pristine networks.
3. Therefore: optimize for cacheability boundaries and invalidation granularity first, rather than aggressively bundling solely to reduce request count.
