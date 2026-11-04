import assert from "node:assert/strict";
import test from "node:test";
import { updateAdminEventArchiveStatus } from "../admin-events.js";
import { noteBubbleHtml } from "../client-notes-core.js";
import { itemCardHtml } from "../customer-list.js";
import { decodeAudio, encodeMp3 } from "../music-encoder.js";
import { uploadAndCommitSong } from "../music-api.js";

function useGlobal(t, name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  });
}

test("archiving writes the canonical event and updates only a real existing access card", async () => {
  const eventPath = "weddings/event-a";
  const cardPath = "users/admin/weddingAccess/event-a";
  const docs = new Map([[eventPath, { status: "active" }]]);
  const api = {
    doc: (_, ...path) => path.join("/"),
    serverTimestamp: () => 123,
    runTransaction: async (_, callback) => {
      const updates = [];
      await callback({
        get: async ref => ({ exists: () => docs.has(ref), data: () => docs.get(ref) }),
        update: (ref, data) => updates.push([ref, data]),
      });
      for (const [ref, data] of updates) {
        assert.ok(docs.has(ref), "update never creates a document");
        docs.set(ref, { ...docs.get(ref), ...data });
      }
    },
  };
  const archive = status => updateAdminEventArchiveStatus(api, {}, { eventId: "event-a", adminUid: "admin", status });
  await archive("archived");
  assert.deepEqual(docs.get(eventPath), { status: "archived", updatedAt: 123 });
  assert.equal(docs.has(cardPath), false);

  docs.set(cardPath, { status: "active" });
  await archive("archived");
  assert.deepEqual(docs.get(cardPath), { status: "active" }, "a legacy stub remains untouched");

  docs.set(cardPath, { weddingId: "event-a", title: "Reception", status: "archived" });
  await archive("draft");
  assert.deepEqual(docs.get(cardPath), { weddingId: "event-a", title: "Reception", status: "draft", updatedAt: 123 });
});

test("mixed-direction customer names and client notes render as escaped directional text", () => {
  const customer = itemCardHtml({ id: "b", kind: "bucket", name: 'حفلة "ليلى"', typeLabel: "Photo Bucket" });
  assert.ok(customer.includes('<h2 class="customer-item__name" dir="auto">حفلة &quot;ليلى&quot;</h2>'));
  const note = noteBubbleHtml({ id: "n", authorName: "شادي", text: "الضيوف < 500" });
  assert.ok(note.includes('<p class="note__text" dir="auto">الضيوف &lt; 500</p>'));
});

test("decoding uses 44.1 kHz and reuses the first channel for the mono mix", async t => {
  const left = Float32Array.of(1, -1, 0.5);
  const right = Float32Array.of(-1, 0.5, 0.5);
  useGlobal(t, "OfflineAudioContext", class {
    constructor(channels, length, rate) {
      assert.deepEqual([channels, length, rate], [1, 1, 44_100]);
    }
    async decodeAudioData() {
      return { duration: 0.00007, numberOfChannels: 2, getChannelData: i => i === 0 ? left : right };
    }
  });
  const decoded = await decodeAudio(new Blob(["stereo"]));
  assert.equal(decoded, left);
  assert.deepEqual([...decoded], [0, -0.25, 0.5]);
  assert.deepEqual([...right], [-1, 0.5, 0.5]);
});

test("encoding transfers the mono data and terminates the worker on cancellation", async t => {
  const controller = new AbortController();
  const samples = Float32Array.of(0.5, -0.25);
  let terminations = 0;
  let payload;
  useGlobal(t, "Worker", class {
    postMessage(data, transfer) { payload = structuredClone(data, { transfer }); }
    terminate() { terminations += 1; }
  });
  const promise = encodeMp3(samples, { signal: controller.signal });
  assert.equal(samples.byteLength, 0);
  assert.deepEqual(payload, { samples: Float32Array.of(0.5, -0.25), sampleRate: 44_100, kbps: 128 });
  controller.abort();
  await assert.rejects(promise, { name: "AbortError" });
  assert.equal(terminations, 1);
});

test("song upload does not retry a commit rejected by a concurrent writer", async t => {
  const responses = [
    new Response(JSON.stringify({ uploadId: "u", upload: { url: "http://127.0.0.1/sample", headers: {} } })),
    new Response(JSON.stringify({ code: "SONG_CONFLICT", error: "The song changed." }), { status: 409 }),
  ];
  const calls = [];
  useGlobal(t, "location", { hostname: "127.0.0.1" });
  useGlobal(t, "fetch", async url => { calls.push(url); return responses.shift(); });
  useGlobal(t, "XMLHttpRequest", class {
    status = 200;
    upload = {};
    open() {}
    send() { this.onload(); }
  });
  const user = { getIdToken: async () => "test" };
  await assert.rejects(uploadAndCommitSong({ user, eventId: "a", blob: new Blob(["song"]) }), { status: 409, code: "SONG_CONFLICT" });
  assert.deepEqual(calls, ["/__photo_bucket_api/events/a/song/uploads", "/__photo_bucket_api/events/a/song/commit"]);
});
