## Plan: HTTP/1.1 vs HTTP/3 Request Granularity and Cache Strategy

This study is designed to demonstrate two things: the old fewer-larger-request guidance was sensible for HTTP/1.1, and under HTTP/3 the dominant optimization shifts toward cache hit-rate and invalidation-aware granularity. The benchmark evidence will come from API-style payloads, and we will include an Early Hints variant to test whether prewarming amplifies the small-request strategy.

**Steps**

1. Lock scope and success criteria:
   - Protocols: HTTP/1.1 and HTTP/3 only.
   - Primary metric: browser-relevant time-to-complete-all-required-data-requests.
   - Secondary metrics: TTFB, p95/p99 completion distribution, request/header overhead.
   - Out of scope for this round: HTTP/2, multi-user load, production WAN.
2. Build a parity benchmark topology:
   - Same origin behavior for H1 and H3, TLS 1.3, cache disabled in baseline phase.
   - API-like payloads only for measured benchmark (10 KB, 100 KB, 1 MB, 10 MB).
   - Strategy sets per total payload: 1 large, 10 smaller, 100 smaller where practical.
3. Implement Node-orchestrated harness:
   - Execute scenario matrix and persist raw metrics.
   - Use a protocol-capable benchmark client path that supports H1 and H3 comparably.
   - Keep reproducible run metadata (protocol, payload, split strategy, latency profile, warmup/run id).
4. Run Phase 1 baseline transfer tests:
   - Browser cache disabled: Playwright incognito context + `Cache-Control: no-store` headers on all responses.
   - No edge cache, localhost profile first.
   - Add simulated RTT profile (30–50 ms via CDP `Network.emulateNetworkConditions`) as a second pass.
   - Add simulated packet loss profile as a third pass:
     - Both H1 (TCP) and H3 (QUIC/UDP) impaired via Linux `tc netem` inside a Docker container (`--cap-add NET_ADMIN`).
     - `tc netem` operates at the network interface level and applies uniformly to all IP traffic regardless of transport protocol — single tool, identical methodology for both protocols.
     - Node harness configures impairment via `docker exec` before each batch; no sudo on the host required.
     - Methodology caveat: Docker Desktop on macOS routes traffic through a hidden Linux VM, adding a small consistent latency floor (~0.5–2 ms). This does not bias H1 vs H3 comparisons (both traverse the same path), but absolute latency numbers will be slightly higher than true localhost. Document in report.
   - Repetitions: 100 for 10/100 KB, 50 for 1 MB, 30 for 10 MB, with 5 warmups discarded.
5. Run Phase 2 cache invalidation analysis:
   - Caddy acts as the CDN equivalent with caching enabled.
   - Browser cache remains disabled (incognito + no-store headers) to isolate edge cache behavior.
   - Test invalidation profiles: full purge, partial purge (20%, 40%) to model realistic content churn.
6. Add Early Hints variant (selected option):
   - Test small-request strategy with and without Early Hints in both protocols.
   - Measure whether Early Hints reduces aggregate completion enough to strengthen the split-request recommendation under H3.
   - Keep analysis explicit that Early Hints effectiveness depends on browser/client and intermediary behavior.
7. Synthesize findings into a decision rubric:
   - Show where H1 still rewards fewer larger requests.
   - Show where H3 plus cache-friendly granularity flips the recommendation.
   - Express as thresholds by payload size and cache-hit skew.
8. Publish practical translation rules for architecture decisions:
   - REST and GraphQL: split by invalidation domain, not arbitrary endpoint count.
   - Bundling and islands guidance: map benchmark principle to bundle/chunk boundaries based on independent change cadence.
   - Clarify that bundling recommendations are principle-derived from API benchmark evidence unless a dedicated asset benchmark is added later.

**Verification**

1. Byte-equivalence: same response bytes across H1 and H3 for each scenario id.
2. Reproducibility: representative scenarios rerun multiple times with stable percentile bands.
3. Control integrity: cache-off baseline verified (incognito context + no-store headers); no stale reuse leaks between runs.
4. Docker container running with `--cap-add NET_ADMIN`; `tc netem` rules applied and verified before each loss-phase batch; rules cleared after each batch.
5. Matrix completeness: each protocol × payload × split strategy × latency profile has required measured samples.
6. Early Hints integrity: hints emitted and observed in the intended variant runs only.
7. Interpretation discipline: decisions based on completion time and tails, not means alone.

**Decisions**

- Keep HTTP/1.1 for historical validation and HTTP/3 for modern recommendation; drop HTTP/2.
- Include 10 KB in the payload matrix.
- Primary evidence source is API-style benchmarks.
- Include Early Hints as a dedicated variant.
- Treat system resource cost as secondary diagnostics.
- Provide bundling/islands guidance as principle transfer from measured API results.
- Caddy and network impairment run inside Docker; Playwright runs on the host targeting container-exposed ports.
- Network impairment uses `tc netem` inside the container for both H1 and H3; single tool, full protocol parity.

**Further considerations**

1. If Early Hints support in chosen client tooling is limited, use browser-based verification for that phase and clearly annotate comparability.
2. If team confidence requires direct asset evidence, add a small Phase 3 with one JS/CSS bundle scenario after baseline conclusions are established.
