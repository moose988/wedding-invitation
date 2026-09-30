// Idempotent Admin SDK backfill for legacy event documents.
// Run from the repository root after authenticating with Application Default Credentials.
const fs = require("fs");
const path = require("path");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

function selectedProjectId() {
  const projectFlag = process.argv.indexOf("--project");
  if (projectFlag >= 0 && process.argv[projectFlag + 1]) return process.argv[projectFlag + 1];
  const configured = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../.firebaserc"), "utf8"));
  return process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || configured.projects?.default || "";
}

const projectId = selectedProjectId();
if (!projectId) throw new Error("No Firebase project ID found. Pass --project <project-id> or configure .firebaserc.");
if (!getApps().length) initializeApp({ projectId });
const db = getFirestore();
const KNOWN_WEDDINGS = new Set(["luxury-wedding-demo", "M1S1aBL9134GSAozWh6G"]);

function titleFor(data, eventCategory = "wedding_engagement") {
  if (eventCategory === "celebration") return "Untitled event";
  const coupleName = String(data.coupleName || "").trim();
  if (coupleName) return coupleName;
  return [data.brideName, data.groomName].map((value) => String(value || "").trim()).filter(Boolean).join(" & ") || "Untitled event";
}

async function main() {
  const events = await db.collection("weddings").get();
  const writer = db.bulkWriter();
  let updated = 0;
  let indexesUpdated = 0;
  for (const event of events.docs) {
    const data = event.data();
    const patch = {};
    if (!Object.prototype.hasOwnProperty.call(data, "eventCategory")) {
      patch.eventCategory = "wedding_engagement";
    }
    if (!Object.prototype.hasOwnProperty.call(data, "eventTitle") || !String(data.eventTitle || "").trim()) {
      patch.eventTitle = titleFor(data, data.eventCategory || "wedding_engagement");
    }
    // The two documented records are weddings. Only populate missing fields;
    // this intentionally does not overwrite any category/title already set.
    if (KNOWN_WEDDINGS.has(event.id)) {
      if (!Object.prototype.hasOwnProperty.call(data, "eventCategory")) patch.eventCategory = "wedding_engagement";
      if (!Object.prototype.hasOwnProperty.call(data, "eventTitle")) patch.eventTitle = titleFor(data, "wedding_engagement");
    }
    const eventCategory = data.eventCategory || "wedding_engagement";
    const eventTitle = String(data.eventTitle || "").trim() || titleFor(data, eventCategory);
    if (Object.keys(patch).length) {
      writer.update(event.ref, patch);
      updated += 1;
    }
    const members = await event.ref.collection("dashboardUsers").get();
    for (const member of members.docs) {
      const indexRef = db.doc(`users/${member.id}/weddingAccess/${event.id}`);
      const index = await indexRef.get();
      if (!index.exists) continue;
      const indexData = index.data();
      const indexPatch = {};
      if (!Object.prototype.hasOwnProperty.call(indexData, "eventCategory")) indexPatch.eventCategory = eventCategory;
      if (!Object.prototype.hasOwnProperty.call(indexData, "eventTitle") || !String(indexData.eventTitle || "").trim()) indexPatch.eventTitle = eventTitle;
      if (!Object.keys(indexPatch).length) continue;
      writer.update(indexRef, indexPatch);
      indexesUpdated += 1;
    }
  }
  await writer.close();
  console.log(`Project ${projectId}: backfilled ${updated} of ${events.size} event documents and ${indexesUpdated} private access-index documents.`);
}

main().catch((error) => {
  console.error("Event category migration failed.", error);
  process.exitCode = 1;
});
