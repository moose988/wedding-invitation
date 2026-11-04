import test from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, hideFailedInvitationImages } from "../invitations/shared/invitation-utils.js";
import { runAction } from "../action-feedback.js";

test("optional invitation images disappear when already broken or a load fails later", () => {
  const image = (complete, naturalWidth) => Object.assign(new EventTarget(), { complete, naturalWidth, hidden: false });
  const broken = image(true, 0);
  const loading = image(false, 0);
  const loaded = image(true, 300);
  hideFailedInvitationImages({ querySelectorAll: () => [broken, loading, loaded] });
  assert.equal(broken.hidden, true);
  assert.equal(loaded.hidden, false);
  assert.equal(loading.hidden, false);
  loading.dispatchEvent(new Event("error"));
  assert.equal(loading.hidden, true);
});

test("shared HTML escaping treats mixed direction user text as text", () => {
  assert.equal(escapeHtml('زيد "Zaid" <img> & \'ليلى\''), "زيد &quot;Zaid&quot; &lt;img&gt; &amp; &#39;ليلى&#39;");
});

test("cancelled actions do not show success or report an error", async () => {
  const toasts = [];
  const result = await runAction(null, () => false, { success: "Saved", toast: (...args) => toasts.push(args) });
  assert.deepEqual(result, { ok: false, cancelled: true });
  assert.deepEqual(toasts, []);
});

test("restore is idempotent for an already restored photo and still reports other conflicts", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocation = globalThis.location;
  globalThis.location = { hostname: "127.0.0.1" };
  try {
    const { ownerAdapterApi } = await import("../photo-bucket/adapter-api.js");
    const adapter = ownerAdapterApi({ getIdToken: async () => "test-owner" });
    const request = (url, options) => {
      assert.equal(url, "/__photo_bucket_api/b/demo-bucket/deleted/file%20one/restore");
      assert.equal(options.method, "POST");
      assert.equal(options.headers.authorization, "Bearer test-owner");
    };
    globalThis.fetch = async (url, options) => {
      request(url, options);
      return new Response(JSON.stringify({ code: "ALREADY_RESTORED" }), { status: 409 });
    };
    assert.deepEqual(await adapter.restoreDeleted("demo-bucket", "file one"), { alreadyRestored: true });
    globalThis.fetch = async (url, options) => {
      request(url, options);
      return new Response(JSON.stringify({ code: "RESTORE_CONFLICT" }), { status: 409 });
    };
    await assert.rejects(adapter.restoreDeleted("demo-bucket", "file one"), error => error.code === "RESTORE_CONFLICT");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.location = originalLocation;
  }
});



test("network errors while the browser is online use the finite upload retry budget", async () => {
  const { uploadQueue } = await import("../photo-bucket/transport.js");
  let job = { id: "one", attempts: 0, state: "queued" };
  const error = Object.assign(new Error("Connection failed"), { network: true, retryable: true });
  const adapter = {
    jobs: async () => [job],
    updateJob: async (_bucketId, _jobId, changes) => { job = { ...job, ...changes }; return job; },
    status: async () => ({ paused: false }),
    jobFile: async () => new Blob(["photo"]),
    commit: async () => { throw error; },
  };
  const transport = {
    maxAttempts: 2, online: true,
    run: async () => ({}),
    wait: async () => {},
    waitOnline: async () => { assert.fail("An online connection should use the retry budget"); },
  };
  let resolveFailed;
  const failed = new Promise(resolve => { resolveFailed = resolve; });
  const queue = uploadQueue({ adapter, bucketId: "fixture", transport, changed: entry => {
    if (entry.state === "failed") resolveFailed(entry);
  } });
  await queue.start();
  const outcome = await failed;
  queue.stop();
  assert.equal(outcome.attempts, 2);
  assert.match(outcome.error, /Tap Retry/);
});


test("an offline interruption returns the attempt and resumes the same upload", async t => {
  const { uploadQueue } = await import("../photo-bucket/transport.js");
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const navigator = { onLine: true };
  Object.defineProperty(globalThis, "navigator", { value: navigator, configurable: true });
  t.after(() => {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete globalThis.navigator;
  });
  t.mock.method(Math, "random", () => 0);
  let job = { id: "one", attempts: 0, state: "queued" };
  let commitCalls = 0;
  let resolveWaiting, resolveSaved, resolveOnline;
  const waiting = new Promise(resolve => { resolveWaiting = resolve; });
  const saved = new Promise(resolve => { resolveSaved = resolve; });
  const connected = new Promise(resolve => { resolveOnline = resolve; });
  const adapter = {
    jobs: async () => job ? [job] : [],
    updateJob: async (_bucketId, _jobId, changes) => { job = { ...job, ...changes }; return job; },
    status: async () => ({ paused: false }),
    jobFile: async () => new Blob(["photo"]),
    commit: async (_bucketId, jobId) => {
      assert.equal(jobId, "one");
      if (commitCalls++ === 0) {
        navigator.onLine = false;
        throw Object.assign(new Error("Offline"), { network: true, retryable: true });
      }
      job = null;
    },
  };
  const transport = {
    maxAttempts: 1, online: true,
    run: async () => ({}),
    wait: async () => { assert.fail("Offline waiting must not use normal retry"); },
    waitOnline: () => connected,
  };
  const queue = uploadQueue({ adapter, bucketId: "fixture", transport, changed: entry => {
    if (entry.state === "waiting") resolveWaiting(entry);
    if (entry.state === "saved") resolveSaved(entry);
  } });
  t.after(() => queue.stop());
  await queue.start();
  assert.equal((await waiting).attempts, 0);
  assert.equal(commitCalls, 1);
  navigator.onLine = true;
  resolveOnline();
  assert.equal((await saved).attempts, 1);
  assert.equal(commitCalls, 2);
});
