// Opt-in emulator-only instrumentation. Counts/stage controls contain no
// document contents, credentials, UIDs or invitation tokens.
export function createLocalFirestoreDiagnostics(enabled) {
  const counts = { reads: 0, queries: 0, writes: 0, transactions: 0, listeners: 0 };
  let failure = null, panel = null;
  function render() {
    if (!enabled || !document.body) return;
    if (!panel) {
      panel = document.createElement("details"); panel.id = "localFirestoreDiagnostics";
      panel.style.cssText = "position:fixed;bottom:0;left:0;z-index:99999;max-width:100%;background:#fff;color:#111;padding:6px;border:1px solid #444;font:12px monospace";
      panel.innerHTML = '<summary>Local emulator diagnostics</summary><output id="localFirestoreCounts"></output><p><button type="button" id="resetFirestoreCounts">Reset counts</button> <select aria-label="Simulated error code"><option>resource-exhausted</option><option>unavailable</option><option>permission-denied</option></select> <button type="button" data-fail-stage="canonical">Fail next canonical save</button> <button type="button" data-fail-stage="publish">Fail next invitation publish</button></p>';
      panel.querySelector("#resetFirestoreCounts").onclick = () => { Object.keys(counts).filter((key) => key !== "listeners").forEach((key) => counts[key] = 0); render(); };
      panel.querySelectorAll("[data-fail-stage]").forEach((button) => { button.onclick = () => { failure = { stage: button.dataset.failStage, code: panel.querySelector("select").value }; panel.dataset.pendingFailure = failure.stage; }; });
      document.body.append(panel);
    }
    panel.querySelector("output").textContent = Object.entries(counts).map(([key, value]) => `${key}: ${value}`).join(" | ");
    panel.dataset.counts = JSON.stringify(counts);
  }
  function count(key, amount = 1) { if (enabled) { counts[key] += amount; render(); } }
  function before(stage) {
    if (!enabled || failure?.stage !== stage) return;
    const code = failure.code; failure = null; delete panel.dataset.pendingFailure;
    throw Object.assign(new Error(`Simulated ${code}`), { code });
  }
  function instrument(api) {
    if (!enabled) return api;
    render();
    return { ...api,
      getDoc: async (...args) => { count("reads"); return api.getDoc(...args); },
      getDocs: async (...args) => { count("queries"); const result = await api.getDocs(...args); count("reads", result.size); return result; },
      onSnapshot: (target, ...args) => { count("listeners"); const stop = api.onSnapshot(target, ...args); return () => { count("listeners", -1); stop(); }; },
      runTransaction: (db, callback, options) => api.runTransaction(db, async (transaction) => {
        count("transactions");
        const proxy = { get: (ref) => { count("reads"); return transaction.get(ref); } };
        for (const type of ["set", "update", "delete"]) proxy[type] = (...args) => { count("writes"); transaction[type](...args); return proxy; };
        return callback(proxy);
      }, options),
      writeBatch: (db) => {
        const batch = api.writeBatch(db), proxy = { commit: () => batch.commit() };
        for (const type of ["set", "update", "delete"]) proxy[type] = (...args) => { count("writes"); batch[type](...args); return proxy; };
        return proxy;
      },
      ...Object.fromEntries(["setDoc", "updateDoc", "deleteDoc", "addDoc"].map((key) => [key, (...args) => { count("writes"); return api[key](...args); }])),
    };
  }
  return { instrument, before };
}
