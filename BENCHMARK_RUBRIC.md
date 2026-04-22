# Benchmark Rubric

This rubric defines what each benchmark phase is testing, what changes between phases, and what each phase is expected to show.

## Goal

Evaluate whether HTTP/3 eliminates the per-request tax that HTTP/1.1 imposes, and whether the resulting freedom to split payloads enables better cache invalidation granularity.

## Phase Overview

| Phase                                  | Core Question                                                          | What Stays Constant                                              | What Changes                                                  | Expected Signal                                                                                                             |
| -------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Phase 1: Network + Protocol Resilience | How do H1 and H3 diverge as network quality degrades?                  | Same payload sizes, split counts, and request pattern            | Network profile (baseline, RTT, loss) and protocol (h1 vs h3) | H3 should open a meaningful lead as RTT/loss worsens; H1 may remain competitive or win on clean-network, large-bundle cases |
| Phase 2: Invalidation Cost             | Under realistic churn, does cache-friendly H3 beat coarse H1 bundling? | Moderate-rtt network profile; cache-enabled context; same matrix | Invalidation profile (full purge vs partial stale ratios)     | Realism check: as content churn increases, granular splitting should retain more cache hits than monolithic bundling        |

## What Changes Between Phases

1. Phase 1 changes transport conditions and compares protocol behavior.
2. Phase 2 holds transport steady and changes cache freshness pressure.

## How To Interpret Results

1. Phase 1 should show a meaningful H3 advantage under degraded network conditions, not a modest one.
2. Phase 1 may still show H1 winning on clean networks when payloads are bundled into large transfers.
3. Phase 2 is the realism phase: if the thesis is correct, invalidation pressure should favor granular splitting over coarse bundling, because only a fraction of chunks need to be re-fetched.

## Thesis Under Test

This benchmark is testing the following narrative:

1. H3 is generally more resilient than H1 in real-world network conditions, especially as RTT and loss increase.
2. H1 can still look better on clean networks when large bundles minimize request overhead.
3. Once invalidation and churn are introduced, granular splitting outperforms coarse bundling because partial cache invalidation keeps most chunks warm.
4. Therefore: optimize for cacheability boundaries and invalidation granularity first, rather than aggressively bundling solely to reduce request count.

## Known Anomalies

### Phase 1: H3 slower than H1 across nearly all 10000kb scenarios

H3 is consistently slower than H1 at the 10000kb payload tier across almost every network profile and split count. The only exception is `moderate-rtt` at 10x splits, where H3 leads by ~39%. Under packet loss, H3 becomes dramatically worse — at `loss-3pct`, H3 medians reach 18 seconds versus H1's 7–9 seconds.

At 10MB total payload the bottleneck is bulk throughput, not request overhead. Two factors compound against QUIC at this scale:

1. **Userspace overhead**: QUIC runs in userspace (Caddy's quic-go stack), so congestion control, loss recovery, and retransmission all incur Go runtime scheduling costs that kernel TCP avoids. TCP benefits from decades of kernel-level optimization including SACK, fast retransmit, and hardware offloads (TSO/GRO).
2. **Loss amplification**: With 40ms RTT on the loss profiles, each retransmission costs at least one full round-trip through userspace. With 10MB in flight, even small loss rates trigger many retransmissions, and QUIC's congestion window recovery is slower than kernel TCP's.

On baseline (zero-latency, zero-loss), the gap is purely userspace overhead versus kernel fast path. Under degraded conditions, the expectation was that H3's multiplexing and 0-RTT advantages would close the gap, but at this payload scale the bulk-throughput penalty dominates.

This does not undermine the thesis. The 10000kb tier represents coarse bundling at an extreme (10MB total transfer) — exactly the scenario where the thesis predicts H1 may still win. The 100kb–1000kb range, which better represents realistic delivery granularity, shows H3 winning consistently as split counts increase.

## Practical Conclusion Template

Use this structure when presenting findings:

1. Historically: optimization focused on protocol/request-count constraints.
2. Now: H3 reduces the cost of many requests, especially under real-world network degradation, while H1 may still reward coarse bundling on pristine networks.
3. Therefore: optimize for cacheability boundaries and invalidation granularity first, rather than aggressively bundling solely to reduce request count.
