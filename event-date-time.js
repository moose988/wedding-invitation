export function eventDateTimeParts(value, timeZone = "") {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return { date: "", time: "" };
  if (!timeZone) {
    const pad = (part) => String(part).padStart(2, "0");
    return { date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, time: `${pad(date.getHours())}:${pad(date.getMinutes())}` };
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const fields = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return { date: `${fields.year}-${fields.month}-${fields.day}`, time: `${fields.hour}:${fields.minute}` };
}

export function localDateTimeToIso(dateValue, timeValue, timeZone = "") {
  const [year, month, day] = String(dateValue).split("-").map(Number);
  const [hour, minute] = String(timeValue).split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isInteger)) throw new TypeError("Enter a valid event date and time.");
  if (!timeZone) {
    const local = new Date(`${dateValue}T${timeValue}`);
    if (Number.isNaN(local.getTime())) throw new TypeError("Enter a valid event date and time.");
    return local.toISOString();
  }
  const intendedUtc = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = intendedUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = eventDateTimeParts(new Date(candidate), timeZone);
    const [localYear, localMonth, localDay] = parts.date.split("-").map(Number);
    const [localHour, localMinute] = parts.time.split(":").map(Number);
    const representedUtc = Date.UTC(localYear, localMonth - 1, localDay, localHour, localMinute);
    candidate += intendedUtc - representedUtc;
  }
  const result = new Date(candidate);
  if (Number.isNaN(result.getTime())) throw new TypeError("Enter a valid event date and time.");
  return result.toISOString();
}
