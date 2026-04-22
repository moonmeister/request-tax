## Methodology

- **Edge:** Caddy + quic-go (H1 on :8443, H3 on :8444)
- **Origin:** Node.js HTTP/1.1 server
- **Client:** Playwright / Chromium → Resource Timing API
- **Network:** tc netem on client↔edge (frontend), 20ms backhaul to origin

---

## Two Phases

1. **Phase 1:** The Wire — payload × split × network profile
2. **Phase 2:** The Cache — invalidation retention under full/partial purge
