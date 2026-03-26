import { chromium } from "playwright";

function portForProtocol(protocol) {
  return protocol === "h3" ? 8444 : 8443;
}

export async function runBrowserScenario({
  protocol,
  file,
  splitCount,
  profile,
  earlyHints,
  cacheTtl,
  cacheScope,
  invalidationProfile,
  staleChunks,
}) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);

  if (profile?.cdp) {
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", profile.cdp);
  }

  const path = earlyHints ? "/bench-early-hints" : "/bench";
  const params = new URLSearchParams({
    file: file,
    chunks: splitCount,
  });
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
  const url = `https://localhost:${portForProtocol(protocol)}${path}?${params.toString()}`;

  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__BENCH_RESULT, {
    timeout: 60_000,
  });
  const result = await page.evaluate(() => window.__BENCH_RESULT);

  await context.close();
  await browser.close();
  return result;
}
