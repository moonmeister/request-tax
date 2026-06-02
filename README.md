# The Request Tax – HTTP/1.1 vs HTTP/3

A talk exploring whether bundling is still necessary in the age of HTTP/3, backed by benchmark data comparing request granularity and caching strategies across protocol versions.

## View the Presentation

```sh
pnpm install
pnpm slides
```

This starts a local server and opens the [reveal.js](https://revealjs.com/) slide deck in your browser.

## Talk Summary

1. **The Problem** – HTTP/1.1 constraints (head-of-line blocking, 6 connections per origin, TCP slow start) forced the web into aggressive bundling, which hurts cache efficiency.
2. **The Solution** – HTTP/2 partially fixed multiplexing but kept TCP-level issues. HTTP/3 over QUIC eliminates head-of-line blocking, slow start penalties, and handshake latency with independent streams.
3. **The Data** – Benchmarks measuring how splitting payloads into many small requests compares to single large requests under varying RTT and packet-loss conditions across H1 and H3.
4. **Takeaways** – On HTTP/3, developers should optimize for caching over network round-trips. Framework and bundler authors should reconsider whether large bundles are still the right default.

## Additional Resources

- [HTTP/3 vs HTTP/2](https://blog.cloudflare.com/http-3-vs-http-2/) – Cloudflare metrics circa 2020 on what they're seeing in their networks
- [HTTP/3 vs HTTP/2 Performance](https://www.debugbear.com/blog/http3-vs-http2-performance) – Good overview and comparison of the two protocols
- [HTTP/3 Usage One Year On](https://blog.cloudflare.com/http3-usage-one-year-on/) – Cloudflare data on HTTP usage circa 2023
- [Cloudflare Radar: Adoption and Usage](https://radar.cloudflare.com/adoption-and-usage) – Real-time Cloudflare data on protocol adoption
- [HTTP/3 is Fast](https://requestmetrics.com/web-performance/http3-is-fast/) – Stats on HTTP/3 performance from Request Metrics
- [HPACK: The Silent Killer Feature of HTTP/2](https://blog.cloudflare.com/hpack-the-silent-killer-feature-of-http-2/) – Info on HPACK header compression in HTTP/2
- [HTTP/3 From A To Z: Core Concepts](https://www.smashingmagazine.com/2021/08/http3-core-concepts-part1/) – In-depth explainer of QUIC and HTTP/3 internals by Robin Marx
- [HTTP/3 explained](https://http3-explained.haxx.se/) – Free online book covering the full protocol stack by Daniel Stenberg (curl maintainer)
- [RFC 9114: HTTP/3](https://www.rfc-editor.org/rfc/rfc9114) – The official HTTP/3 specification
- [Web Almanac: HTTP](https://almanac.httparchive.org/en/2022/http) – HTTP Archive's data-driven look at real-world HTTP/2 and HTTP/3 adoption
