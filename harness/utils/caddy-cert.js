/**
 * Certificate pinning utilities for Caddy's internal CA.
 * Extracted for use across both diagnostic and benchmark harnesses.
 */

import { execSync } from "node:child_process";

const EMPTY_INPUT_SPKI = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";

/**
 * Extract SPKI hashes from Caddy container.
 * Returns [rootSpki, leafSpki] for use with --ignore-certificate-errors-spki-list
 */
export async function extractCaddySPKI(port = "8444") {
  try {
    // Root CA from Caddy's internal PKI
    execSync(
      "docker cp request-tax-edge:/data/caddy/pki/authorities/local/root.crt /tmp/caddy-root.crt 2>/dev/null",
      {
        stdio: "ignore",
      },
    );

    const root = execSync(
      `openssl x509 -in /tmp/caddy-root.crt -pubkey -noout 2>/dev/null | ` +
        `openssl pkey -pubin -outform der 2>/dev/null | openssl dgst -sha256 -binary | base64`,
    )
      .toString()
      .trim();

    if (!root) {
      throw new Error("empty root SPKI extracted from Caddy root cert");
    }

    // Leaf cert from live TLS over TCP may be unavailable for strict h3-only listeners.
    let leaf = "";
    try {
      leaf = execSync(
        `echo | openssl s_client -connect localhost:${port} -servername localhost 2>/dev/null | ` +
          `openssl x509 -pubkey -noout 2>/dev/null | openssl pkey -pubin -outform der 2>/dev/null | openssl dgst -sha256 -binary | base64`,
      )
        .toString()
        .trim();
    } catch {
      // Optional in strict h3 mode; root pin is sufficient.
    }

    return [root, leaf].filter(
      (value) => Boolean(value) && value !== EMPTY_INPUT_SPKI,
    );
  } catch (err) {
    throw new Error(`Failed to extract Caddy SPKI: ${err.message}`);
  }
}

/**
 * Build Chrome SPKI pinning flag
 */
export function buildSpkiFlag(spkiHashes) {
  return `--ignore-certificate-errors-spki-list=${spkiHashes.join(",")}`;
}
