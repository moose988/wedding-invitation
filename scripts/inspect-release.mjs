// Read-only control-plane verification; never enumerates application records.
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url);
const root = process.env.FIREBASE_CLI_LIB;
if (!root) throw new Error("Set FIREBASE_CLI_LIB to the installed CLI lib directory.");
const { configstore } = require(`${root}/configstore.js`);
const { getAccessToken } = require(`${root}/auth.js`);
const credentials = await getAccessToken(configstore.get("tokens").refresh_token, []);
async function get(url) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${credentials.access_token}` } });
  if (!response.ok) throw new Error(`Control-plane request failed (${response.status}).`);
  return response.json();
}
const project = "weddinginvitaion-b4f36";
const release = await get(`https://firebaserules.googleapis.com/v1/projects/${project}/releases/cloud.firestore`);
const rules = await get(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`);
const billing = await get(`https://cloudbilling.googleapis.com/v1/projects/${project}/billingInfo`);
const hash = (value) => createHash("sha256").update(value.replace(/\r\n/g, "\n")).digest("hex");
const local = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
const active = rules.source.files.find((file) => file.name.endsWith(".rules")).content;
const head = execFileSync("git", ["show", "HEAD:firestore.rules"], { encoding: "utf8" });
console.log(JSON.stringify({ project, ruleset: release.rulesetName, rulesUpdatedAt: release.updateTime, activeRulesSha256: hash(active), headRulesSha256: hash(head), workingRulesSha256: hash(local), rulesMatchHead: hash(active) === hash(head), rulesMatch: hash(active) === hash(local), billingEnabled: billing.billingEnabled }, null, 2));
