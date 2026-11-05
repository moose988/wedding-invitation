import assert from "node:assert/strict";
import test from "node:test";
import { NETWORK_WAIT_LIMIT, uploadQueue } from "../photo-bucket/transport.js";

function fakeAdapter() {
  const jobs = new Map([["j1", { id: "j1", attempts: 0, state: "queued", name: "walk.jpg" }]]);
  const saved = [];
  return {
    saved,
    status: async () => ({ paused: false }),
    jobs: async () => [...jobs.values()],
    jobFile: async () => new Blob(["x"]),
    updateJob: async (_b, id, changes) => { const job = { ...jobs.get(id), ...changes }; jobs.set(id, job); return job; },
    commit: async (_b, id) => { saved.push(id); jobs.delete(id); return { id }; },
    job: (id) => jobs.get(id),
  };
}

test("an upload keeps waiting while the Wi-Fi is connected but has no internet, without using up its retries", async () => {
  const adapter = fakeAdapter(); let failures = 25; // far more than the 2 normal attempts allowed below
  const transport = {
    online: true, maxAttempts: 2, waitOnline: async () => {}, networkWait: async () => {}, wait: async () => {},
    run: async () => { if (failures-- > 0) throw Object.assign(new Error("Failed to fetch"), { retryable: true, network: true }); return { blob: new Blob(["img"]) }; },
  };
  const states = [];
  const queue = uploadQueue({ adapter, bucketId: "b", transport, changed: (job) => states.push(job.state) });
  await queue.start();
  for (let i = 0; i < 200 && !adapter.saved.length; i++) await new Promise((r) => setTimeout(r, 1));
  assert.deepEqual(adapter.saved, ["j1"], "the photo is saved once the connection is back");
  assert.ok(states.includes("waiting"), "the guest sees 'Waiting for a connection'");
  assert.ok(!states.includes("failed"), "it never asked the guest to tap Retry");
  assert.ok(NETWORK_WAIT_LIMIT >= 60, "waits for a long outage before normal retries resume");
});

test("a server error still counts as a normal attempt and ends in Tap Retry", async () => {
  const adapter = fakeAdapter();
  const transport = { online: true, maxAttempts: 2, waitOnline: async () => {}, networkWait: async () => {}, wait: async () => {},
    run: async () => { throw Object.assign(new Error("busy"), { retryable: true }); } };
  const queue = uploadQueue({ adapter, bucketId: "b", transport });
  await queue.start();
  for (let i = 0; i < 200 && adapter.job("j1")?.state !== "failed"; i++) await new Promise((r) => setTimeout(r, 1));
  assert.equal(adapter.job("j1").state, "failed");
});
