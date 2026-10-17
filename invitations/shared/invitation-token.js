const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_BYTES = 32;

export function generateInvitationToken(cryptoProvider = globalThis.crypto) {
  if (!cryptoProvider || typeof cryptoProvider.getRandomValues !== "function" || typeof btoa !== "function") {
    throw new Error("Secure invitation links are not supported in this browser.");
  }
  const bytes = cryptoProvider.getRandomValues(new Uint8Array(TOKEN_BYTES));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function isValidInvitationToken(token) {
  if (typeof token !== "string" || !INVITATION_TOKEN_PATTERN.test(token) || typeof atob !== "function") return false;
  try {
    const base64 = token.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - token.length % 4) % 4);
    const binary = atob(base64);
    if (binary.length !== TOKEN_BYTES) return false;
    let normalized = "";
    for (let i = 0; i < binary.length; i += 1) normalized += String.fromCharCode(binary.charCodeAt(i));
    return btoa(normalized).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "") === token;
  } catch {
    return false;
  }
}

function text(value, max, fallback = "") {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

function boundedNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function validColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : "";
}

export function buildInvitationProjection(weddingId, wedding = {}, guest = {}, tables = []) {
  const sourceTables = (Array.isArray(tables) ? tables : []).slice(0, 200);
  const tableIds = new Map(sourceTables.map((table, index) => [String(table.id || ""), `t${index + 1}`]));
  const projectedTables = sourceTables.map((table, index) => {
    const chairs = Array.isArray(table.chairs) ? table.chairs.slice(0, 250).map((chair, chairIndex) => ({
      id: `c${chairIndex + 1}`,
      seatNumber: boundedNumber(chair?.seatNumber, 1, 250, chairIndex + 1),
      x: boundedNumber(chair?.x, 0, 100, 50),
      y: boundedNumber(chair?.y, 0, 100, 50),
      rotation: boundedNumber(chair?.rotation, -360, 360, 0),
    })) : [];
    return {
      id: `t${index + 1}`,
      name: text(table.name || table.label, 100, "Table"),
      shape: text(table.shape, 30, "round"),
      x: boundedNumber(table.x, 0, 100, 50),
      y: boundedNumber(table.y, 0, 100, 50),
      width: boundedNumber(table.width, 80, 1200, 180),
      height: boundedNumber(table.height, 80, 1200, 180),
      rotation: boundedNumber(table.rotation, -360, 360, 0),
      seatCount: boundedNumber(table.seatCount || table.capacity, 0, 250, chairs.length),
      tableColor: validColor(table.tableColor),
      borderColor: validColor(table.borderColor),
      chairColor: validColor(table.chairColor),
      chairs,
    };
  });
  const rawAssignments = Array.isArray(guest.seatingAssignments) ? guest.seatingAssignments.slice(0, 11) : [];
  const assignments = rawAssignments.flatMap((assignment) => {
    const tableId = tableIds.get(String(assignment?.tableId || ""));
    if (!tableId || !Number.isInteger(Number(assignment?.seatNumber))) return [];
    const table = projectedTables.find((item) => item.id === tableId);
    return [{
      tableId,
      tableName: table?.name || "",
      seatNumber: String(assignment.seatNumber).slice(0, 4),
      personKey: text(assignment.personKey, 40),
      label: text(assignment.label, 80),
    }];
  });
  const extra = Number(guest.additionalGuests);
  const allowance = Number(guest.additionalGuestAllowance);
  return {
    eventId: weddingId,
    wedding: {
      eventTitle: text(wedding.eventTitle, 160),
      coupleName: text(wedding.coupleName, 160),
      brideName: text(wedding.brideName, 160),
      groomName: text(wedding.groomName, 160),
      brideNameAr: text(wedding.brideNameAr, 160),
      groomNameAr: text(wedding.groomNameAr, 160),
      eventCategory: wedding.eventCategory === "celebration" ? "celebration" : "wedding_engagement",
      eventDateISO: text(wedding.eventDateISO, 40),
      rsvpDeadlineISO: text(wedding.rsvpDeadlineISO, 40),
      timeEn: text(wedding.timeEn, 80),
      timeAr: text(wedding.timeAr, 80),
      venueEn: text(wedding.venueEn, 200),
      location: text(wedding.location, 300),
      locationEn: text(wedding.locationEn, 300),
      mapsUrl: text(wedding.mapsUrl, 2000),
      venueMapEmbedUrl: text(wedding.venueMapEmbedUrl, 3000),
      subtitleEn: text(wedding.subtitleEn, 500),
      subtitleAr: text(wedding.subtitleAr, 500),
      invitationMessageEn: text(wedding.invitationMessageEn, 2000),
      invitationMessageAr: text(wedding.invitationMessageAr, 2000),
      invitationLanguage: wedding.invitationLanguage === "ar" ? "ar" : "en",
      showInvitationQr: wedding.showInvitationQr !== false,
      seatingEnabled: wedding.seatingEnabled !== false,
      schedule: Array.isArray(wedding.schedule) ? wedding.schedule.slice(0, 12).map((item) => ({
        titleEn: text(item?.titleEn, 160), titleAr: text(item?.titleAr, 160),
        timeEn: text(item?.timeEn, 80), timeAr: text(item?.timeAr, 80),
        descriptionEn: text(item?.descriptionEn, 500), descriptionAr: text(item?.descriptionAr, 500),
      })) : [],
      hallObjects: Array.isArray(wedding.hallObjects) ? wedding.hallObjects.slice(0, 100).map((item) => ({
        id: text(item?.id, 80), type: text(item?.type, 40), label: text(item?.label, 100),
        x: boundedNumber(item?.x, 0, 100, 50), y: boundedNumber(item?.y, 0, 100, 50),
        width: boundedNumber(item?.width, 0, 1200, 280), height: boundedNumber(item?.height, 0, 1200, 280),
        rotation: boundedNumber(item?.rotation, -360, 360, 0), shape: text(item?.shape, 40),
        fillColor: validColor(item?.fillColor), borderColor: validColor(item?.borderColor),
      })) : [],
      tables: projectedTables,
    },
    guest: {
      fullName: text(guest.fullName, 160, "Guest"),
      additionalGuestAllowance: Number.isInteger(allowance) ? Math.max(0, Math.min(allowance, 10)) :
        (Number.isInteger(extra) ? Math.max(0, Math.min(extra, 10)) : 0),
      seatingAssignments: assignments,
      tableId: "",
      tableName: assignments[0]?.tableName || "",
      seatNumber: assignments[0]?.seatNumber || "",
    },
  };
}
