import { quoteHtml } from "./quote-print.js";

const pageWidth = 210;
const pageHeight = 297;
const margin = 16;
const contentWidth = pageWidth - 2 * margin;
const contentHeight = pageHeight - 2 * margin;

export async function downloadQuotePdf(view) {
  await Promise.all([import("./vendor/html2canvas.min.js"), import("./vendor/jspdf.umd.min.js")]);
  await document.fonts?.ready;
  const pdf = new window.jspdf.jsPDF({ unit: "mm", format: "a4", compress: true });
  const template = document.createElement("template");
  template.innerHTML = quoteHtml(view);
  const quote = template.content.firstElementChild;
  const header = quote.querySelector(".quote-sheet__head");
  const table = quote.querySelector("table");
  const totals = quote.querySelector(".quote-sheet__totals");
  const terms = quote.querySelector(".quote-sheet__terms");
  const pages = document.createElement("div");
  pages.setAttribute("aria-hidden", "true");
  Object.assign(pages.style, { position: "absolute", left: "-10000px", top: "0", width: `${contentWidth}mm`, pointerEvents: "none" });
  document.body.append(pages);

  try {
    function newPage() {
      const page = quote.cloneNode(false);
      // Contain the last paragraph's margin so the capture includes its descenders.
      Object.assign(page.style, { display: "flow-root", paddingBottom: "4px", overflowWrap: "anywhere" });
      page.append(header.cloneNode(true));
      pages.append(page);
      return page;
    }

    function addTable(page) {
      const copy = table.cloneNode(false);
      const heading = table.tHead.cloneNode(true);
      copy.style.tableLayout = "fixed";
      const widths = ["44%", "8%", "24%", "24%"];
      Array.from(heading.rows[0].cells).forEach((cell, index) => { cell.style.width = widths[index]; });
      copy.append(heading);
      page.append(copy);
      return copy.createTBody();
    }

    let page = newPage();
    page.append(quote.querySelector(".quote-sheet__to"));
    page.style.minHeight = `${contentHeight}mm`;
    const pageLimit = page.getBoundingClientRect().height + 0.5;
    page.style.minHeight = "";
    const fits = () => page.getBoundingClientRect().height <= pageLimit;

    let rows = addTable(page);
    for (const row of Array.from(table.tBodies[0].rows)) {
      rows.append(row);
      if (!fits()) {
        const previousTable = rows.parentElement;
        page = newPage();
        rows = addTable(page);
        rows.append(row);
        if (previousTable.tBodies[0].rows.length === 0) previousTable.remove();
      }
    }
    page.append(totals);
    if (!fits()) {
      page = newPage();
      page.append(totals);
    }

    // Split long terms at word boundaries when possible, keeping the original whitespace.
    const termsText = Array.from(String(view.terms ?? ""));
    const addTerms = (continued = false) => {
      const section = terms.cloneNode(true);
      if (continued) section.querySelector("h2").textContent += " (continued)";
      const paragraph = section.querySelector("p");
      Object.assign(paragraph.style, { whiteSpace: "pre-wrap", overflowWrap: "anywhere" });
      page.append(section);
      return { section, paragraph };
    };
    let { section, paragraph } = addTerms();
    paragraph.textContent = termsText.join("");
    if (!fits()) {
      let offset = 0;
      while (offset < termsText.length) {
        let low = offset;
        let high = termsText.length;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          paragraph.textContent = termsText.slice(offset, middle).join("");
          if (fits()) low = middle;
          else high = middle - 1;
        }
        if (low === offset) {
          if (page.children.length === 2) throw new Error("The quotation terms could not fit on a PDF page.");
          section.remove();
          page = newPage();
          ({ section, paragraph } = addTerms(offset > 0));
          continue;
        }
        let end = low;
        if (end < termsText.length) {
          while (end > offset && !/\s/u.test(termsText[end - 1])) end--;
          if (end === offset) end = low;
        }
        paragraph.textContent = termsText.slice(offset, end).join("");
        offset = end;
        if (offset < termsText.length) {
          page = newPage();
          ({ section, paragraph } = addTerms(true));
        }
      }
    }

    for (const [index, sheet] of Array.from(pages.children).entries()) {
      const canvas = await window.html2canvas(sheet, { scale: 2, backgroundColor: "#fff", windowWidth: 1200, logging: false });
      if (index > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", margin, margin, contentWidth, contentWidth * canvas.height / canvas.width);
      canvas.width = 0;
      canvas.height = 0;
    }
    const number = String(view.number ?? "").replace(/[^a-z0-9_-]/gi, "-");
    await pdf.save(number ? `quotation-${number}.pdf` : "quotation.pdf", { returnPromise: true });
  } finally {
    pages.remove();
  }
}
