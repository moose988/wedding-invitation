// Shared action feedback, including announcements for signed-in workspace pages.
const toasts = [];
const actionReset = new WeakMap();
const workspacePaths = /^\/(?:all-events|checkin|clients|customer-events|customer-login|customers|dashboard|dashboard-login|photo-bucket-manage|photo-bucket-poster|preparing-link|send)(?:\.html)?\/?$/;
let toastActive = false;
let lastPress;
let dialogId = 0;

function playToast() {
  const next = toasts.shift();
  if (!next) { toastActive = false; return; }
  toastActive = true;
  let host = document.getElementById("qd-toast");
  if (!host) {
    host = document.createElement("div");
    host.id = "qd-toast";
    host.className = "qd-toast";
    host.setAttribute("role", "status");
    document.body.append(host);
  }
  host.dataset.kind = next.kind;
  host.classList.add("is-visible");
  const focused = next.anchor?.isConnected ? next.anchor.getBoundingClientRect() : next.anchorRect;
  requestAnimationFrame(() => {
    delete host.dataset.position;
    host.textContent = next.message;
    const rect = host.getBoundingClientRect();
    // Keep the toast away from the control that triggered it, even if its menu just closed.
    if (focused && focused.bottom >= rect.top - 4) host.dataset.position = "top";
  });
  setTimeout(() => {
    host.classList.remove("is-visible");
    host.textContent = "";
    setTimeout(playToast, 180);
  }, next.kind === "error" ? 9000 : 3500);
}

export function showToast(message, kind = "info") {
  if (typeof document === "undefined") return;
  loadStyles(document);
  const press = lastPress && Date.now() - lastPress.at < 3000 ? lastPress : null;
  const anchor = press?.target || document.activeElement?.closest?.(PRESS);
  toasts.push({ message, kind, anchor, anchorRect: press?.rect });
  if (!toastActive) playToast();
}

function loadStyles(doc) {
  if (doc.getElementById("qd-action-styles")) return;
  const link = doc.createElement("link");
  link.id = "qd-action-styles";
  link.rel = "stylesheet";
  link.href = new URL("./action-feedback-dialog.css", import.meta.url).href;
  doc.head.append(link);
}

