## Implementation Guide: HTTP/1.1 vs HTTP/3 Request Granularity Benchmark

This document captures all tooling choices, implementation caveats, and project structure for the benchmark lab.

### Toolchain Details

#### Server: Caddy

- **Why**: Native HTTP/3 support, single configuration, TLS 1.3 built-in.
- **Setup**:
  - H1 endpoint on port N (e.g., 8080) with TLS but no `Alt-Svc` header advertised.
  - H3 endpoint on port N+1 (e.g., 8081) with TLS and `Alt-Svc: h3=":8081"` header.
  - Use `tls internal` for self-signed localhost certificates (no ACME overhead).
  - Cache disabled via `Cache-Control: no-store` and `Pragma: no-cache` headers.
- **Protocol forcing**: Clients explicitly target the protocol by port, not via ALPN negotiation. Caddy must not advertise H3 on the H1 port.
- **Config location**: `server/Caddyfile`.

#### Client: Playwright (Chromium)

- **Why**: Measures real browser behavior; Resource Timing API captures per-request metrics (responseStart, responseEnd, transferSize); handles Early Hints (103) natively.
- **Metrics sourced**:
  - Per-request: `performance.getEntriesByType('resource')` → responseStart, responseEnd, transferSize, duration.
  - Aggregated: total page completion time across all required requests.
- **Protocol selection**: Test harness navigates to different ports (H1 port vs H3 port) to force protocol; browser complies without negotiation.
- **Caveats**:
  - Browser engine overhead adds ~5–20 ms noise floor; acceptable since deltas will be larger.
  - Early Hints (103) responses are processed by Chromium; document actual preconnect/prefetch timing if measured.

#### Network Simulation: Three-layer approach

**Layer 1 — Latency (CDP)**

- Playwright CDP `Network.emulateNetworkConditions` injects RTT and throughput limits per run.
- No OS-level tools; scriptable in the Node harness.
- **Critical caveat**: CDP throttling applies inconsistently to QUIC streams (UDP). H3 RTT results are directionally indicative, not microbenchmark-precise. Document in report.

**Layer 2 — Packet Loss for H1 (TCP): Toxiproxy**

- Toxiproxy runs as a local proxy daemon between Playwright and Caddy.
- Configured via Node.js REST API (`toxiproxy-node-client`); no sudo required.
- Supports: latency, packet loss (`latency` toxic + `bandwidth` toxic), connection resets.
- `brew install toxiproxy` on macOS.
- Playwright targets the Toxiproxy port instead of Caddy directly for H1 loss runs.
- **Limitation**: Toxiproxy is TCP-only; cannot intercept UDP/QUIC.

**Layer 3 — Packet Loss for H3 (QUIC/UDP): pfctl/dnctl**

- QUIC runs over UDP; Toxiproxy cannot proxy it. OS-level tools are unavoidable.
- macOS `dnctl pipe 1 config plr 0.01` (1% packet loss) + `pfctl` to route traffic through the pipe.
- Requires `sudo`; the Node harness must invoke these with elevated privileges or pre-configured rules.
- **Reportable finding**: The need for different tooling per protocol highlights a genuine measurement challenge for H3 loss scenarios in browser-level testing; document this explicitly.

#### Edge Cache: Caddy (Phase B)

- Caddy acts as the CDN equivalent with caching enabled and configurable `Cache-Control` TTLs.
- Browser cache remains disabled via Playwright incognito contexts + `Cache-Control: no-store` headers in Phase A.
- Phase B TTL profiles: long TTL (stable resource), short TTL (frequently updated), mixed (realistic API surface).
- Optional: Phase B variant with browser cache enabled, to model full realistic behavior and compare delta.

#### Avoided Options & Why

- **Network Link Conditioner**: Not easily scriptable; affects all machine traffic; replaced by CDP + Toxiproxy for most scenarios.
- **curl or h2load**: Loss of browser-level measurement; Early Hints not validated in real browser behavior.
- **HTTP/2**: Dropped per plan; comparison is H1 vs H3 only.
- **Pure synthetic cache overlay**: Replaced by real Caddy caching for Phase B (more empirically defensible).

