export function resolvePartySeatTarget(assignment, tables = []) {
  const tableId = String(assignment?.tableId || "");
  if (!tableId || !Array.isArray(tables)) return null;

  const table = tables.find((item) => String(item?.id || "") === tableId);
  if (!table) return null;

  const chairs = Array.isArray(table.chairs) ? table.chairs : [];
  const requestedChairId = String(assignment?.chairId || "");
  const chair = requestedChairId
    ? chairs.find((item) => String(item?.id || "") === requestedChairId)
    : chairs.find((item) => String(item?.seatNumber ?? "") === String(assignment?.seatNumber ?? ""));
  if (!chair?.id || chair.seatNumber === undefined || chair.seatNumber === null || chair.seatNumber === "") return null;

  return {
    tableId,
    chairId: String(chair.id),
    seatNumber: String(chair.seatNumber),
  };
}

export function getPartySeatSelection(personKey, partyMembers = [], tables = []) {
  const member = partyMembers.find((item) => item.personKey === personKey) || null;
  return {
    member,
    target: member?.assignment ? resolvePartySeatTarget(member.assignment, tables) : null,
  };
}

export function retainPartySeatSelection(personKey, partyMembers = []) {
  return partyMembers.some((item) => item.personKey === personKey) ? personKey : "";
}

// Presentation only: never rewrite the table name stored with an assignment.
export function formatPartySeatLabel(tableName, seatNumber, language = "en") {
  const name = String(tableName || "").trim();
  if (language === "ar") {
    const table = /^(?:الطاولة|طاولة|طاولتك)(?:\s|$)/u.test(name) ? name : `الطاولة ${name}`;
    return `${table} · المقعد ${seatNumber}`;
  }
  const table = /^(?:table|your table)(?:\s|$)/i.test(name) ? name : `Table ${name}`;
  return `${table} · Chair ${seatNumber}`;
}
