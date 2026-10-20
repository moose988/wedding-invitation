export function validateGenderRevealResponse(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Enter your response.");
  const fullName = typeof input.fullName === "string" ? input.fullName.trim() : "";
  if (!fullName || fullName.length > 120) throw new TypeError("Full name must be between 1 and 120 characters.");
  if (!new Set(["attending", "not_attending"]).has(input.attendance)) throw new TypeError("Choose whether you will attend.");
  if (!new Set(["boy", "girl"]).has(input.prediction)) throw new TypeError("Choose boy or girl.");
  const message = input.message === undefined || input.message === null ? "" : input.message;
  if (typeof message !== "string" || message.length > 1000) throw new TypeError("Message must be 1,000 characters or fewer.");
  return { fullName, attendance: input.attendance, prediction: input.prediction, message: message.trim() };
}

export function createGenderRevealSubmissionService({ api, db, weddingId, ensureAnonymousUser, createResponseId = makeResponseId }) {
  if (!api?.doc || !api?.runTransaction || !api?.serverTimestamp || !db || !weddingId || typeof ensureAnonymousUser !== "function") {
    throw new TypeError("Gender reveal submission service is not configured.");
  }
  const ref = (...segments) => api.doc(db, "weddings", weddingId, ...segments);
  return async function submit(input) {
    const response = validateGenderRevealResponse(input);
    const sessionId = await ensureAnonymousUser();
    if (typeof sessionId !== "string" || !/^[A-Za-z0-9_-]{20,128}$/.test(sessionId)) {
      throw new TypeError("Could not identify this anonymous browser session.");
    }
    const responseId = createResponseId();
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(responseId)) throw new TypeError("Could not create a secure response identifier.");
    const eventRef = ref("publicEvent", "details");
    const responseRef = ref("genderRevealResponses", responseId);
    const keyRef = ref("genderRevealSessionKeys", sessionId);
    const stateRef = ref("genderRevealState", "summary");
    const aggregateRef = ref("genderRevealResults", "aggregate");

    try {
      await api.runTransaction(db, async (transaction) => {
      const [event, aggregate] = await Promise.all([
        transaction.get(eventRef), transaction.get(aggregateRef),
      ]);
      if (!event.exists() || event.data()?.eventCategory !== "gender_reveal" || event.data()?.eventStatus !== "active") {
        throw Object.assign(new Error("Responses are not open for this event."), { code: "failed-precondition" });
      }
      const previous = aggregate.exists() ? aggregate.data() : { boyCount: 0, girlCount: 0, totalCount: 0 };
      if (![previous.boyCount, previous.girlCount, previous.totalCount].every((value) => Number.isSafeInteger(value) && value >= 0) ||
          previous.totalCount !== previous.boyCount + previous.girlCount) {
        throw Object.assign(new Error("Event response totals need organizer attention."), { code: "failed-precondition" });
      }
      const boyCount = previous.boyCount + (response.prediction === "boy" ? 1 : 0);
      const girlCount = previous.girlCount + (response.prediction === "girl" ? 1 : 0);
      const totalCount = previous.totalCount + 1;
      transaction.set(responseRef, { ...response, createdAt: api.serverTimestamp() });
      transaction.set(keyRef, { responseId, createdAt: api.serverTimestamp() });
      transaction.set(stateRef, { boyCount, girlCount, totalCount, lastResponseId: responseId, lastSessionId: sessionId, updatedAt: api.serverTimestamp() });
      transaction.set(aggregateRef, { boyCount, girlCount, totalCount, updatedAt: api.serverTimestamp() });
      });
    } catch (error) {
      throw error;
    }
    return { ok: true };
  };
}

function makeResponseId() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
