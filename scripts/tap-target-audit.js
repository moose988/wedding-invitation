// Paste into the browser console (or run through a browser automation tool) on any page at phone width.
// Lists every visible control smaller than 44 x 44 px, including the label area of radios and checkboxes.
// Used by the release checklist: each listed control must be fixed or have a written reason.
(() => {
  const MIN = 44;
  const visible = (el) => {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && !el.closest("[hidden],[inert],dialog:not([open])");
  };
  const target = (el) => {
    // A radio or checkbox inside a label is tapped through the label.
    const label = el.matches("input[type=radio],input[type=checkbox]") ? el.closest("label") : null;
    return (label || el).getBoundingClientRect();
  };
  const name = (el) => (el.getAttribute("aria-label") || el.textContent || el.name || el.id || el.tagName).trim().replace(/\s+/g, " ").slice(0, 40);
  return [...document.querySelectorAll("a[href], button, select, input:not([type=hidden]), summary, [role=button], [tabindex]:not([tabindex='-1'])")]
    .filter(visible)
    // Local-only tools (the emulator banner and diagnostics panel) never ship to real visitors.
    .filter((el) => !el.closest("#localFirestoreDiagnostics, .dev-banner, [data-dev-banner]") && !/switch to (live|emulator)/i.test(el.textContent))
    .map((el) => ({ el, r: target(el) }))
    .filter(({ r }) => r.width < MIN || r.height < MIN)
    .map(({ el, r }) => `${name(el)} (${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(" ")[0] : ""}): ${Math.round(r.width)}x${Math.round(r.height)}`);
})();