### Project Structure

```
request-tax/
├── docker/
│   ├── Dockerfile               # Caddy + iproute2 (tc netem) image
│   ├── docker-compose.yml       # Service definition; NET_ADMIN cap; port exposure
│   └── Caddyfile                # H1 (port 8080) + H3 (port 8081) config
├── server/
│   ├── payloads/                # Binary fixtures (one file per unique chunk/total size; committed to repo)
│   │   ├── 1kb.bin              # chunk: 10KB÷10, 100KB÷100
│   │   ├── 10kb.bin             # total: 10KB; chunk: 100KB÷10, 1MB÷100
│   │   ├── 100kb.bin            # total: 100KB; chunk: 1MB÷10, 10MB÷100
│   │   ├── 1mb.bin              # total: 1MB; chunk: 10MB÷10
│   │   └── 10mb.bin             # total: 10MB (asset-scale boundary)
│   └── handlers/                # Optional: handler logic for payload serving, Early Hints, cache headers
│
├── harness/
│   ├── index.js                 # Entry point; orchestrates phases, CLI parsing
│   ├── scenarios.json           # Matrix definition: payloads, splits, reps, latency profiles
│   ├── playwright/
│   │   ├── test-runner.js       # Playwright test harness; navigates, collects Resource Timing
│   │   └── early-hints-runner.js # Variant: tests Early Hints behavior
│   ├── utils/
│   │   ├── config.js            # Load/merge scenarios.json with CLI overrides
│   │   ├── timing.js            # Extract/parse Resource Timing data, compute percentiles
│   │   └── csv-export.js        # Convert JSON results to CSV views
│   └── server-manager.js        # Auto-manage Docker lifecycle (start/reuse/optional teardown); apply/clear tc netem via docker exec
│
├── results/
│   ├── raw/                     # JSON output per run (timestamped)
│   │   └── phase-a-baseline-h1-1710052800.json
│   ├── analysis/                # Aggregated CSVs for insights
│   │   ├── phase-a-summary.csv
│   │   ├── phase-b-cache-overlay.csv
│   │   └── early-hints-delta.csv
│   └── reports/                 # Final markdown/JSON synthesis
│
├── package.json                 # pnpm scripts: benchmark, phase-a, phase-b, phase-c, insights
├── pnpm-lock.yaml
└── README.md                     # Setup, run instructions, caveats
```

### Request Firing Strategy

All N requests per scenario are fired **in parallel** (simultaneously from a single Playwright page), reflecting real browser page-load behavior. This is where H1's 6-connection-per-origin limit creates measurable queuing penalty and H3's multiplexing eliminates it.

- Each scenario navigates to a harness page that triggers N `fetch()` calls concurrently.
- `Promise.all()` collects all responses; total completion time = last response to resolve.
- Resource Timing entries are read after all fetches complete.

### Payload Chunking

Pre-split fixture files (not range requests or dynamic slicing). For a scenario of total 100 KB split 10 ways, the harness fires 10 parallel requests each targeting `/payloads/10kb.bin`. Caddy serves static files with no dynamic logic for Phase A. The five fixture files cover every unique chunk and total size in the matrix:

| Total                 | 1×        | 10×          | 100×          |
| --------------------- | --------- | ------------ | ------------- |
| 10 KB                 | 10kb.bin  | 1kb.bin×10   | —             |
| 100 KB                | 100kb.bin | 10kb.bin×10  | 1kb.bin×100   |
| 1 MB                  | 1mb.bin   | 100kb.bin×10 | 10kb.bin×100  |
| 10 MB _(asset-scale)_ | 10mb.bin  | 1mb.bin×10   | 100kb.bin×100 |

Compression disabled in Caddy so nominal size = wire size. Real-world JSON compresses 5–10×, which further reduces the cost of splitting; document as a caveat that these results are conservative in favour of the split strategy.

### Scenario Matrix Definition (`scenarios.json`)

Structure to define all test configurations:

