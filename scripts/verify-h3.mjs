import { chromium } from "playwright";
import {
  extractCaddySPKI,
  buildSpkiFlag,
} from "../harness/utils/caddy-cert.js";

const TARGET_URL =
  process.argv[2] ||
  process.env.H3_VERIFY_URL ||
  "https://localhost:8444/health";
const url = new URL(TARGET_URL);
const originHostPort = `${url.hostname}:${url.port || "443"}`;

async function getBrowserArgs() {
  const pins = await extractCaddySPKI(String(url.port || "8444"));
  const spkiFlag = buildSpkiFlag(pins);

  return [
    "--enable-quic",
    `--origin-to-force-quic-on=${originHostPort}`,
    "--allow-insecure-localhost",
    spkiFlag,
  ];
}

async function main() {
  const args = await getBrowserArgs();
  const browser = await chromium
    .launch({ channel: "chrome", headless: true, args })
    .catch(() => {
      return chromium.launch({ headless: true, args });
    });

  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  try {
    const response = await page.goto(TARGET_URL, {
      waitUntil: "load",
      timeout: 20_000,
    });
    const status = response?.status() ?? null;

    const diagnostics = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      const resources = performance.getEntriesByType("resource");
      const protocols = resources
        .map((entry) => entry.nextHopProtocol)
        .filter(Boolean);

      const uniqueProtocols = [...new Set(protocols)];
      return {
        navigationProtocol: nav?.nextHopProtocol || null,
        resourceProtocols: uniqueProtocols,
      };
    });

    const navProtocol = diagnostics.navigationProtocol;
    const resourceProtocols = diagnostics.resourceProtocols;
    const allH3 =
      navProtocol === "h3" && resourceProtocols.every((p) => p === "h3");

    console.log(`URL: ${TARGET_URL}`);
    console.log(`HTTP status: ${status}`);
    console.log(`navigationProtocol: ${navProtocol}`);
    console.log(
      `resourceProtocols: ${resourceProtocols.length ? resourceProtocols.join(", ") : "(none)"}`,
    );

    if (!allH3) {
      console.error("\nH3 verification failed: observed non-h3 protocol(s).");
      process.exitCode = 1;
      return;
    }

    console.log("\nH3 verification passed.");
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
