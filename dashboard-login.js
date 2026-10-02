import {
  collection,
  doc,
  getDoc,
  getDocs,
  initFirebase,
  isFirebaseConfigured,
  query,
  signInWithEmailAndPassword,
  signOut,
  where,
} from "./firebase-config.js";

const params = new URLSearchParams(window.location.search);
const lastWeddingStorageKey = "da3wa:lastDashboardWeddingId";
const seatingOnlyMode = params.get("seatingOnly") === "1";
const requestedSeatingSide = ["bride", "groom"].includes(params.get("side"))
  ? params.get("side")
  : "";

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
let isRedirecting = false;
let sessionResetPromise = Promise.resolve(true);

init();

function init() {
  if (seatingOnlyMode) {
    document.title = "qdsystems Seating Editor";
    elements.loginEyebrow.textContent = "Seating Access";
    elements.loginTitle.textContent = "Event Seating Editor";
    elements.loginDescription.textContent = "Sign in to view and update the seating plan.";
    elements.loginSubmitLabel.textContent = "Open seating editor";
  }

  elements.passwordToggle?.addEventListener("click", togglePasswordVisibility);

  if (!isFirebaseConfigured()) {
    elements.authStatus.textContent = "Firebase is not configured yet. Dashboard access is unavailable.";
    return;
  }

  services = initFirebase();
  elements.loginForm?.addEventListener("submit", handleLogin);
  // Login links should always show the credential form. Firebase persists
  // sessions across visits, so clear any previous session before accepting
  // an explicit sign-in instead of redirecting on auth-state restoration.
  sessionResetPromise = signOut(services.auth).then(
    () => true,
    (error) => {
      console.error("Could not clear the previous dashboard session.", error);
      elements.authStatus.textContent = "Could not prepare sign-in. Please refresh and try again.";
      return false;
    },
  );

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
    if (!(await sessionResetPromise)) {
      return;
    }
    const credential = await signInWithEmailAndPassword(services.auth, email, password);
    elements.authStatus.textContent = "Redirecting to dashboard...";
    await redirectAfterLogin(credential.user);
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
    : seatingOnlyMode ? "Open seating editor" : "Sign in";
  elements.spinner.hidden = !isLoading;
  elements.submitArrow.hidden = isLoading;
}

async function redirectAfterLogin(user) {
  // Preserve an explicitly requested wedding across preview-domain sign-in.
  // Each Firebase Hosting preview is a separate browser origin, so a user may
  // need to authenticate again even when another preview channel is signed in.
  const requestedWeddingId = params.get("wedding");
  if (requestedWeddingId) {
    if (await canViewWedding(user, requestedWeddingId)) {
      rememberWeddingId(requestedWeddingId);
      redirectToDashboard(requestedWeddingId);
      return;
    }
    elements.authStatus.textContent =
      "This account does not have dashboard access for that event.";
    return;
  }

  // Seating-only accounts remain event-specific. Normal planners without an
  // explicit wedding land in the workspace.
  if (seatingOnlyMode) {
    const weddingId = await resolveAccessibleWeddingId(user);
    if (!weddingId) {
      elements.authStatus.textContent = "No seating access was found for this account.";
      return;
    }
    redirectToDashboard(weddingId);
    return;
  }

  isRedirecting = true;
  window.location.replace("./weddings.html");
}

async function resolveAccessibleWeddingId(user) {
  const requestedWeddingId = params.get("wedding");
  if (requestedWeddingId && (await canViewWedding(user, requestedWeddingId))) {
    rememberWeddingId(requestedWeddingId);
    return requestedWeddingId;
  }

  const rememberedWeddingId = localStorage.getItem(lastWeddingStorageKey);
  if (rememberedWeddingId && (await canViewWedding(user, rememberedWeddingId))) {
    return rememberedWeddingId;
  }

  return findFirstAccessibleWeddingId(user);
}

async function findFirstAccessibleWeddingId(user) {
  const snapshot = await getDocs(query(collection(services.db, "weddings"), where("status", "==", "active")));
  for (const weddingDoc of snapshot.docs) {
    if (await canViewWedding(user, weddingDoc.id)) {
      rememberWeddingId(weddingDoc.id);
      return weddingDoc.id;
    }
  }
  return "";
}

async function canViewWedding(user, weddingId) {
  const permissionDoc = await getDoc(doc(services.db, "weddings", weddingId, "dashboardUsers", user.uid));
  if (!permissionDoc.exists() || permissionDoc.data().canViewDashboard !== true) {
    return false;
  }

  const permission = permissionDoc.data();
  if (!seatingOnlyMode || permission.seatingOnly !== true) {
    return true;
  }

  if (
    permission.canEditSeating !== true ||
    !["bride", "groom", "all"].includes(permission.allowedSide) ||
    (requestedSeatingSide && permission.allowedSide !== "all" && requestedSeatingSide !== permission.allowedSide)
  ) {
    return false;
  }

  const weddingSnapshot = await getDoc(doc(services.db, "weddings", weddingId));
  return weddingSnapshot.exists() &&
    weddingSnapshot.data().eventCategory !== "celebration";
}

function rememberWeddingId(weddingId) {
  localStorage.setItem(lastWeddingStorageKey, weddingId);
}

function redirectToDashboard(weddingId) {
  isRedirecting = true;
  window.location.replace(buildDashboardUrl(weddingId));
}

function buildDashboardUrl(weddingId) {
  const nextParams = new URLSearchParams();

  if (weddingId) {
    nextParams.set("wedding", weddingId);
  }
  if (seatingOnlyMode) {
    nextParams.set("seatingOnly", "1");
  }
  if (requestedSeatingSide) {
    nextParams.set("side", requestedSeatingSide);
  }

  const query = nextParams.toString();
  return query ? `./dashboard.html?${query}` : "./dashboard.html";
}
