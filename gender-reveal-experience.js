const repositoryMediaPath = /^\/(?:images|videos|music)\/[A-Za-z0-9._/-]+$/;

export function safeGenderRevealMediaUrl(value, origin = globalThis.location?.origin || "https://example.invalid") {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > 2048) return "";
  try {
    if (text.startsWith("/")) {
      if (!repositoryMediaPath.test(text) || text.includes("..") || text.includes("//") || text.includes("\\") || /[?#\s]/.test(text)) return "";
      return new URL(text, origin).href;
    }
    const url = new URL(text);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

export function genderRevealResultSummary(aggregate = {}) {
  const boyCount = Number.isSafeInteger(aggregate.boyCount) && aggregate.boyCount >= 0 ? aggregate.boyCount : 0;
  const girlCount = Number.isSafeInteger(aggregate.girlCount) && aggregate.girlCount >= 0 ? aggregate.girlCount : 0;
  const totalCount = boyCount + girlCount;
  return {
    boyCount,
    girlCount,
    totalCount,
    boyPercent: totalCount ? Math.round((boyCount / totalCount) * 100) : 0,
    girlPercent: totalCount ? Math.round((girlCount / totalCount) * 100) : 0,
  };
}

export function genderRevealSubmissionErrorKey(error) {
  if (error?.code === "failed-precondition") return "closedError";
  if (error?.code === "already-exists") return "duplicateError";
  if (error?.code === "auth/network-request-failed") return "networkError";
  if (error?.code === "permission-denied" || error?.code === "unauthenticated" || error?.code?.startsWith("auth/")) return "permissionError";
  if (error?.code === "resource-exhausted" || error?.code === "quota-exceeded") return "quotaError";
  if (error?.code === "unavailable" || error?.code === "network-request-failed" || error?.code === "deadline-exceeded" || error?.code === "cancelled" || globalThis.navigator?.onLine === false) return "networkError";
  return "saveError";
}

export function genderRevealLocalValidation(values) {
  const errors = {};
  const fullName = typeof values.fullName === "string" ? values.fullName.trim() : "";
  const message = values.message === undefined ? "" : values.message;
  if (!fullName) errors.fullName = "nameRequired";
  else if (fullName.length > 120) errors.fullName = "nameTooLong";
  if (!["attending", "not_attending"].includes(values.attendance)) errors.attendance = "attendanceRequired";
  if (!["boy", "girl"].includes(values.prediction)) errors.prediction = "predictionRequired";
  if (typeof message !== "string" || message.length > 1000) errors.message = "messageTooLong";
  return errors;
}
