import {
  initFirebase,
  isFirebaseConfigured,
  signInWithEmailAndPassword,
} from "./firebase-config.js";
import {
  initializeFirebaseServicesForRoute,
  waitForFirebaseSessionPersistence,
} from "./firebase-service-scopes.js";

import * as accountApi from "./firebase-config.js";
import { isPlatformAdmin, redeemCustomerGrants } from "./account-access.js";

const params = new URLSearchParams(window.location.search);

const elements = {
  loginForm: document.getElementById("loginForm"),
  authStatus: document.getElementById("authStatus"),
  loginEyebrow: document.getElementById("loginEyebrow"),
  loginTitle: document.getElementById("loginTitle"),
  loginDescription: document.getElementById("loginDescription"),
  loginSubmitButton: document.getElementById("loginSubmitButton"),
  loginSubmitLabel: document.getElementById("loginSubmitLabel"),
  passwordInput: document.getElementById("loginPassword"),
  passwordToggle: document.querySelector("[data-password-toggle]"),
  eyeShow: document.querySelector("[data-eye-show]"),
  eyeHide: document.querySelector("[data-eye-hide]"),
  spinner: document.querySelector(".planner-login__spinner"),
  submitArrow: document.querySelector(".planner-login__submit-arrow"),
};

let services = null;
let servicesReady = Promise.resolve(false);
let isRedirecting = false;

init();

function init() {
  elements.passwordToggle?.addEventListener("click", togglePasswordVisibility);
  elements.loginForm?.addEventListener("submit", handleLogin);

  if (!isFirebaseConfigured()) {
    elements.authStatus.textContent = "Firebase is not configured yet. Dashboard access is unavailable.";
    return;
  }

  try {
    services = initializeFirebaseServicesForRoute(
      {},
      { dashboard: initFirebase },
    );
    servicesReady = waitForFirebaseSessionPersistence(services)
      .then(() => true)
      .catch((error) => {
        console.error("Firebase session could not be prepared.", error);
        elements.authStatus.textContent = "Dashboard sign-in could not be prepared. Please refresh and try again.";
        return false;
      });
  } catch (error) {
    console.error("Firebase session could not be initialized.", error);
    elements.authStatus.textContent = "Firebase sign-in could not be initialized.";
    return;
  }
  const statusMessage = params.get("message");
  if (statusMessage === "signed-out") {
    elements.authStatus.textContent = "You signed out successfully.";
  }
  if (statusMessage === "session-required") {
    elements.authStatus.textContent = "Please sign in to continue to the dashboard.";
  }
  if (statusMessage === "access-denied") {
    elements.authStatus.textContent = "This account does not have dashboard access for that event.";
  }
  if (statusMessage === "missing-wedding") {
    elements.authStatus.textContent = "Please sign in from an event-specific dashboard link.";
  }
  if (statusMessage === "firebase-not-configured") {
    elements.authStatus.textContent = "Firebase is not configured yet. Dashboard access is unavailable.";
  }
}

async function handleLogin(event) {
  event.preventDefault();
  if (!services?.auth || elements.loginSubmitButton.disabled) {
    elements.authStatus.textContent = "Firebase is not ready yet.";
    return;
  }

  const email = event.currentTarget.email.value.trim();
  const password = event.currentTarget.password.value;
  elements.authStatus.textContent = "Signing in...";
  setSubmitLoading(true);

  try {
    if (!(await servicesReady)) return;
    const { user } = await signInWithEmailAndPassword(services.auth, email, password);
    try { await redeemCustomerGrants(accountApi, services.db, user); }
    catch (error) { console.warn("Customer linking will be retried from the event list.", error.code || "unavailable"); }
    services.isAdmin = await isPlatformAdmin(accountApi, services.db, user.uid);
    elements.authStatus.textContent = services.isAdmin ? "Opening All Events..." : "Opening My Events...";
    redirectAfterLogin();
  } catch (error) {
    console.error(error);
    elements.authStatus.textContent = "Sign-in failed. Please check your email and password.";
  } finally {
    if (!isRedirecting) {
      setSubmitLoading(false);
    }
  }
}

function togglePasswordVisibility() {
  const isVisible = elements.passwordInput.type === "text";
  elements.passwordInput.type = isVisible ? "password" : "text";
  elements.passwordToggle.setAttribute("aria-pressed", String(!isVisible));
  elements.passwordToggle.setAttribute("aria-label", isVisible ? "Show password" : "Hide password");
  elements.eyeShow.hidden = !isVisible;
  elements.eyeHide.hidden = isVisible;
}

function setSubmitLoading(isLoading) {
  elements.loginSubmitButton.disabled = isLoading;
  elements.loginSubmitButton.setAttribute("aria-busy", String(isLoading));
  elements.loginSubmitLabel.textContent = isLoading
    ? "Signing in..."
    : "Sign in";
  elements.spinner.hidden = !isLoading;
  elements.submitArrow.hidden = isLoading;
}

function redirectAfterLogin() {
  isRedirecting = true;
  const weddingId = params.get("wedding")?.trim() || "";
  const requestedSide = params.get("side")?.trim().toLowerCase() || "";
  if (weddingId && params.get("workspace") === "side") {
    const target = new URL("./side.html", window.location.href);
    target.searchParams.set("wedding", weddingId);
    if (["bride", "groom", "family", "all"].includes(requestedSide)) {
      target.searchParams.set("side", requestedSide);
    }
    window.location.replace(target.toString());
    return;
  }
  window.location.replace(services.isAdmin ? "./all-events.html" : "./customer-events.html");
}
