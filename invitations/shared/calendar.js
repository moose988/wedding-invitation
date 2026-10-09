function escapeIcsText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function toUtcIcsDate(value) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function foldIcsLine(line) {
  const encoder = new TextEncoder();
  const chunks = [];
  let current = "";
  let bytes = 0;
  for (const character of line) {
    const width = encoder.encode(character).length;
    if (bytes + width > 74) {
      chunks.push(current);
      current = ` ${character}`;
      bytes = 1 + width;
    } else {
      current += character;
      bytes += width;
    }
  }
  chunks.push(current);
  return chunks.join("\r\n");
}

export function buildInvitationCalendar(wedding = {}, weddingId = "local-demo", createdAt = new Date()) {
  const start = new Date(wedding.eventDateISO);
  if (Number.isNaN(start.getTime())) throw new Error("A valid event start date is required.");
  const configuredEnd = wedding.eventEndDateISO || wedding.endDateISO || wedding.eventEndISO;
  const end = configuredEnd ? new Date(configuredEnd) : null;
  const validEnd = end && !Number.isNaN(end.getTime()) && end > start ? end : null;
  const title = wedding.eventTitle || [wedding.brideName, wedding.groomName].filter(Boolean).join(" & ") || "Wedding celebration";
  const venue = [wedding.venueEn || wedding.venueName || "", wedding.locationEn || wedding.location || ""].filter(Boolean).join(", ");
  const description = [wedding.invitationMessageEn || "", wedding.mapsUrl || ""].filter(Boolean).join("\n");
  const uid = `${weddingId || wedding.id || "local-demo"}@invitation.qdsystems.ae`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//QD Systems//Wedding Invitation//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(uid)}`,
    `DTSTAMP:${toUtcIcsDate(createdAt)}`,
    `DTSTART:${toUtcIcsDate(start)}`,
    ...(validEnd ? [`DTEND:${toUtcIcsDate(validEnd)}`] : []),
    `SUMMARY:${escapeIcsText(title)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `LOCATION:${escapeIcsText(venue)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}
