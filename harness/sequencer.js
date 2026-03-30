#!/usr/bin/env node

/**
 * Sequencer: Run benchmark phases in order (A → B → C)
 * with clean messaging and proper container lifecycle management.
 */

import { spawn } from "node:child_process";

function runPhase(phase) {
  return new Promise((resolve, reject) => {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Starting Phase ${phase.toUpperCase()}`);
    console.log(`${"=".repeat(60)}\n`);

    const child = spawn(
      "node",
      [
        "harness/index.js",
        "--phase",
        phase,
        ...(process.argv.includes("--smoke") ? ["--smoke"] : []),
      ],
      { stdio: "inherit" },
    );

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        console.log(`\n✓ Phase ${phase.toUpperCase()} completed`);
        resolve();
      } else {
        reject(
          new Error(`Phase ${phase.toUpperCase()} failed with code ${code}`),
        );
      }
    });
  });
}

async function main() {
  const phases = ["a", "b", "c"];
  const startTime = Date.now();

  try {
    for (const phase of phases) {
      await runPhase(phase);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n${"=".repeat(60)}`);
    console.log(`✓ All phases completed in ${duration}s`);
    console.log(`${"=".repeat(60)}`);
    console.log("\nResults available in:");
    console.log("  - Raw JSON: results/raw/*.json");
    console.log("  - Summary CSV: results/analysis/phase-{a,b,c}-summary.csv");
    console.log();
  } catch (error) {
    console.error(`\n✗ Benchmark failed: ${error.message}`);
    process.exit(1);
  }
}

main();
