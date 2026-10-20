// Explicit IAM maintenance only; never imported by the frontend. Back up and
// derive both counters from canonical responses in one serializable transaction.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
const eventId = process.argv.find(arg => arg.startsWith("--event="))?.slice(8);
if (!eventId || !/^[A-Za-z0-9_-]{1,128}$/.test(eventId)) throw new Error("Supply --event=<verified event ID>.");
if (!process.env.FIREBASE_CLI_LIB) throw new Error("Set FIREBASE_CLI_LIB to the installed Firebase CLI lib directory.");
const require = createRequire(import.meta.url);
const { configstore } = require(`${process.env.FIREBASE_CLI_LIB}/configstore.js`);
const { getAccessToken } = require(`${process.env.FIREBASE_CLI_LIB}/auth.js`);
const credentials = await getAccessToken(configstore.get("tokens").refresh_token, []);
const project = "weddinginvitaion-b4f36";
const database = `projects/${project}/databases/(default)`;
const eventPath = `${database}/documents/weddings/${eventId}`;
const api = `https://firestore.googleapis.com/v1/${database}`;
async function request(url, body) {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${credentials.access_token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`Maintenance request failed (${response.status}): ${new URL(url).pathname}`);
  return response.json();
}
const { transaction } = await request(`${api}/documents:beginTransaction`, { options: { readWrite: {} } });
let committed = false;
try {
  const paths = [eventPath, `${eventPath}/genderRevealState/summary`, `${eventPath}/genderRevealResults/aggregate`];
  const documents = await request(`${api}/documents:batchGet`, { documents: paths, transaction });
  const found = name => documents.find(row => row.found?.name === name)?.found;
  const event = found(eventPath);
  if (event?.fields?.eventCategory?.stringValue !== "gender_reveal") throw new Error("Refusing to repair a non-gender-reveal event.");
  const query = await request(`https://firestore.googleapis.com/v1/${eventPath}:runQuery`, {
    structuredQuery: { from: [{ collectionId: "genderRevealResponses" }] }, transaction,
  });
  const responses = query.filter(row => row.document).map(row => row.document);
  const totals = { boyCount: 0, girlCount: 0, totalCount: responses.length };
  for (const response of responses) {
    const prediction = response.fields?.prediction?.stringValue;
    if (!["boy", "girl"].includes(prediction)) throw new Error("A canonical response needs review; no counters changed.");
    totals[`${prediction}Count`]++;
  }
  const counters = paths.slice(1).map(found);
  if (counters.some(doc => !doc)) throw new Error("Counter documents are missing; no synthetic state will be created.");
  const matches = counters.every(doc => Object.entries(totals).every(([key, count]) => Number(doc.fields[key]?.integerValue) === count));
  if (matches) { console.log(JSON.stringify({ project, eventId, totals, changed: false })); }
  else {
    await mkdir(".local-evidence", { recursive: true });
    const backup = `.local-evidence/gender-reveal-totals-${eventId}-${Date.now()}.json`;
    await writeFile(backup, JSON.stringify({ project, eventId, documents, responses, totals }, null, 2), { flag: "wx" });
    if (process.argv.includes("--apply")) {
      const fields = Object.fromEntries(Object.entries(totals).map(([key, count]) => [key, { integerValue: String(count) }]));
      await request(`${api}/documents:commit`, {
        transaction,
        writes: counters.map(doc => ({
          update: { name: doc.name, fields },
          updateMask: { fieldPaths: Object.keys(totals) },
          updateTransforms: [{ fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" }],
          currentDocument: { updateTime: doc.updateTime },
        })),
      });
      committed = true;
    }
    console.log(JSON.stringify({ project, eventId, totals, backup, changed: committed, dryRun: !committed }));
  }
} finally {
  if (!committed) await request(`${api}/documents:rollback`, { transaction });
}
