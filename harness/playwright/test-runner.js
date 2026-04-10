import { chromium } from "playwright";
import { extractCaddySPKI, buildSpkiFlag } from "../utils/caddy-cert.js";

// Cache SPKI hashes for the benchmark run
let cachedSpkiFlag = null;

async function getSpkiFlag() {
  if (!cachedSpkiFlag) {
    try {
      const [root, leaf] = await extractCaddySPKI(8444);
      cachedSpkiFlag = buildSpkiFlag([root, leaf]);
    } catch (err) {
      console.warn(`⚠️  Could not extract SPKI: ${err.message}`);
      cachedSpkiFlag = "--ignore-certificate-errors";
    }
  }
  return cachedSpkiFlag;
}

function portForProtocol(protocol) {
  return protocol === "h3" ? 8444 : 8443;
}

async function launchBrowser(protocol, host) {
  if (protocol === "h3") {
    const spkiFlag = await getSpkiFlag();
    const h3Args = [
      "--enable-quic",
      `--origin-to-force-quic-on=${host}:8444`,
      "--allow-insecure-localhost",
      spkiFlag,
    ];

    // Prefer local Chrome for h3 because bundled Chromium can be flaky for QUIC.
    try {
      return await chromium.launch({
        channel: "chrome",
        headless: true,
        args: h3Args,
      });
    } catch {
      return chromium.launch({
        headless: true,
        args: h3Args,
      });
    }
  }

  return chromium.launch({ headless: true });
}

async function runOnce({ launchProtocol, protocolProfile, url, profile }) {
  let browser;
  let context;
  try {
    browser = await launchBrowser(launchProtocol, protocolProfile);
    context = await browser.newContext({
      ignoreHTTPSErrors: true,
    });

    const page = await context.newPage();
    page.setDefaultTimeout(1_000_000);

    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => !!window.__BENCH_RESULT);
    const result = await page.evaluate(() => window.__BENCH_RESULT);

    await context.close();
    await browser.close();
    return result;
  } finally {
    if (context) {
      try {
        await context.close();
      } catch {}
    }
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
  }
}

export async function runBrowserScenario({
  protocol,
  file,
  splitCount,
  profile,
  cacheTtl,
  cacheScope,
  payloadMode,
  invalidationProfile,
  staleChunks,
}) {
  const path = "/bench";
  const params = new URLSearchParams({
    file: file,
    chunks: splitCount,
  });
  if (payloadMode && payloadMode !== "origin-proxy") {
    params.set("payloadMode", payloadMode);
  }
  if (cacheTtl > 0) {
    params.set("cacheTtl", cacheTtl);
  }
  if (cacheScope) {
    params.set("cacheScope", cacheScope);
  }
  if (invalidationProfile) {
    params.set("invalidationProfile", invalidationProfile);
    params.set("staleChunks", String(staleChunks || 1));
  }
  const host = "localhost";
  const url = `https://${host}:${portForProtocol(protocol)}${path}?${params.toString()}`;
  const allowH3Fallback =
    String(process.env.H3_ALLOW_FALLBACK || "").toLowerCase() === "true";
  let lastError;

  try {
    return await runOnce({
      launchProtocol: protocol,
      protocolProfile: host,
      url,
      profile,
    });
  } catch (error) {
    lastError = error;
  }

  // Optional compatibility fallback for diagnostics only.
  // Default behavior is strict: h3 scenario must stay h3.
  if (protocol === "h3" && allowH3Fallback) {
    const fallbackTargets = [
      `https://localhost:8444${path}?${params.toString()}`,
      `https://localhost:8443${path}?${params.toString()}`,
    ];

    for (const fallbackUrl of fallbackTargets) {
      try {
        const result = await runOnce({
          launchProtocol: "h1",
          protocolProfile: "localhost",
          url: fallbackUrl,
          profile,
        });
        return {
          ...result,
          fallbackUsed: true,
          fallbackReason: String(lastError?.message || lastError),
          fallbackUrl,
        };
      } catch {
        // Try next fallback target.
      }
    }
  }

  if (protocol === "h3") {
    throw new Error(
      `Strict h3 run failed without fallback. Set H3_ALLOW_FALLBACK=true for diagnostics. Original error: ${String(lastError?.message || lastError)}`,
    );
  }

  throw lastError;
}
