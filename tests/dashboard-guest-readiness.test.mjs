import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGuestPhone, parseBulkGuestEntries } from "../guest-edit.js";
import { exportGuests, guestExportRows } from "../export.js";

test("bulk entry preview preserves invalid lines and normalizes valid data", () => {
  const entries = parseBulkGuestEntries(
    "Noor, ٠٥٠١٢٣٤٥٦٧, ٢\n\n, wrong, 1.5\nHuda,, 3\nOmar, +971 50 765 4321",
    normalizeGuestPhone,
  );
  assert.deepEqual(entries.map(({ number, errors }) => [number, errors.length]), [[1, 0], [3, 3], [4, 0], [5, 0]]);
  assert.equal(entries[0].phone, "971501234567");
  assert.equal(entries[0].additionalGuests, 2);
  assert.equal(entries[1].line, ", wrong, 1.5");
  assert.equal(entries[2].phone, "");
  assert.equal(entries[2].additionalGuests, 3);
  assert.equal(entries[3].phone, "971507654321");
  const [tooLong] = parseBulkGuestEntries(`${"ع".repeat(81)},,11`, normalizeGuestPhone);
  assert.equal(tooLong.errors.length, 2);
});

test("guest exports sort by name or table and numeric seat, with readable labels", async () => {
  const guests = [
    { fullName: "Zaid", phone: "0501234567", side: "groom", rsvpStatus: "pending", tableName: "Table 2", seatNumber: 2 },
    { fullName: "Layla", phone: "+44 7700 900123", side: "bride", rsvpStatus: "confirmed", tableName: "Table 2", seatNumber: 10, inviteLink: "https://example.test/guest", qrCodeValue: "https://example.test/check-in" },
  ];
  assert.deepEqual(guestExportRows(guests).map((row) => row["Guest Name"]), ["Layla", "Zaid"]);
  const [first, second] = guestExportRows(guests, { includeSeating: true });
  assert.equal(first["Guest Name"], "Zaid");
  assert.equal(first.Phone, "+971501234567");
  assert.equal(first.Side, "Groom side");
  assert.equal(first["RSVP Status"], "Pending");
  assert.equal(first.Invitation, "No link yet");
  assert.equal(second.Phone, "+447700900123");
  assert.equal(second["Check-in link"], "https://example.test/check-in");
  assert.equal(await exportGuests([]), null);
});
