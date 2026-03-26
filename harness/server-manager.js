import { spawn } from "node:child_process";
import path from "node:path";

const composeFile = path.resolve("docker", "docker-compose.yml");

function run(command, args, { stdio = "pipe" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio,
      env: {
        ...process.env,
        PATH: `${process.env.PATH || ""}:/Applications/Docker.app/Contents/Resources/bin:/usr/local/bin:/usr/bin:/bin`,
      },
    });
    let stdout = "";
    let stderr = "";

    if (child.stdout)
      child.stdout.on("data", (d) => {
        stdout += d.toString();
      });
    if (child.stderr)
      child.stderr.on("data", (d) => {
        stderr += d.toString();
      });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(
          new Error(
            `${command} ${args.join(" ")} failed (${code})\n${stderr || stdout}`,
          ),
        );
    });
  });
}

export async function startStack() {
  await run("docker", ["compose", "-f", composeFile, "up", "-d", "--build"], {
    stdio: "inherit",
  });

  // Poll for edge readiness via origin health endpoint
  await run("sh", [
    "-lc",
    'for i in $(seq 1 120); do curl -sk https://localhost:8443/health >/dev/null 2>&1 && exit 0; sleep 0.5; done; echo "edge not ready"; exit 1',
  ]);
}

export async function stopStack() {
  await run("docker", ["compose", "-f", composeFile, "down"], {
    stdio: "inherit",
  });
}

export async function resetEdgeCache() {
  await run("docker", ["restart", "request-tax-edge"]);
  await run("sh", [
    "-lc",
    'for i in $(seq 1 120); do /usr/bin/curl -sk https://localhost:8443/health >/dev/null 2>&1 && exit 0; sleep 0.5; done; echo "edge not ready after restart"; exit 1',
  ]);
}

export async function applyNetem(netem) {
  if (!netem) {
    await clearNetem();
    return;
  }
  const delayMs = Number(netem.delayMs || 0);
  const lossPct = Number(netem.lossPct || 0);
  const spec = ["delay", `${delayMs}ms`, "loss", `${lossPct}%`];

  await run("docker", [
    "exec",
    "request-tax-edge",
    "tc",
    "qdisc",
    "replace",
    "dev",
    "eth0",
    "root",
    "netem",
    ...spec,
  ]);
}

export async function clearNetem() {
  try {
    await run("docker", [
      "exec",
      "request-tax-edge",
      "tc",
      "qdisc",
      "del",
      "dev",
      "eth0",
      "root",
    ]);
  } catch {
    // No qdisc is fine.
  }
}