function openDialog({ title, message, confirmLabel, danger = false, copyValue }) {
  loadStyles(document);
  const dialog = document.createElement("dialog");
  dialog.className = "qd-action-dialog";
  const id = ++dialogId;
  const heading = document.createElement("h2");
  heading.id = `qd-action-title-${id}`;
  dialog.setAttribute("aria-labelledby", heading.id);
  heading.textContent = title;
  const description = document.createElement("p");
  description.id = `qd-action-description-${id}`;
  dialog.setAttribute("aria-describedby", description.id);
  description.textContent = message;
  const form = document.createElement("form");
  form.method = "dialog";
  const footer = document.createElement("div");
  footer.className = "qd-action-dialog__actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = confirmLabel ? "Cancel" : "Close";
  cancel.autofocus = true;
  cancel.addEventListener("click", () => dialog.close());
  footer.append(cancel);
  let accept;
  if (confirmLabel) {
    accept = document.createElement("button");
    accept.type = "submit";
    accept.value = "accepted";
    accept.className = danger ? "qd-action-dialog__danger" : "qd-action-dialog__primary";
    accept.textContent = confirmLabel;
    footer.append(accept);
  }
  dialog.append(heading, description);
  let field;
  if (copyValue !== undefined) {
    field = document.createElement("textarea");
    field.readOnly = true;
    field.dir = "ltr";
    field.rows = 3;
    field.setAttribute("aria-label", "Full link");
    field.value = copyValue;
    cancel.autofocus = false;
    field.autofocus = true;
    dialog.append(field);
  }
  form.append(footer);
  dialog.append(form);
  const first = field || cancel;
  const last = accept || cancel;
  dialog.addEventListener("keydown", event => {
    if (event.key !== "Tab") return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  document.body.append(dialog);
  return new Promise((resolve, reject) => {
    dialog.addEventListener("close", () => {
      const accepted = dialog.returnValue === "accepted";
      dialog.remove();
      resolve(accepted);
    }, { once: true });
    try {
      dialog.showModal();
      field?.select();
    } catch (error) {
      dialog.remove();
      reject(error);
    }
  });
}

export function confirmAction({ title = "Confirm action", message, confirmLabel = "Continue", danger = false }) {
  return openDialog({ title, message, confirmLabel, danger });
}

export function showActionMessage({ title = "Notice", message }) {
  return openDialog({ title, message });
}

export async function copyWithFallback(value, { title = "Copy link" } = {}) {
  let timeout;
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
    await Promise.race([
      navigator.clipboard.writeText(value),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Clipboard timed out")), 3000); }),
    ]);
    return true;
  } catch {
    await openDialog({ title, message: "Select and copy the full link below.", copyValue: value });
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

const messageOf = (error, what) => {
  const text = error?.message && !/^Failed to fetch$|^Load failed$|NetworkError/i.test(error.message) ? error.message : "";
  return text || `${what} could not reach the server. Check your internet connection and try again.`;
};

function showInlineFailure(doc, text) {
  let note = doc.getElementById("qd-guest-action-status");
  if (!note) {
    note = doc.createElement("p");
    note.id = "qd-guest-action-status";
    note.className = "qd-guest-action-status";
    note.setAttribute("role", "status");
    const target = doc.querySelector("main:not([hidden])") || doc.body;
    target.prepend(note);
  }
  loadStyles(doc);
  note.textContent = text;
}

// Resolves {ok, result}, {ok:false, cancelled:true}, or {ok:false, error}.
export async function runAction(button, work, { busyLabel = "", successLabel = "", success = "", markSuccess = true, what = "This action", onError = null, toast = showToast } = {}) {
  if (button?.dataset.busy === "1") return { ok: false, error: new Error("busy") };
  actionReset.get(button)?.();
  const labelledButton = (busyLabel || successLabel) && button?.tagName === "BUTTON";
  const original = labelledButton ? [...button.childNodes] : null;
  const wasDisabled = button?.disabled;
  const hadFocus = Boolean(button) && typeof document !== "undefined" && document.activeElement === button;
  let keepSuccessLabel = false;
  if (button) {
    button.dataset.busy = "1";
    button.setAttribute("aria-busy", "true");
    button.classList.remove("is-done", "is-failed");
    button.classList.add("is-busy");
    button.disabled = true;
    if (labelledButton && busyLabel) button.textContent = busyLabel;
    if (button.nextElementSibling?.classList?.contains("action-error")) button.nextElementSibling.remove();
  }
  try {
    const result = await work();
    if (result === false) return { ok: false, cancelled: true };
    if (button?.isConnected && (markSuccess || successLabel)) {
      if (markSuccess) button.classList.add("is-done");
      keepSuccessLabel = Boolean(labelledButton && successLabel);
      if (keepSuccessLabel) button.textContent = successLabel;
      const reset = () => {
        clearTimeout(timer);
        button.classList.remove("is-done");
        if (keepSuccessLabel && button.isConnected) button.replaceChildren(...original);
        actionReset.delete(button);
      };
      const timer = setTimeout(reset, 1600);
      actionReset.set(button, reset);
    }
    if (success) toast(success, "success");
    return { ok: true, result };
  } catch (error) {
    const message = messageOf(error, what);
    if (onError) onError(error, message);
    else if (button?.isConnected) {
      button.classList.add("is-failed");
      const note = button.ownerDocument.createElement("p");
      note.className = "action-error";
      note.setAttribute("role", "alert");
      note.textContent = `${message} Try again.`;
      button.after(note);
    } else if (typeof document !== "undefined" && !workspacePaths.test(document.location.pathname)) {
      showInlineFailure(document, "Something went wrong. Please try again.");
    } else toast(message, "error");
    return { ok: false, error };
  } finally {
    if (button) {
      delete button.dataset.busy;
      button.removeAttribute("aria-busy");
      button.classList.remove("is-busy");
      if (button.isConnected) {
        button.disabled = wasDisabled === true;
        if (original && !keepSuccessLabel) button.replaceChildren(...original);
        if (hadFocus && (document.activeElement === document.body || document.activeElement === button)) button.focus({ preventScroll: true });
      }
    }
  }
}

export function runFromEvent(event, work, options = {}) {
  const button = event?.submitter || event?.target?.closest?.("button, [role='button']");
  return runAction(button, work, options);
}

const PRESS = "button, summary, [role='button'], a.primary-button, a.secondary-button, a.open-button, label.event-category-card, .da3wa-nav-link";
export function installFeedback(doc = document) {
  if (doc.documentElement.dataset.feedbackInstalled) return;
  doc.documentElement.dataset.feedbackInstalled = "1";
  const press = event => {
    const target = event.target?.closest?.(PRESS);
    if (!target || target.disabled) return;
    lastPress = { target, rect: target.getBoundingClientRect(), at: Date.now() };
    target.classList.add("is-pressed");
    setTimeout(() => target.classList.remove("is-pressed"), 350);
  };
  doc.addEventListener("pointerdown", press, { capture: true, passive: true });
  doc.addEventListener("touchstart", () => {}, { passive: true }); // lets :active work on iOS
  doc.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") press(event); }, true);

  const autoBusy = new Set();
  const watch = new MutationObserver(() => {
    for (const button of autoBusy) {
      if (button.disabled && button.isConnected) continue;
      button.classList.remove("is-busy", "is-auto-busy");
      autoBusy.delete(button);
    }
    if (!autoBusy.size) watch.disconnect();
  });
  doc.addEventListener("click", event => {
    const button = event.target?.closest?.("button");
    if (!button || button.classList.contains("is-busy")) return;
    setTimeout(() => {
      if (!button.isConnected || !button.disabled || button.classList.contains("is-busy")) return;
      button.classList.add("is-busy", "is-auto-busy");
      if (!autoBusy.size) watch.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });
      autoBusy.add(button);
    }, 40);
  }, true);

  doc.addEventListener("submit", event => {
    const button = event.submitter;
    if (!button || button.classList.contains("is-busy")) return;
    button.classList.add("is-busy");
    setTimeout(() => { if (button.dataset.busy !== "1") button.classList.remove("is-busy"); }, 1500);
  }, true);

  doc.defaultView?.addEventListener("unhandledrejection", event => {
    const reason = event.reason;
    if (reason?.name === "AbortError" || reason?.message === "busy") return;
    console.error("Unhandled action failure", reason?.message || reason);
    if (workspacePaths.test(doc.location.pathname)) {
      showToast(`That did not work: ${messageOf(reason, "The action")} Try again, and contact an admin if it keeps happening.`, "error");
    } else showInlineFailure(doc, "Something went wrong. Please try again.");
  });
}
if (typeof document !== "undefined") installFeedback();
