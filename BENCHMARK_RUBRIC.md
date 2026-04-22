# Benchmark Rubric

This rubric defines what each benchmark phase is testing, what changes between phases, and what each phase is expected to show.

## Goal

Evaluate whether modern transport shifts the main optimization problem away from request-count minimization and toward cacheability and invalidation strategy.

## Phase Overview

| Phase                                  | Core Question                                                                  | What Stays Constant                                          | What Changes                                                          | Expected Signal                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Phase A: Network + Protocol Resilience | How do H1 and H3 diverge as network quality degrades?                          | Same payload sizes, split counts, and request pattern        | Network profile (baseline, RTT, loss) and protocol (h1 vs h3)         | H3 should open a meaningful lead as RTT/loss worsens; H1 may remain competitive or win on clean-network, large-bundle cases     |
| Phase B: Cache Controls                | How much of the observed gain comes from caching versus removing backend haul? | Baseline network profile; same protocol/payload/split matrix | Delivery profile (`origin-no-cache`, `edge-cache-hit`, `edge-direct`) | Separates true cache-hit benefit from simple backend-hop elimination, so H3 gains are not blindly attributed to caching         |
| Phase C: Invalidation Cost             | Under realistic churn, does cache-friendly H3 beat coarse H1 bundling?         | Baseline network profile; cache-enabled context; same matrix | Invalidation profile (full purge vs partial stale ratios)             | Realism check: as content churn increases, cache-optimized H3 should retain more value than large-bundle H1 if the thesis holds |

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

The specific variable Phase B isolates is the **H1 backhaul protocol overhead** — connection limits, head-of-line blocking, and proxy fan-out cost — not round-trip latency to the origin. Everyone already knows eliminating a network hop is faster. The interesting question is whether the H3 + caching win is driven by removing the H1 protocol bottleneck on the backend path. To measure this cleanly, network impairment (netem) must only apply to client↔edge traffic, not edge↔origin traffic. The backend should have near-zero artificial latency so the `origin-no-cache` → `edge-direct` gap reflects protocol and processing overhead, not round-trip time.

Specifically, Phase B should show:

1. `edge-cache-hit` materially outperforms `origin-no-cache`.
2. `edge-direct` establishes the ceiling for removing the H1 backhaul protocol path entirely.
3. The difference between `edge-cache-hit` and `edge-direct` shows whether the Phase B gain is mostly H1 backhaul elimination or still leaves meaningful transport effects on the client-edge hop.

## Phase B Pass Criteria

Use these pass checks when deciding whether Phase B supports the narrative:

1. Effect-size check: `edge-cache-hit` clearly improves on `origin-no-cache` across the matrix.
2. Attribution check: `edge-cache-hit` and `edge-direct` are compared directly so H1 backhaul protocol overhead is not misattributed to cache.
3. Robustness check: the pattern is present across both protocols and across low/high split strategies.
4. Priority check: once H1 backhaul effects are isolated, cache-friendly granularity still looks viable even if H1 wins some pristine-network bundle cases.

If these checks pass, the narrative is supported:

1. Protocol evolution reduced request-count pressure.
2. Phase B gains are not being blindly over-credited to cache when they are actually caused by the H1 backhaul protocol path.
3. Cache strategy is now the primary optimization target.
4. Invalidation strategy (Phase C) determines how much of that cache gain is retained.

## TTL Interpretation Note

Phase B uses a deliberately very long TTL for `edge-cache-hit` so expiry is effectively out of scope during benchmark runs.

That is intentional for this thesis: the primary question is attribution of performance gains, not fine-grained expiry timing behavior.

## Known Anomalies

### Phase A: H3 slower than H1 across nearly all 10000kb scenarios

H3 is consistently slower than H1 at the 10000kb payload tier across almost every network profile and split count. The only exception is `moderate-rtt` at 10x splits, where H3 leads by ~39%. Under packet loss, H3 becomes dramatically worse — at `loss-3pct`, H3 medians reach 18 seconds versus H1's 7–9 seconds.

At 10MB total payload the bottleneck is bulk throughput, not request overhead. Two factors compound against QUIC at this scale:

