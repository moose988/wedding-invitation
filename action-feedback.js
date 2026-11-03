// One shared way to give every button visible feedback: a pressed state at once, a busy state (spinner,
// label, disabled) while work runs, then a tick or a clear failure message. Importing this file also
// installs the page-wide behaviour, so even a plain button gets a pressed state and a spinner while it is disabled.
let toastTimer;
export function showToast(message, kind = "info") {
  if (typeof document === "undefined") return;
  let host = document.getElementById("qd-toast");
  if (!host) { host = document.createElement("div"); host.id = "qd-toast"; host.className = "qd-toast"; host.setAttribute("role", "status"); host.setAttribute("aria-live", "polite"); document.body.append(host); }
  host.textContent = message; host.dataset.kind = kind; host.classList.add("is-visible");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => host.classList.remove("is-visible"), kind === "error" ? 9000 : 3500);
}

const messageOf = (error, what) => {
  const text = error?.message && !/^Failed to fetch$|^Load failed$|NetworkError/i.test(error.message) ? error.message : "";
  return text || `${what} could not reach the server. Check your internet connection and try again.`;
};

// Runs work() for a button. Resolves { ok, result } or { ok:false, error }; it never throws, and a failure is
// always shown (under the button and in a toast) unless the caller shows it itself with onError.
export async function runAction(button, work, { busyLabel = "", successLabel = "", success = "", what = "This action", onError = null, toast = showToast } = {}) {
  if (button?.dataset.busy === "1") return { ok: false, error: new Error("busy") };
  const original = button?.textContent, wasDisabled = button?.disabled, hadFocus = Boolean(button) && typeof document !== "undefined" && document.activeElement === button;
  if (button) {
    button.dataset.busy = "1"; button.setAttribute("aria-busy", "true"); button.classList.remove("is-done", "is-failed"); button.classList.add("is-busy"); button.disabled = true;
    if (busyLabel) button.textContent = busyLabel;
    button.parentElement?.querySelector(":scope > .action-error")?.remove();
  }
  try {
    const result = await work();
    if (button) { button.classList.add("is-done"); if (successLabel) button.textContent = successLabel; setTimeout(() => { button.classList.remove("is-done"); if (successLabel && button.isConnected && button.dataset.busy !== "1") button.textContent = original; }, 1600); }
    if (success) toast(success, "success");
    return { ok: true, result };
  } catch (error) {
    const message = messageOf(error, what);
    if (onError) onError(error, message);
    else {
      if (button?.isConnected) { button.classList.add("is-failed"); button.insertAdjacentHTML("afterend", `<p class="action-error" role="alert"></p>`); button.nextElementSibling.textContent = `${message} Try again.`; }
      toast(message, "error");
    }
    return { ok: false, error };
  } finally {
    if (button) { delete button.dataset.busy; button.removeAttribute("aria-busy"); button.classList.remove("is-busy"); if (button.isConnected) { button.disabled = wasDisabled === true; if (busyLabel && !successLabel) button.textContent = original; if (hadFocus) button.focus({ preventScroll: true }); } }
  }
}

// For handlers that receive an event: busy state on the clicked button, then the same result handling.
export function runFromEvent(event, work, options = {}) {
  const button = event?.target?.closest?.("button, [role='button']");
  return button ? runAction(button, work, options) : work().then(result => ({ ok: true, result }), error => { (options.onError || ((e, m) => showToast(m, "error")))(error, messageOf(error, options.what || "This action")); return { ok: false, error }; });
}

const PRESS = "button, summary, [role='button'], a.primary-button, a.secondary-button, a.open-button, label.event-category-card, .da3wa-nav-link";
export function installFeedback(doc = document) {
  if (doc.documentElement.dataset.feedbackInstalled) return; doc.documentElement.dataset.feedbackInstalled = "1";
  const press = event => {
    const target = event.target?.closest?.(PRESS); if (!target || target.disabled) return;
    target.classList.add("is-pressed"); setTimeout(() => target.classList.remove("is-pressed"), 350);
  };
  doc.addEventListener("pointerdown", press, { capture: true, passive: true });
  doc.addEventListener("touchstart", () => {}, { passive: true }); // lets :active work on iOS
  doc.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") press(event); }, true);
  // A button that disables itself to do work gets a spinner until it is enabled again, whatever code disabled it.
  doc.addEventListener("click", event => {
    const button = event.target?.closest?.("button"); if (!button || button.classList.contains("is-busy")) return;
    setTimeout(() => {
      if (!button.isConnected || !button.disabled || button.classList.contains("is-busy")) return;
      button.classList.add("is-busy", "is-auto-busy");
      const watch = new MutationObserver(() => { if (!button.disabled || !button.isConnected) { button.classList.remove("is-busy", "is-auto-busy"); watch.disconnect(); } });
      watch.observe(button, { attributes: true, attributeFilter: ["disabled"] });
    }, 40);
  }, true);
  // A form submit always shows a busy spinner on its button right away; it stays until the button is re-enabled or 1.5 s pass.
  doc.addEventListener("submit", event => {
    const button = event.submitter; if (!button || button.classList.contains("is-busy")) return;
    button.classList.add("is-busy");
    setTimeout(() => { if (!button.disabled) button.classList.remove("is-busy"); }, 1500);
  }, true);
  // Last resort: a click handler whose promise rejects with nothing catching it is shown, never lost.
  globalThis.addEventListener?.("unhandledrejection", event => {
    const reason = event.reason; if (reason?.name === "AbortError" || reason?.message === "busy") return;
    console.error("Unhandled action failure", reason?.message || reason);
    showToast(`That did not work: ${messageOf(reason, "The action")} Try again, and contact an admin if it keeps happening.`, "error");
  });
}
if (typeof document !== "undefined") installFeedback();
