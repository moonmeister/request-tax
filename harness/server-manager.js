import { spawn } from "node:child_process";
import path from "node:path";

const composeFile = path.resolve("docker", "docker-compose.yml");
let netemApplied = false;
let backhaulNetemApplied = false;
let frontendIface = null;
let backendIface = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForH3Listener() {
  await run("sh", [
    "-lc",
    'for i in $(seq 1 120); do docker exec request-tax-edge sh -lc "ss -lun | grep -q :8444" >/dev/null 2>&1 && exit 0; sleep 0.5; done; echo "h3 listener not ready"; exit 1',
  ]);
}

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
  await run("docker", ["compose", "-f", composeFile, "up", "-d", "--build"]);

  // Fail fast if QUIC is not reachable from host due missing UDP port publish.
  await run("sh", [
    "-lc",
    'docker port request-tax-edge 8444/udp >/dev/null 2>&1 || { echo "missing 8444/udp publish for h3"; exit 1; }',
  ]);

  // Poll for edge readiness via origin health endpoint
  await run("sh", [
    "-lc",
    'for i in $(seq 1 120); do curl -sk https://localhost:8443/health >/dev/null 2>&1 && exit 0; sleep 0.5; done; echo "edge not ready"; exit 1',
  ]);

  // Ensure the H3 listener is up before any h3 scenario starts.
  await waitForH3Listener();

  // Resolve the frontend network interface inside the edge container.
  // The default route points to the host (where published ports live),
  // so it is always on the frontend network. Origin traffic routes
  // through a separate backend interface that netem will not touch.
  const { stdout: routeOut } = await run("docker", [
    "exec",
    "request-tax-edge",
    "sh",
    "-c",
    "ip route | awk '/^default/{print $5}'",
  ]);
  frontendIface = routeOut.trim();
  if (!frontendIface) {
    throw new Error("could not resolve frontend interface in edge container");
  }

  // Resolve the backend interface (the other ethN interface).
  const { stdout: ifaceList } = await run("docker", [
    "exec",
    "request-tax-edge",
    "sh",
    "-c",
    `ip -o link show | awk -F': ' '{print $2}' | sed 's/@.*//' | grep -E '^eth[0-9]+$' | grep -v '^${frontendIface}$'`,
  ]);
  backendIface = ifaceList.trim().split("\n")[0];
  if (!backendIface) {
    throw new Error("could not resolve backend interface in edge container");
  }
}

export async function stopStack() {
  await run("docker", ["compose", "-f", composeFile, "down"]);
  frontendIface = null;
  backendIface = null;
}

export async function applyNetem(netem) {
  if (!netem) {
    if (netemApplied) {
      await clearNetem();
    }
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
    frontendIface,
    "root",
    "netem",
    ...spec,
  ]);
  netemApplied = true;
}

export async function clearNetem() {
  if (!netemApplied) {
    return;
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await run("docker", [
        "exec",
        "request-tax-edge",
        "tc",
        "qdisc",
        "del",
        "dev",
        frontendIface,
        "root",
      ]);
      break;
    } catch (error) {
      const message = String(error?.message || error);
      const noQdisc =
        message.includes("No such file") ||
        message.includes("Cannot find device") ||
        message.includes("RTNETLINK answers: No such file") ||
        message.includes("Cannot delete qdisc with handle of zero");

      if (noQdisc) {
        break;
      }

      if (attempt === 3) {
        throw error;
      }

      await sleep(200);
    }
  }

  const { stdout } = await run("docker", [
    "exec",
    "request-tax-edge",
    "tc",
    "qdisc",
    "show",
    "dev",
    frontendIface,
  ]);
  if (stdout.includes("netem")) {
    throw new Error("netem qdisc still present after clearNetem");
  }

  netemApplied = false;
}

export async function applyBackhaulNetem(delayMs) {
  if (!delayMs || delayMs <= 0) {
    return;
  }
  await run("docker", [
    "exec",
    "request-tax-edge",
    "tc",
    "qdisc",
    "replace",
    "dev",
    backendIface,
    "root",
    "netem",
    "delay",
    `${delayMs}ms`,
  ]);
  backhaulNetemApplied = true;
}

export async function clearBackhaulNetem() {
  if (!backhaulNetemApplied) {
    return;
  }
  try {
    await run("docker", [
      "exec",
      "request-tax-edge",
      "tc",
      "qdisc",
      "del",
      "dev",
      backendIface,
      "root",
    ]);
  } catch (error) {
    const message = String(error?.message || error);
    if (
      !message.includes("No such file") &&
      !message.includes("Cannot find device") &&
      !message.includes("RTNETLINK answers: No such file") &&
      !message.includes("Cannot delete qdisc with handle of zero")
    ) {
      throw error;
    }
  }
  backhaulNetemApplied = false;
}
