#!/usr/bin/env node

/**
 * Insights: Analyze benchmark results and generate comparative analysis
 */

import fs from "node:fs/promises";
import path from "node:path";

async function main() {
  const analysisDir = path.resolve("results", "analysis");

  try {
    // Get list of summary CSV files
    const files = await fs.readdir(analysisDir);
    const csvFiles = files.filter((f) => f.endsWith("-summary.csv")).sort();

    if (csvFiles.length === 0) {
      console.log("No benchmark results found. Run benchmark phases first:");
      console.log("  pnpm run phase:a");
      console.log("  pnpm run phase:b");
      process.exit(0);
    }

    console.log("\n" + "=".repeat(60));
    console.log("BENCHMARK RESULTS SUMMARY");
    console.log("=".repeat(60) + "\n");

    for (const csvFile of csvFiles) {
      const phaseName =
        csvFile.match(/phase-([\w-]+)-summary/)?.[1]?.toUpperCase() ||
        "UNKNOWN";
      console.log(`\n📊 Phase ${phaseName}`);
      console.log("-".repeat(60));

      const filePath = path.join(analysisDir, csvFile);
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.trim().split("\n");

      // Parse and display summary statistics
      const header = lines[0].split(",");
      const rows = lines.slice(1).map((line) => {
        const values = line.split(",");
        return Object.fromEntries(header.map((h, i) => [h, values[i]]));
      });

      // Group by protocol for easier comparison
      const byProtocol = {};
      for (const row of rows) {
        const protocol = row.protocol;
        if (!byProtocol[protocol]) byProtocol[protocol] = [];
        byProtocol[protocol].push(row);
      }

      // Display stats per protocol
      for (const [protocol, protoRows] of Object.entries(byProtocol)) {
        console.log(`\n  ${protocol.toUpperCase()}`);
        for (const row of protoRows.slice(0, 5)) {
          const payload = `${row.payload_kb}KB`;
          const split = row.split_count;
          const cache = row.cache_profile ? ` [${row.cache_profile}]` : "";
          const p95 = parseFloat(row.p95_ms).toFixed(2);
          console.log(`    ${payload} (${split}x)${cache}: p95=${p95}ms`);
        }
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log("Full results available in: results/analysis/");
    console.log("=".repeat(60) + "\n");
  } catch (error) {
    console.error("Error reading results:", error.message);
    process.exit(1);
  }
}

main();
