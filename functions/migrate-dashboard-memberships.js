#!/usr/bin/env node
"use strict";

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldPath, FieldValue } = require("firebase-admin/firestore");

function option(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || "" : fallback;
}

async function main() {
  const projectId = option("--project");
  const apply = process.argv.includes("--apply");
  const cursor = option("--cursor");
  const requestedLimit = Number(option("--limit-events", "0"));
  if (!projectId) throw new Error("Usage: node migrate-dashboard-memberships.js --project <firebase-project-id> [--cursor <event-id>] [--apply]");
  if (cursor && !/^[A-Za-z0-9_-]{1,150}$/.test(cursor)) throw new Error("Invalid event cursor.");
  if (!Number.isInteger(requestedLimit) || requestedLimit < 0 || requestedLimit > 100000) throw new Error("Invalid event limit.");

  initializeApp({ projectId });
  const db = getFirestore();
  const summary = { projectId, mode: apply ? "apply" : "dry-run", events: 0, memberships: 0, alreadyValid: 0, needsUserId: 0, conflicts: 0, applied: 0, nextCursor: "", done: false };
  const pending = [];
  let lastId = cursor;
  while (true) {
    const pageLimit = requestedLimit ? Math.min(100, requestedLimit - summary.events) : 100;
    if (pageLimit <= 0) break;
    let query = db.collection("weddings").orderBy(FieldPath.documentId()).limit(pageLimit);
    if (lastId) query = query.startAfter(lastId);
    const page = await query.get();
    if (page.empty) {
      summary.done = true;
      summary.nextCursor = "";
      break;
    }
    for (const wedding of page.docs) {
      summary.events += 1;
      const members = await wedding.ref.collection("dashboardUsers").get();
      for (const member of members.docs) {
        summary.memberships += 1;
        const value = member.data().userId;
        if (value === member.id) {
          summary.alreadyValid += 1;
        } else if (value !== undefined && value !== "") {
          summary.conflicts += 1;
        } else {
          summary.needsUserId += 1;
          if (apply) pending.push(member.ref);
        }
      }
    }
    lastId = page.docs[page.docs.length - 1].id;
    summary.nextCursor = lastId;
    if (requestedLimit && summary.events >= requestedLimit) break;
    if (page.size < 100) {
      summary.done = true;
      summary.nextCursor = "";
      break;
    }
  }
  if (apply && summary.conflicts) {
    throw new Error(`Found ${summary.conflicts} membership records whose userId conflicts with the document ID. Resolve those records before rerunning.`);
  }
  if (apply) {
    for (let offset = 0; offset < pending.length; offset += 400) {
      const batch = db.batch();
      pending.slice(offset, offset + 400).forEach((ref) => batch.update(ref, { userId: ref.id, updatedAt: FieldValue.serverTimestamp() }));
      await batch.commit();
      summary.applied += Math.min(400, pending.length - offset);
    }
  }
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
