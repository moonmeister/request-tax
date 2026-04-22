## Implementation Guide: HTTP/1.1 vs HTTP/3 Request Granularity Benchmark

This document reflects the current benchmark implementation and known caveats.

Related planning note:

- See DATA_PROCESSING_AND_CLEANUP_PLAN.md for the analysis-first cleanup plan (summaries, insights repurpose, and storage format decisions).

### Toolchain Details

#### Server: Caddy + Cache Handler

- Why: native HTTP/3 support, simple TLS setup, and CDN-like edge cache behavior.
- Build: `xcaddy build --with github.com/caddyserver/cache-handler` in `docker/Dockerfile`.
- Runtime config: `docker/Caddyfile`.
- Protocol forcing:
  - `:8443` is HTTP/1.1 only (`protocols h1`)
  - `:8444` is HTTP/3 only (`protocols h3`)
  - HTTP/2 is intentionally disabled for this benchmark.
- Phase 1 serves payloads directly from Caddy (`/edge-payload/*`), bypassing origin.
- Phase 2 uses origin-backed cache with invalidation (`/payload/*`).

#### Origin: Node HTTP Server

- Purpose:
  - Serves binary payload fixtures from `server/payloads`
  - Emits benchmark page (`/bench`)
  - Applies response cache headers based on scenario (`cacheTtl`)
- Location: `server/handlers/origin.js`

#### Client: Playwright (Chromium)

- Why: browser-realistic parallel request behavior and Resource Timing API metrics.
- Per-run flow:
  - Launch headless Chromium
  - Navigate to benchmark page on protocol-specific port
  - Wait for `window.__BENCH_RESULT`
  - Collect page completion and request timing entries

### Network Simulation

Network impairment is applied with Linux `tc netem` inside the edge container via `docker exec` from `harness/server-manager.js`.

- Supported controls:
  - Delay (`delayMs`)
  - Packet loss (`lossPct`)
- Current profile strategy:
  - `baseline`: no netem
  - `moderate-rtt`: netem delay (40ms), no loss
  - `loss-0.5pct`, `loss-1pct`, `loss-3pct`: netem delay + packet loss

CDP throttling remains supported by the runner when a profile provides `cdp`, but the default RTT/loss scenarios now use netem for both protocols.

### Caching Phase

#### Phase 2: Selective Invalidation

- Workflow:
  1. Warm cache with `warm-<token>` version URLs.
  2. Re-request with mixed versions where only a subset uses `purge-<token>`.
- Invalidation profiles:
  - `full-purge`
  - `partial-purge-20pct`
  - `partial-purge-40pct`

This models partial staleness/hit-miss mixes in a deterministic, repeatable way.

### Project Structure

```text
request-tax/
├── docker/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── Caddyfile
├── server/
│   ├── handlers/origin.js
│   └── payloads/
├── harness/
│   ├── index.js
│   ├── scenarios.json
│   ├── server-manager.js
│   ├── sequencer.js
│   ├── playwright/
│   │   ├── test-runner.js
│   └── utils/
│       ├── config.js
│       ├── timing.js
│       └── csv-export.js
├── results/
│   ├── raw/
│   └── analysis/
└── package.json
```

### Scenario Definition

Primary config file: `harness/scenarios.json`

- Payload matrix and split strategies
- Repetitions and warmup count
- Protocol list (`h1`, `h3`)
- Phase 2 invalidation profiles (`phase2.invalidationProfiles`)
- Network profiles (`profiles`) with `cdp` and/or `netem`

### Execution Scripts

From `package.json`:

- `pnpm benchmark`
- `pnpm phase:1`
- `pnpm phase:2`
- `pnpm smoke:1`
- `pnpm smoke:2`
- `pnpm smoke:all`
- `pnpm run:all`

### Output Format

Raw results are written to `results/raw` (JSON per scenario). Summaries are written to `results/analysis` as CSV.

Metadata includes:

- `phase`, `protocol`, `profileName`
- `cacheProfile`, `cacheScope`, `cacheTtl`, `payloadMode`, `originBypassed`
- `invalidationProfile`, `staleChunks`
- Payload/split/chunk dimensions
- Warmup/measured run counts

### Current Caveats

1. Docker Desktop on macOS adds a small latency floor due to virtualization. This affects absolute timings more than relative H1 vs H3 deltas.
2. Browser-level measurement includes renderer/scheduling overhead (small fixed noise floor).
3. Cache-handler purge APIs are not relied upon for correctness. Phase 2 isolation is achieved through URL namespacing instead.

### Locked Decisions

1. Compare HTTP/1.1 vs HTTP/3 only (no HTTP/2).
2. Enforce protocol separation by dedicated ports (`8443` h1, `8444` h3).
3. Use deterministic URL-version invalidation for Phase 2.
4. Keep stack lifecycle harness-managed (`startStack`, `stopStack`, `applyNetem`, `clearNetem`).

## H3/QUIC Debugging & Certificate Pinning

### Issue: Chrome QUIC Handshake Failure with Caddy Internal CA

**Symptom:** Playwright tests against `localhost:8444` or `127.0.0.1:8444` failing with `net::ERR_QUIC_PROTOCOL_ERROR` (post-handshake) or `net::ERR_CONNECTION_REFUSED` (IPv6).

**Root Cause:** Caddy uses an internal PKI to sign TLS certificates for local development. Chrome's QUIC implementation validates certificates as part of the encrypted handshake, before the HTTP layer. The `--ignore-certificate-errors` flag does **not** bypass QUIC's TLS verification—it only affects HTTP-level checks.

**Solution:** Use SPKI (Subject Public Key Info) pinning via `--ignore-certificate-errors-spki-list` to trust Caddy's internal CA and leaf certificates:

```bash
--ignore-certificate-errors-spki-list=My2o4CoamAqbidlf8rd0uweKA6kRl7Ak7gVHZDMjxvc=,hNz7CpXHWXHPQPpsrC9Vmw6pJemkmhqFfMvwt11K0P4=
```

- **Root CA SPKI:** `My2o4CoamAqbidlf8rd0uweKA6kRl7Ak7gVHZDMjxvc=` (from `/data/caddy/pki/authorities/local/root.crt` in the container)
- **Leaf Cert SPKI:** `hNz7CpXHWXHPQPpsrC9Vmw6pJemkmhqFfMvwt11K0P4=` (from the live TLS handshake on port 8444)

### Diagnostic Scripts

- **`scripts/h3-spki-smoke.mjs`** – Quick standalone test. Optionally auto-detects SPKI hashes from the Docker container: `node scripts/h3-spki-smoke.mjs --auto`
- **`scripts/lib-spki-utils.mjs`** – Shared utility for extracting and formatting SPKI hashes. Used by matrix and other runners.
- **`scripts/playlist-h3-matrix.mjs`** – Updated to auto-extract SPKI hashes and inject the pinning flag before launching each Chromium instance.
- **`scripts/find-localhost-session.mjs`** – Analyzes netlog for QUIC session events; useful for diagnosing certificate or handshake failures.

### Matrix Results (H3 with Pinning)

All 12 cells of the Playwright H3 connectivity matrix now pass:

- **localhost:8444** – HTTP 200 over h3 ✅
- **127.0.0.1:8444** – HTTP 200 over h3 ✅
- **[::1]:8444** – HTTP 200 over h2 (IPv6 h3 support pending) ✅