1. **Userspace overhead**: QUIC runs in userspace (Caddy's quic-go stack), so congestion control, loss recovery, and retransmission all incur Go runtime scheduling costs that kernel TCP avoids. TCP benefits from decades of kernel-level optimization including SACK, fast retransmit, and hardware offloads (TSO/GRO).
2. **Loss amplification**: With 40ms RTT on the loss profiles, each retransmission costs at least one full round-trip through userspace. With 10MB in flight, even small loss rates trigger many retransmissions, and QUIC's congestion window recovery is slower than kernel TCP's.

On baseline (zero-latency, zero-loss), the gap is purely userspace overhead versus kernel fast path. Under degraded conditions, the expectation was that H3's multiplexing and 0-RTT advantages would close the gap, but at this payload scale the bulk-throughput penalty dominates.

This does not undermine the thesis. The 10000kb tier represents coarse bundling at an extreme (10MB total transfer) — exactly the scenario where the thesis predicts H1 may still win. The 100kb–1000kb range, which better represents realistic delivery granularity, shows H3 winning consistently as split counts increase.

### Phase B: H3 `origin-no-cache` bimodal at 10000kb/100x

Under the `origin-no-cache` delivery profile at 10000kb/100x, H3 exhibits a bimodal distribution: a small cluster of fast runs (~650ms) and a dominant cluster of slow runs (~4700–5000ms). Both independent test sessions reproduce this pattern consistently (session 1: 4/30 fast; session 2: 1/30 fast).

The same instability appears at lower split counts but with decreasing frequency: at 1x one session shows a clean mid-run mode switch (23 fast runs then 7 slow), and at 10x occasional single outliers appear. H1 shows no such instability at any split count (range ratios consistently ~1.1x).

Critically, H3 `edge-cache-hit` and `edge-direct` at the same payload/split (10000kb/100x) are rock-solid at ~480ms with tight clustering. This isolates the problem to the origin-proxy path — which is exactly what the Phase B control structure was designed to show. The three-way comparison (`origin-no-cache` vs `edge-cache-hit` vs `edge-direct`) exists to separate backhaul effects from cache and transport effects, and this anomaly is the control working as intended.

Two factors on the backhaul path compound to explain the H3-specific penalty:

1. **Protocol mismatch fan-out**: Caddy's `reverse_proxy` connects to the Node origin over plain HTTP/1.1. When the client uses H3, all 100 streams are multiplexed onto a single QUIC connection, and Caddy must fan those out into separate H1 requests to origin — 100 simultaneous origin fetches each carrying 100KB. When the client uses H1, Chrome's ~6-connection limit provides a natural throttle, so Caddy only manages ~6 concurrent origin requests at a time, spreading the work and reducing peak backhaul pressure.
2. **Origin I/O and memory pressure**: The Node origin reads payloads from disk via `fs.readFile` on every request with no in-process cache. At 100x concurrency on 10MB total payload, each run triggers 100 concurrent reads of the same file, allocating ~1GB of Buffers into Node's heap and saturating libuv's default 4-thread I/O pool. Under H3's near-simultaneous request delivery this all hits at once; under H1's staggered delivery, Node has time to serve and GC between batches.

This H3-to-H1 fan-out pressure, combined with origin I/O contention and quic-go's userspace flow control, likely explains the mode switch: once Caddy's QUIC stack hits a congestion or flow-control threshold under sustained origin-proxy load, it does not recover for the remainder of the session.

For interpretation purposes, the `origin-no-cache` profile at 10000kb/100x should be read as evidence that origin-backed delivery is especially costly under H3 multiplexing pressure — which reinforces rather than weakens the Phase B attribution argument: the gap between `origin-no-cache` and `edge-cache-hit`/`edge-direct` is real and large.

## Practical Conclusion Template

Use this structure when presenting findings:

1. Historically: optimization focused on protocol/request-count constraints.
2. Now: H3 reduces the cost of many requests, especially under real-world network degradation, while H1 may still reward coarse bundling on pristine networks.
3. Therefore: optimize for cacheability boundaries and invalidation granularity first, rather than aggressively bundling solely to reduce request count.