```json
{
  "payloads": [10, 100, 1000, 10000],
  "splitStrategies": {
    "10": [1, 10],
    "100": [1, 10, 100],
    "1000": [1, 10, 100],
    "10000": [1, 10, 100]
  },
  "fixtureMap": {
    "1": "1kb.bin",
    "10": "10kb.bin",
    "100": "100kb.bin",
    "1000": "1mb.bin",
    "10000": "10mb.bin"
  },
  "requestMode": "parallel",
  "repetitions": {
    "small": 100,
    "medium": 50,
    "large": 30
  },
  "warmupRuns": 5,
  "latencyProfiles": {
    "baseline": { "latency": 0, "downloadSpeed": -1, "uploadSpeed": -1 },
    "moderate-rtt": {
      "latency": 40,
      "downloadSpeed": 10240,
      "uploadSpeed": 5120
    }
  },
  "protocols": ["h1", "h3"]
}
```

### Entry Point Structure (`index.js`)

CLI interface via pnpm:

```bash
pnpm run benchmark                              # Full suite
pnpm run benchmark -- --phase a --profile baseline
pnpm run benchmark -- --phase b                 # Phase B with all cached profiles
pnpm run benchmark -- --early-hints             # Early Hints variant only
pnpm run insights                               # Post-process & generate CSVs
```

### Output Format

**Raw JSON per scenario** (e.g., `phase-a-baseline-h1-1710052800.json`):

```json
{
  "metadata": {
    "timestamp": "2026-03-26T10:00:00Z",
    "phase": "a",
    "protocol": "h1",
    "payload": 100,
    "splitCount": 10,
    "latencyProfile": "baseline"
  },
  "runs": [
    {
      "runId": 1,
      "isWarmup": false,
      "requests": [
        {
          "url": "http://localhost:8080/payload/100kb/1",
          "responseStart": 45.2,
          "responseEnd": 123.5,
          "duration": 78.3,
          "transferSize": 102400,
          "decodedBodySize": 102400
        }
      ],
      "pageCompletionTime": 456.7,
      "totalBytesTransferred": 1024000
    }
  ]
}
```

**CSV export** (materialized from JSON for Phase A summary):

```
protocol,payload_kb,split_count,p50_ms,p95_ms,p99_ms,max_ms,header_overhead_bytes
h1,100,1,78,145,189,234,512
h1,100,10,450,520,612,701,5120
h3,100,1,65,120,156,198,512
h3,100,10,89,145,183,221,5120
```

### Implementation Assumptions & Caveats

1. **CDP Throttling Caveat**: H3 (QUIC) may not throttle uniformly under `Network.emulateNetworkConditions`. Results should be marked "indicative" in reports. If H3 shows unexpected advantages in RTT phase, attribute partially to measurement artifact.

2. **Protocol Forcing via Ports**: Relies on server refusing Alt-Svc on H1 port and advertising it on H3 port. Verify Caddy config enforces this strictly.

3. **Early Hints (103)**: Chromium processes 103 responses and initiates preconnect/prefetch if headers are valid. Actual behavior depends on Chromium version. Document version used in results.

4. **Warmup Discard**: First 5 runs per config are measured but marked `isWarmup: true` and discarded from statistics. Downstream analysis filters these out.

5. **Localhost as Baseline**: No real network path means TCP retransmit/loss is absent. H3 advantages in loss recovery are not tested in Phase A baseline. Documented as out-of-scope for this round.

6. **Cache Overlay (Phase B)**: Not a real cache in the loop; post-processing script overlays hit-rate assumptions on Phase A latencies (already measured). Results are synthetic projections, not empirical network behavior.

### Dependencies

- **Node.js**: 18+
- **pnpm**: 8.0+
- **Playwright**: Latest stable (Chromium); runs on host
- **Docker Desktop**: Latest stable (macOS); provides Linux environment for Caddy + tc netem
- **Caddy**: Runs inside Docker container (no host install needed)
- **iproute2**: Included in Docker image; provides `tc netem`
- **Binary fixtures**: Pre-generated or generated at setup time.

### Locked Decisions

- Container lifecycle: **auto-managed by harness** (`start if missing`, `reuse if running`, optional teardown flag).
- Early Hints: **implemented via Node origin behind Caddy** (Node emits `103` + `Link` headers, then final `200`).
