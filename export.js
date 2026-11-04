import { normalizeGuestPhone, normalizedGuestSide } from "./guest-edit.js?v=20261018-guest-invitation-regressions-2";

let sheetJsPromise = null;

function loadSheetJs() {
  if (window.XLSX) {
    return Promise.resolve(window.XLSX);
  }

  if (sheetJsPromise) {
    return sheetJsPromise;
  }

  sheetJsPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = new URL("./vendor/xlsx.full.min.js", import.meta.url).toString();
    script.async = true;
    script.onload = () => resolve(window.XLSX);
    script.onerror = () => reject(new Error("SheetJS failed to load."));
    document.head.appendChild(script);
  });

  return sheetJsPromise;
}

const sideLabels = { bride: "Bride side", groom: "Groom side", family: "Family", general: "General" };
const rsvpLabels = { pending: "Pending", confirmed: "Confirmed", declined: "Declined" };
const sortNames = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function guestExportRows(rows, options = {}) {
  const compare = (a, b) => {
    if (options.includeSeating) {
      const bySeat = sortNames.compare(a.tableName || "", b.tableName || "")
        || sortNames.compare(a.seatNumber || "", b.seatNumber || "");
      if (bySeat) return bySeat;
    }
    return sortNames.compare(a.fullName || "", b.fullName || "");
  };
  return [...rows].sort(compare).map((row) => {
    const phone = normalizeGuestPhone(row.phone);
    return guestExportRow(row, phone, options);
  });
}

function guestExportRow(row, phone, options) {
    const output = {
      "Guest Name": row.fullName || "",
      Phone: phone ? `+${phone}` : "",
      "Additional Guests": normaliseAdditionalGuests(row.additionalGuests),
      ...(options.includeSide === false ? {} : { Side: row.side ? sideLabels[normalizedGuestSide(row.side)] : "" }),
      "RSVP Status": Object.hasOwn(rsvpLabels, row.rsvpStatus) ? rsvpLabels[row.rsvpStatus] : "Pending",
    };
    if (options.includeSeating) {
      output.Table = row.tableName || "";
      output["Seat Number"] = row.seatNumber || "";
    }
    return {
      ...output,
      Invitation: row.inviteLink ? "Ready" : "No link yet",
      "Checked In": row.checkedIn ? "Yes" : "No",
      "Checked In At": row.checkedInAt || "",
      "Invite Link": row.inviteLink || "",
      "Check-in link": row.qrCodeValue || "",
    };
}

export async function exportGuests(rows, fileBaseName = "guest-list", options = {}) {
  if (rows.length === 0) return null;
  const normalisedRows = guestExportRows(rows, options);
  try {
    const XLSX = await loadSheetJs();
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(normalisedRows);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Guests");
    XLSX.writeFile(workbook, `${fileBaseName}.xlsx`);
    return "xlsx";
  } catch {
    const header = Object.keys(normalisedRows[0]);
    const csv = [header.join(","), ...normalisedRows.map((row) => header.map((column) => csvCell(row[column])).join(","))].join("\r\n");
    downloadFile(`${fileBaseName}.csv`, "text/csv;charset=utf-8", csv);
    return "csv";
  }
}

export async function exportGenderRevealResponses(rows, fileBaseName = "gender-reveal-responses") {
  const normalisedRows = rows.map((row) => ({
    "Full Name / الاسم الكامل": spreadsheetSafeText(row.fullName || ""),
    "International Phone / رقم الهاتف": spreadsheetSafeText(row.phoneE164 || ""),
    "Attendance / الحضور": row.attendance === "attending" ? "Attending / سأحضر" : row.attendance === "not_attending" ? "Not attending / لن أحضر" : "",
    "Prediction / التوقع": row.prediction === "boy" ? "Boy / ولد" : row.prediction === "girl" ? "Girl / بنت" : "",
    "Message to Parents / رسالة إلى الوالدين": spreadsheetSafeText(row.message || ""),
    "Submitted At / وقت الإرسال": row.createdAt?.toDate?.()
      ? new Intl.DateTimeFormat("en-AE", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dubai" }).format(row.createdAt.toDate())
      : "",
  }));
  try {
    const XLSX = await loadSheetJs();
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(normalisedRows);
    worksheet["!cols"] = [{ wch: 26 }, { wch: 24 }, { wch: 23 }, { wch: 19 }, { wch: 44 }, { wch: 27 }];
    worksheet["!rtl"] = true;
    XLSX.utils.book_append_sheet(workbook, worksheet, "Responses الردود");
    XLSX.writeFile(workbook, `${fileBaseName}.xlsx`);
    return "xlsx";
  } catch {
    const header = Object.keys(normalisedRows[0] || {
      "Full Name": "", "International Phone": "", Attendance: "", Prediction: "", "Message to Parents": "", "Submitted At": "",
    });
    const csv = [header.map(csvCell).join(","), ...normalisedRows.map((row) => header.map((column) => csvCell(row[column])).join(","))].join("\r\n");
    downloadFile(`${fileBaseName}.csv`, "text/csv;charset=utf-8", csv);
    return "csv";
  }
}

export function spreadsheetSafeText(value) {
  const text = String(value ?? "");
  return /^[\s\uFEFF]*[=+\-@\t\r\n＝＋－＠]/u.test(text) ? `'${text}` : text;
}

function normaliseAdditionalGuests(value) {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue >= 0 ? numberValue : 0;
}

export function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s\uFEFF]*[=+\-@\t\r\n＝＋－＠]/u.test(text)) text = `\t${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadFile(name, type, content) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
