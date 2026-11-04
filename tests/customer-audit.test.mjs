import test from "node:test";
import assert from "node:assert/strict";
import { buildCustomerAuditEntry, recordCustomerAudit } from "../customer-audit.js";

const user = { uid: "customer", email: " Customer@Example.TEST " };
const customer = { role: "customer" };

function fakeApi({ fail = false } = {}) {
  const writes = [];
  return {
    writes,
    serverTimestamp: () => "SERVER_TIME",
    collection: (_db, ...path) => path.join("/"),
    doc: (collectionPath) => `${collectionPath}/auto-id`,
    setDoc: async (path, data) => {
      if (fail) throw Object.assign(new Error("Synthetic Guest Name leaked"), { code: "permission-denied" });
      writes.push({ path, data });
    },
  };
}

test("an entry has exactly the allowed fields, a normalized email and clipped sizes", () => {
  const entry = buildCustomerAuditEntry({ user, action: "guest.update", targetType: "guest", targetId: "x".repeat(300), summary: "😀".repeat(600) }, "NOW");
  assert.deepEqual(Object.keys(entry).sort(), ["action", "actorEmail", "actorUid", "createdAt", "summary", "targetId", "targetType"]);
  assert.equal(entry.actorEmail, "customer@example.test");
  assert.equal(entry.targetId.length, 200);
  assert.equal(Array.from(entry.summary).length, 500);
  assert.equal(entry.summary.isWellFormed(), true);
});

test("an action is written under the event's audit collection", async () => {
  const api = fakeApi();
  assert.equal(await recordCustomerAudit({ api, db: {}, weddingId: "a", user, permissions: customer, action: "guest.delete", targetType: "guest", targetId: "g1" }), true);
  assert.equal(api.writes[0].path, "weddings/a/customerAudit/auto-id");
  assert.equal(api.writes[0].data.createdAt, "SERVER_TIME");
});

test("administrators and other non-customer accounts are not audited", async () => {
  const api = fakeApi();
  for (const permissions of [{ role: "admin" }, { role: "owner" }, { role: "seating" }, undefined]) {
    assert.equal(await recordCustomerAudit({ api, db: {}, weddingId: "a", user, permissions, action: "guest.update", targetType: "guest" }), false);
  }
  assert.equal(api.writes.length, 0);
});

test("a failed audit write resolves false, never rejects, and logs only the code", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  assert.equal(await recordCustomerAudit({ api: fakeApi({ fail: true }), db: {}, weddingId: "a", user, permissions: customer, action: "guest.update", targetType: "guest", summary: "Synthetic Guest Name" }), false);
  assert.deepEqual(warn.mock.calls[0].arguments, ["Customer audit entry was not saved", "permission-denied"]);
});

test("a programmer error or broken API still cannot break the caller", async (t) => {
  t.mock.method(console, "warn", () => {});
  assert.equal(await recordCustomerAudit({ api: fakeApi(), db: {}, weddingId: "a", user, permissions: customer, action: "Bad Action", targetType: "guest" }), false);
  assert.equal(await recordCustomerAudit({ api: {}, db: {}, weddingId: "a", user, permissions: customer, action: "guest.update", targetType: "guest" }), false);
  assert.equal(await recordCustomerAudit({ api: fakeApi(), db: {}, weddingId: "a", user: null, permissions: customer, action: "guest.update", targetType: "guest" }), false);
});
