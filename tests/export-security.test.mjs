import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("CSV cells quote values and neutralize formula-leading content", async () => {
  const { csvCell } = await import("../export.js");
  for (const payload of ["=1+1", "  +SUM(A1:A2)", "-1+1", "@SUM(1,1)", "＝1+1", "\t=1+1", "\n=1+1"]) {
    const cell = csvCell(payload);
    assert.ok(cell.startsWith('"\t'), JSON.stringify(payload));
    assert.ok(cell.endsWith('"'));
  }
  assert.equal(csvCell('guest, "VIP"'), '"guest, ""VIP"""');
});

test("XLSX export stores attacker-controlled cells as text, not formulas", async () => {
  const source = await readFile(new URL("../vendor/xlsx.full.min.js", import.meta.url), "utf8");
  const context = { window: {}, console, setTimeout, clearTimeout, Uint8Array, ArrayBuffer, DataView, TextDecoder, TextEncoder, Blob };
  vm.runInNewContext(source, context);
  const XLSX = context.window.XLSX;
  let exportedWorkbook;
  XLSX.writeFile = (workbook) => { exportedWorkbook = workbook; };
  globalThis.window = { XLSX };
  try {
    const { exportGuests } = await import("../export.js");
    await exportGuests([{
      fullName: "=HYPERLINK(\"https://attacker.invalid\",\"click\")",
      phone: "@SUM(1,1)",
      side: "+cmd|' /C calc'!A0",
      rsvpStatus: "pending",
      notes: "<img src=x onerror=alert(1)>",
      inviteLink: "https://example.invalid/#guest=secret-token",
      qrCodeValue: "<img src=x onerror=alert(1)>",
    }], "security-fixture");
    const sheet = exportedWorkbook.Sheets.Guests;
    for (const address of ["A2", "B2", "D2", "I2", "J2"]) {
      assert.equal(sheet[address]?.t, "s", `${address} should remain an XLSX string cell`);
    }
    for (const address of ["A2", "B2", "C2", "D2", "I2", "J2"]) {
      assert.equal(sheet[address]?.f, undefined, `${address} must not contain a formula`);
    }
    assert.match(sheet.A2.v, /^=HYPERLINK/);
    assert.match(sheet.J2.v, /<img/);
  } finally {
    delete globalThis.window;
  }
});
