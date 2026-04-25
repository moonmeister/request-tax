## Alex Moon

**Developer Advocate @ WP Engine**

- Person who would rather be outdoors
- Web Developer for ~10 years
- Past life as Sys. Admin
- [github.com/moonmeister](https://github.com/moonmeister)

---

## Methodology

- **Edge:** Caddy
- **Origin:** Node.js HTTP/1.1 server
- **Client:** Playwright / Chromium
- **Network:** tc netem on client↔edge (frontend), 20ms backhaul to origin

---

## Two Phases

1. **Phase 1:** The Wire — payload × split × network profile - just Caddy
2. **Phase 2:** The Cache — invalidation retention under full/partial purge - Caddy + Origin
