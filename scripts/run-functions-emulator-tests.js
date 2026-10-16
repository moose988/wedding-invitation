#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

if (Number(process.versions.node.split(".")[0]) < 22) {
  process.stderr.write("Run this test runner with Node.js 22 or newer.\n");
  process.exit(2);
}

const secretFile = join(__dirname, "..", "functions", ".secret.local");
if (existsSync(secretFile)) {
  process.stderr.write("Refusing to replace functions/.secret.local. Move the existing local secret file aside, then retry.\n");
  process.exit(2);
}

writeFileSync(secretFile, `INVITATION_TOKEN_ENCRYPTION_KEY=${randomBytes(48).toString("base64")}\n`, { flag: "wx", mode: 0o600 });
const nodeDir = dirname(process.execPath);
const env = { ...process.env, PATH: `${nodeDir}${delimiter}${process.env.PATH || ""}` };
const innerCommand = `"${process.execPath}" --test --test-reporter=spec tests/functions-emulator.test.mjs`;
const child = process.platform === "win32"
  ? spawn("powershell.exe", [
      "-NoProfile", "-Command",
      `& firebase.cmd emulators:exec --only auth,firestore,functions --project demo-wedding-security '${innerCommand.replaceAll("'", "''")}'`,
    ], { env, stdio: "inherit" })
  : spawn("firebase", [
      "emulators:exec", "--only", "auth,firestore,functions", "--project", "demo-wedding-security", innerCommand,
    ], { env, stdio: "inherit" });

child.on("error", (error) => {
  process.stderr.write(`Could not start Firebase Emulator Suite: ${error.message}\n`);
  cleanup();
  process.exitCode = 1;
});
child.on("close", (code, signal) => {
  cleanup();
  process.exitCode = code ?? (signal ? 1 : 0);
});

function cleanup() {
  if (existsSync(secretFile)) unlinkSync(secretFile);
}
