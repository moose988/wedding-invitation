import {
  collection,
  doc,
  getDoc,
  getDocs,
  initFirebase,
  isFirebaseConfigured,
  onAuthStateChanged,
  query,
  signInWithEmailAndPassword,
  where,
} from "./firebase-config.js";

const params = new URLSearchParams(window.location.search);
const lastWeddingStorageKey = "da3wa:lastDashboardWeddingId";

const elements = {
  loginForm: document.getElementById("loginForm"),
  authStatus: document.getElementById("authStatus"),
};

let services = null;
let isRedirecting = false;

init();

function init() {
  if (!isFirebaseConfigured()) {
    elements.authStatus.textContent = "Firebase is not configured yet. Dashboard access is unavailable.";
    return;
  }

  services = initFirebase();
  elements.loginForm?.addEventListener("submit", handleLogin);

  onAuthStateChanged(services.auth, async (user) => {
    if (!user || isRedirecting) {
      return;
    }

    const weddingId = await resolveAccessibleWeddingId(user);
    if (!weddingId) {
      elements.authStatus.textContent = "No dashboard access was found for this account.";
      return;
    }

    redirectToDashboard(weddingId);
  });

  const statusMessage = params.get("message");
  if (statusMessage === "signed-out") {
    elements.authStatus.textContent = "You signed out successfully.";
  }
  if (statusMessage === "session-required") {
    elements.authStatus.textContent = "Please sign in to continue to the dashboard.";
  }
  if (statusMessage === "access-denied") {
    elements.authStatus.textContent = "This account does not have dashboard access for that wedding.";
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
  if (!services?.auth) {
    elements.authStatus.textContent = "Firebase is not ready yet.";
    return;
  }

  const email = event.currentTarget.email.value.trim();
  const password = event.currentTarget.password.value;
  elements.authStatus.textContent = "Signing in...";

  try {
    const credential = await signInWithEmailAndPassword(services.auth, email, password);
    elements.authStatus.textContent = "Redirecting to dashboard...";
    const weddingId = await resolveAccessibleWeddingId(credential.user);
    if (!weddingId) {
      elements.authStatus.textContent = "No dashboard access was found for this account.";
      return;
    }
    redirectToDashboard(weddingId);
  } catch (error) {
    console.error(error);
    elements.authStatus.textContent = "Sign-in failed. Please check your email and password.";
  }
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
  return permissionDoc.exists() && permissionDoc.data().canViewDashboard;
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

  const query = nextParams.toString();
  return query ? `./dashboard.html?${query}` : "./dashboard.html";
}
