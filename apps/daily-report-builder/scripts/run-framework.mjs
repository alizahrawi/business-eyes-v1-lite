import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readExecutionProfile } from "./execution-profile.mjs";

const [command, ...args] = process.argv.slice(2);
if (!["dev", "build"].includes(command)) throw new Error("Expected dev or build.");
const managedLinux = readExecutionProfile() === "managed-linux";

if (managedLinux && command === "build") {
  const result = spawnSync("bash", [
    fileURLToPath(new URL("./build-verified.sh", import.meta.url)), ...args,
  ], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

// Import in this process so the preview owner retains its PID and signals.
// npm workspaces may install the CLI either locally or at the repository root.
const cliPath = managedLinux
  ? "node_modules/vite/bin/vite.js"
  : "node_modules/vinext/dist/cli.js";
const cliCandidates = [
  new URL(`../${cliPath}`, import.meta.url),
  new URL(`../../../${cliPath}`, import.meta.url),
];
const cli = cliCandidates.find((candidate) => existsSync(fileURLToPath(candidate)));

if (!cli) {
  throw new Error(`Could not locate ${cliPath}. Run npm install from the repository root.`);
}
process.argv = [process.execPath, fileURLToPath(cli), command,
  ...(!managedLinux && command === "dev" ? ["--port", "5173"] : []), ...args];
await import(cli.href);
