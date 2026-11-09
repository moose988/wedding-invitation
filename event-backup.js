// Download and restore of one event's backup file. No Firebase import and no DOM, so it runs
// in Node tests. `post(body)` sends one request to /api/admin-event-backup and returns its JSON.
import { getEventDisplayTitle } from "./event-utils.js";

export const BACKUP_FORMAT = "qd-event-backup";
export const BACKUP_VERSION = 1;
export const RESTORE_CHUNK_DOCS = 200;
export const RESTORE_CHUNK_BYTES = 900_000; // well under the 4.5 MB request limit
const MAX_BEGIN_ROUNDS = 40;

const isPlain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export async function sha256Hex(text, subtle = globalThis.crypto?.subtle) {
  if (!subtle) throw new Error("This browser cannot check backup files. Use a current browser over HTTPS.");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Everything the checksum covers, in one fixed key order.
function payloadOf(backup) {
  const { format, version, exportedAt, exportedBy, eventId, event, collections, cards, grants } = backup;
  return { format, version, exportedAt, exportedBy, eventId, event, collections, cards, grants };
}

export function countsOf(collections) {
  return Object.fromEntries(Object.entries(collections).map(([path, docs]) => [path, docs.length]));
}

export async function downloadEventBackup({ post, eventId, onProgress = () => {}, subtle }) {
  const start = await post({ action: "export-start", eventId });
  const collections = {};
  let records = 0;
  for (const path of start.collections || []) {
    const docs = [];
    let cursor = null;
    do {
      const page = await post({ action: "export-page", eventId, path, cursor });
      docs.push(...(page.docs || []));
      records += (page.docs || []).length;
      onProgress({ phase: "download", records });
      cursor = page.next || null;
    } while (cursor);
    if (docs.length) collections[path] = docs;
  }
  const payload = payloadOf({ ...start, collections, cards: start.cards || [], grants: start.grants || [] });
  return { ...payload, counts: countsOf(collections), checksum: await sha256Hex(JSON.stringify(payload), subtle) };
}

export function backupFileName(backup, label = "") {
  const title = getEventDisplayTitle(backup.event || {}) || "event";
  const slug = title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "event";
  const stamp = String(backup.exportedAt || "").replace(/[-:]/g, "").replace("T", "-").slice(0, 13);
  return `event-backup-${slug}-${String(backup.eventId).slice(0, 8)}-${stamp}${label ? `-${label}` : ""}.json`;
}

// Parses and checks a chosen file. Throws an Error whose message can be shown as it is.
export async function readBackupText(text, { subtle } = {}) {
  let backup;
  try { backup = JSON.parse(text); } catch { throw new Error("This file is not a backup: it could not be read. Choose a file downloaded with Download backup."); }
  if (!isPlain(backup) || backup.format !== BACKUP_FORMAT) throw new Error("This file is not an event backup. Choose a file downloaded with Download backup.");
  if (backup.version !== BACKUP_VERSION) throw new Error("This backup was made by a different version of the site and cannot be restored here.");
  const rows = (list, key) => Array.isArray(list) && list.every((row) => isPlain(row) && typeof row[key] === "string" && row[key] && isPlain(row.data));
  const sound = typeof backup.eventId === "string" && backup.eventId && isPlain(backup.event) && isPlain(backup.collections)
    && Object.values(backup.collections).every((docs) => rows(docs, "id")) && rows(backup.cards, "uid") && rows(backup.grants, "id");
  if (!sound) throw new Error("This backup file is incomplete or damaged. Use another copy.");
  if (typeof backup.checksum !== "string" || backup.checksum !== await sha256Hex(JSON.stringify(payloadOf(backup)), subtle)) {
    throw new Error("This backup file was changed or damaged after it was downloaded, so it will not be restored. Use another copy.");
  }
  return backup;
}

export function summarizeBackup(backup) {
  const size = (path) => backup.collections[path]?.length || 0;
  return {
    eventId: backup.eventId,
    title: getEventDisplayTitle(backup.event) || "Untitled event",
    exportedAt: backup.exportedAt, exportedBy: backup.exportedBy || "",
    guests: size("guests"), tables: size("tables"), responses: size("genderRevealResponses"), members: size("dashboardUsers"),
    records: Object.values(backup.collections).reduce((sum, docs) => sum + docs.length, 0) + 1,
  };
}

export function* chunkDocs(docs, maxDocs = RESTORE_CHUNK_DOCS, maxBytes = RESTORE_CHUNK_BYTES) {
  let chunk = [], bytes = 0;
  for (const item of docs) {
    const size = JSON.stringify(item).length;
    if (chunk.length && (chunk.length >= maxDocs || bytes + size > maxBytes)) { yield chunk; chunk = []; bytes = 0; }
    chunk.push(item); bytes += size;
  }
  if (chunk.length) yield chunk;
}

// Replaces the event with the file's contents. Safe to run again with the same file if it stops midway.
export async function restoreEventBackup({ post, backup, onProgress = () => {} }) {
  const eventId = backup.eventId;
  let cleared = false;
  for (let round = 0; round < MAX_BEGIN_ROUNDS && !cleared; round += 1) {
    onProgress({ phase: "clear" });
    cleared = (await post({ action: "restore-begin", eventId })).done === true;
  }
  if (!cleared) throw new Error("The event's current data could not be cleared in time. Run the restore again.");
  const total = Object.values(backup.collections).reduce((sum, docs) => sum + docs.length, 0);
  let records = 0;
  for (const [path, docs] of Object.entries(backup.collections)) {
    for (const chunk of chunkDocs(docs)) {
      await post({ action: "restore-write", eventId, path, docs: chunk });
      records += chunk.length;
      onProgress({ phase: "write", records, total });
    }
  }
  onProgress({ phase: "finish" });
  return post({ action: "restore-finish", eventId, event: backup.event, cards: backup.cards, grants: backup.grants, expected: countsOf(backup.collections) });
}
