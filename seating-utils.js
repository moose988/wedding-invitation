export function resolveTableName(table, fallback = "Table") {
  const currentName = String(table?.name || "").trim();
  if (currentName) return currentName;
  const legacyName = String(table?.label || "").trim();
  return legacyName || fallback;
}

export function summarizePartySeating(guest, assignments = []) {
  const extraCount = Number(guest?.additionalGuests);
  const requiredCount =
    1 + (Number.isInteger(extraCount) && extraCount > 0 ? extraCount : 0);
  const assignedPeople = new Set();

  assignments.forEach((assignment, index) => {
    const explicitIndex = Number(assignment?.partyMemberIndex);
    const keyedIndex = String(assignment?.personKey || "").match(
      /^(?:main|guest-(\d+))$/,
    );
    const memberIndex = Number.isInteger(explicitIndex) && explicitIndex >= 0
      ? explicitIndex
      : assignment?.personKey === "main"
        ? 0
        : keyedIndex?.[1]
          ? Number(keyedIndex[1])
          : index;
    if (memberIndex < requiredCount) assignedPeople.add(memberIndex);
  });

  const assignedCount = assignedPeople.size;
  return {
    requiredCount,
    assignedCount,
    remainingCount: Math.max(0, requiredCount - assignedCount),
    complete: assignedCount >= requiredCount,
  };
}

export function assignmentsForGuest(assignments, guestId) {
  const normalizedId = String(guestId || "");
  if (!normalizedId) return [];
  return assignments.filter(
    (assignment) => String(assignment?.guestId || "") === normalizedId,
  );
}
