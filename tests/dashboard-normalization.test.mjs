import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../dashboard.js", import.meta.url), "utf8");
const bootstrap = source.slice(source.indexOf("async function bootstrapDashboard()"), source.indexOf("function isWeddingOwner()"));

function fixture(owner = true) {
  const events = [];
  let reject;
  const pending = new Promise((_, fail) => { reject = fail; });
  const state = {
    services: { db: {}, functions: {} }, weddingId: "isolated-wedding",
    currentUser: { uid: "isolated-owner" }, listenerGeneration: 0,
  };
  const context = vm.createContext({
    state, requestedSeatingSide: "", doc: () => ({}),
    getDoc: async () => ({ exists: () => true, data: () => ({ canViewDashboard: true }), id: "isolated-wedding" }),
    rememberWeddingId() {}, hydrateHallObjects: () => [], isWeddingOwner: () => owner,
    showDashboard: () => events.push("show"), renderAll: () => events.push("render"),
    startWeddingListener: () => events.push("wedding-listener"),
    startListeners: () => events.push("data-listeners"),
    startSeatingAccessListener: () => events.push("access-listener"),
    httpsCallable: (functions, name) => {
      assert.equal(functions, state.services.functions);
      assert.equal(name, "normalizeSeatingGuestSides");
      return (data) => {
        assert.equal(data.weddingId, "isolated-wedding");
        events.push("call");
        return pending;
      };
    },
    console: { error: (...args) => events.push(["error", ...args]) },
    showToast: (...args) => events.push(["toast", ...args]),
  });
  vm.runInContext(bootstrap, context);
  return { context, state, events, reject };
}

test("dashboard finishes bootstrap while normalization is pending and reports rejection", async () => {
  const f = fixture();
  await f.context.bootstrapDashboard();
  assert.deepEqual(f.events, ["show", "render", "wedding-listener", "data-listeners", "access-listener", "call"]);
  const error = Object.assign(new Error("internal"), { code: "functions/internal" });
  f.reject(error);
  await new Promise(setImmediate);
  assert.equal(f.events.find(e => e[0] === "error")[2], error);
  const toast = f.events.find(e => e[0] === "toast");
  assert.match(toast[1], /functions\/internal/);
  assert.match(toast[1], /seating access may be limited/);
  assert.equal(toast[2], "error");
});

test("non-owner dashboard never calls normalization", async () => {
  const f = fixture(false);
  await f.context.bootstrapDashboard();
  assert.ok(f.events.includes("data-listeners"));
  assert.ok(!f.events.includes("call"));
});

test("late normalization failures are logged without notifying a disposed session", async () => {
  const f = fixture();
  await f.context.bootstrapDashboard();
  f.state.listenerGeneration++;
  f.reject(new Error("unavailable"));
  await new Promise(setImmediate);
  assert.ok(f.events.some(e => e[0] === "error"));
  assert.ok(!f.events.some(e => e[0] === "toast"));
});
