// Read-only audit using the developer's Firebase CLI IAM session. No service
// account keys or credentials are read into the frontend or written to disk.
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
const require = createRequire(import.meta.url);
const root = process.env.FIREBASE_CLI_LIB;
if (!root) throw new Error("Set FIREBASE_CLI_LIB to the installed Firebase CLI lib directory.");
const { configstore } = require(`${root}/configstore.js`);
const { getAccessToken } = require(`${root}/auth.js`);
const token = await getAccessToken(configstore.get("tokens").refresh_token, []);
const headers = { Authorization: `Bearer ${token.access_token}` };
const project = "weddinginvitaion-b4f36";
async function get(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Audit request failed: ${response.status} ${new URL(url).pathname}`);
  return response.json();
}
const release = await get(`https://firebaserules.googleapis.com/v1/projects/${project}/releases/cloud.firestore`);
const activeRules = await get(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`);
const billing = await get(`https://cloudbilling.googleapis.com/v1/projects/${project}/billingInfo`);
const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
const hash = (value) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
const event = await get(`${base}/weddings/luxury-wedding-demo`);
const report = { auditedAt: new Date().toISOString(), ruleset: release.rulesetName, billingEnabled: billing.billingEnabled, ownerUserId: event.fields.ownerUserId?.stringValue, seatingSchemaVersion: event.fields.seatingSchemaVersion?.integerValue || null, data: {} };
report.rulesSha256 = createHash("sha256").update(activeRules.source.files.find((file) => file.name.endsWith(".rules")).content.replace(/\r\n/g, "\n")).digest("hex");
for (const collection of ["guests", "tables", "seatAssignments", "seatedPeople", "seatOccupancy", "invitationSecrets", "invitationTokens", "publicGuests"]) {
  let pageToken = "", documents = [];
  do {
    const data = await get(`${base}/weddings/luxury-wedding-demo/${collection}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`);
    documents.push(...(data.documents || [])); pageToken = data.nextPageToken || "";
  } while (pageToken);
  const canonical = documents.sort((a, b) => a.name.localeCompare(b.name)).map(({ name, fields }) => ({ name, fields }));
  report.data[collection] = { count: documents.length, sha256: hash(canonical) };
}
report.data.event = { sha256: hash(event.fields) };
const { seatingSchemaVersion: _marker, ...eventDetails } = event.fields;
report.data.eventDetails = { sha256: hash(eventDetails) };
await mkdir(".local-evidence", { recursive: true });
await writeFile(process.env.AUDIT_OUTPUT || ".local-evidence/production-data-baseline.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
