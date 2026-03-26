import { runBrowserScenario } from "./test-runner.js";

export async function runEarlyHintsScenario(input) {
  return runBrowserScenario({ ...input, earlyHints: true });
}
