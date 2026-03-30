import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const payloadRoot = path.resolve(__dirname, "..", "payloads");
const port = Number(process.env.ORIGIN_PORT || 3000);

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function html(res, body) {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    pragma: "no-cache",
  });
  res.end(body);
}

function parseUrl(req) {
  const url = new URL(req.url || "/", "http://origin.local");
  return url;
}

function benchPage({
  fileName,
  chunks,
  cacheTtl,
  cacheScope,
  invalidationProfile,
  staleChunks,
}) {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>bench</title></head>
<body>
<script>
(async () => {
  const chunks = ${JSON.stringify(chunks)};
  const fileName = ${JSON.stringify(fileName)};
  const cacheTtl = ${JSON.stringify(cacheTtl || null)};
  const cacheScope = ${JSON.stringify(cacheScope || null)};
  const invalidationProfile = ${JSON.stringify(invalidationProfile || null)};
  const staleChunks = ${JSON.stringify(staleChunks || 0)};
  const useCache = !!cacheTtl;
  const runToken = String(Date.now());

  function makeUrl(i, version) {
    let u = '/payload/' + fileName + '?n=' + i;
    if (useCache) {
      u += '&cacheTtl=' + cacheTtl;
    } else {
      u += '&ts=' + runToken;
    }
    if (version) {
      u += '&v=' + version;
    }
    if (cacheScope) {
      u += '&scope=' + encodeURIComponent(cacheScope);
    }
    return u;
  }

  let requests;
  let start;
  let end;

  if (invalidationProfile) {
    // Warm cache first.
    const warmVersion = 'warm-' + runToken;
    const warmRequests = Array.from({ length: chunks }, (_, i) => makeUrl(i, warmVersion));
    await Promise.all(warmRequests.map((u) => fetch(u, { cache: 'no-store' }).then((r) => r.arrayBuffer())));

    // Then invalidate selected chunks by changing their version token only.
    const purgeVersion = 'purge-' + runToken;
    const staleSet = new Set(
      Array.from({ length: Math.min(chunks, Math.max(1, staleChunks)) }, (_, i) => i)
    );

    requests = Array.from({ length: chunks }, (_, i) =>
      makeUrl(i, staleSet.has(i) ? purgeVersion : warmVersion)
    );

    performance.clearResourceTimings();
    start = performance.now();
    await Promise.all(requests.map((u) => fetch(u, { cache: 'no-store' }).then((r) => r.arrayBuffer())));
    end = performance.now();
  } else {
    requests = Array.from({ length: chunks }, (_, i) => makeUrl(i));
    performance.clearResourceTimings();
    start = performance.now();
    await Promise.all(requests.map((u) => fetch(u, { cache: 'no-store' }).then((r) => r.arrayBuffer())));
    end = performance.now();
  }

  const entries = performance
    .getEntriesByType('resource')
    .filter((e) => e.name.includes('/payload/'))
    .map((e) => ({
      name: e.name,
      startTime: e.startTime,
      responseStart: e.responseStart,
      responseEnd: e.responseEnd,
      duration: e.duration,
      nextHopProtocol: e.nextHopProtocol,
      transferSize: e.transferSize,
      decodedBodySize: e.decodedBodySize
    }));

  const navigationEntry = performance.getEntriesByType('navigation')[0];

  window.__BENCH_RESULT = {
    pageCompletionTime: end - start,
    requestCount: requests.length,
    entries,
    navigationProtocol: navigationEntry ? navigationEntry.nextHopProtocol : null,
    invalidationProfile,
    staleChunks
  };

  document.body.textContent = 'done';
})();
</script>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = parseUrl(req);

    if (url.pathname === "/health") {
      return json(res, 200, { ok: true });
    }

    if (url.pathname.startsWith("/payload/")) {
      const fileName = path.basename(url.pathname.replace("/payload/", ""));
      const abs = path.join(payloadRoot, fileName);
      const buffer = await fs.readFile(abs);

      const cacheTtl = url.searchParams.get("cacheTtl");
      const headers = {
        "content-type": "application/octet-stream",
        "content-length": buffer.length,
      };

      if (cacheTtl && Number(cacheTtl) > 0) {
        headers["cache-control"] = `public, max-age=${cacheTtl}`;
        headers["x-cache-ttl"] = cacheTtl;
      } else {
        headers["cache-control"] = "no-store";
        headers["pragma"] = "no-cache";
      }

      res.writeHead(200, headers);
      res.end(buffer);
      return;
    }

    if (url.pathname === "/bench") {
      const file = url.searchParams.get("file") || "10kb.bin";
      const chunks = Number(url.searchParams.get("chunks") || 1);
      const cacheTtl = url.searchParams.get("cacheTtl");
      const cacheScope = url.searchParams.get("cacheScope");
      const invalidationProfile = url.searchParams.get("invalidationProfile");
      const staleChunks = Number(url.searchParams.get("staleChunks") || 0);
      return html(
        res,
        benchPage({
          fileName: file,
          chunks,
          cacheTtl,
          cacheScope,
          invalidationProfile,
          staleChunks,
        }),
      );
    }

    if (url.pathname === "/bench-early-hints") {
      const file = url.searchParams.get("file") || "10kb.bin";
      const chunks = Number(url.searchParams.get("chunks") || 1);
      const cacheTtl = url.searchParams.get("cacheTtl");
      const cacheScope = url.searchParams.get("cacheScope");
      const links = Array.from(
        { length: chunks },
        (_, i) => `</payload/${file}?n=${i}>; rel=preload; as=fetch`,
      );

      if (typeof res.writeEarlyHints === "function") {
        res.writeEarlyHints({ link: links });
      }

      return html(
        res,
        benchPage({ fileName: file, chunks, cacheTtl, cacheScope }),
      );
    }

    json(res, 404, { error: "not_found" });
  } catch (error) {
    json(res, 500, { error: String(error) });
  }
});

server.listen(port, () => {
  console.log(`origin listening on :${port}`);
});
