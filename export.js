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
    script.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    script.async = true;
    script.onload = () => resolve(window.XLSX);
    script.onerror = () => reject(new Error("SheetJS failed to load."));
    document.head.appendChild(script);
  });

  return sheetJsPromise;
}

export async function exportGuests(rows, fileBaseName = "guest-list", options = {}) {
  const normalisedRows = rows.map((row) => {
    const output = {
      "Guest Name": row.fullName || "",
      Phone: row.phone || "",
      "Additional Guests": normaliseAdditionalGuests(row.additionalGuests),
      Side: row.side || "",
      "RSVP Status": row.rsvpStatus || "",
    };
    if (options.includeSeating) {
      output.Table = row.tableName || "";
      output["Seat Number"] = row.seatNumber || "";
    }
    return {
      ...output,
      Invitation: row.inviteLink || row.guestToken ? "Ready" : "Not ready",
      "Checked In": row.checkedIn ? "Yes" : "No",
      "Checked In At": row.checkedInAt || "",
      "Invite Link": row.inviteLink || "",
      "QR Code": row.qrCodeValue || "",
    };
  });

  try {
    const XLSX = await loadSheetJs();
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(normalisedRows);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Guests");
    XLSX.writeFile(workbook, `${fileBaseName}.xlsx`);
    return "xlsx";
  } catch (error) {
    const fallbackShape = {
      "Guest Name": "",
      Phone: "",
      "Additional Guests": "",
      Side: "",
      "RSVP Status": "",
    };
    if (options.includeSeating) {
      fallbackShape.Table = "";
      fallbackShape["Seat Number"] = "";
    }
    const header = Object.keys(normalisedRows[0] || {
      ...fallbackShape,
      Invitation: "",
      "Checked In": "",
      "Checked In At": "",
      "Invite Link": "",
      "QR Code": "",
    });
    const csv = [header.join(","), ...normalisedRows.map((row) => header.map((column) => csvCell(row[column])).join(","))].join("\r\n");
    downloadFile(`${fileBaseName}.csv`, "text/csv;charset=utf-8", csv);
    return "csv";
  }
}

function normaliseAdditionalGuests(value) {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue >= 0 ? numberValue : 0;
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
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
