const typeAliases = new Map([
  ["arrival", ["arrival", "guest arrival", "guest_arrival", "doors open"]],
  ["reception", ["reception", "welcome reception", "welcome_reception", "cocktail reception", "cocktail_reception"]],
  ["ceremony", ["ceremony", "wedding ceremony", "wedding_ceremony", "marriage ceremony", "marriage_ceremony", "nikah"]],
  ["dinner", ["dinner", "meal", "banquet", "dining"]],
  ["celebration", ["celebration", "dancing", "music", "party"]],
]);

function normalizeScheduleLabel(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u0640\u064B-\u065F\u0670]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function classifyScheduleLabel(value) {
  const label = normalizeScheduleLabel(value);
  if (!label) return "event";

  if (/(^| )(guest )?arrival( |$)|^doors open$|وصول الضيوف|استقبال الضيوف/.test(label)) return "arrival";
  if (/reception|cocktail|حفل استقبال|استقبال ترحيبي/.test(label)) return "reception";
  if (/ceremony|vows|nikah|مراسم عقد القران|عقد القران|مراسم الزفاف/.test(label)) return "ceremony";
  if (/dinner|meal|banquet|dining|العشاء|مأدبة/.test(label)) return "dinner";
  if (/celebration|dancing|music|party|الاحتفال|الرقص|الموسيقى|حفلة/.test(label)) return "celebration";
  return "event";
}

export function resolveLaylaScheduleIcon(item = {}) {
  for (const value of [item.eventType, item.type, item.kind, item.category]) {
    const normalized = normalizeScheduleLabel(value);
    if (!normalized) continue;
    for (const [icon, aliases] of typeAliases) {
      if (aliases.some((alias) => normalizeScheduleLabel(alias) === normalized)) return icon;
    }
  }
  return classifyScheduleLabel(item.titleEn) !== "event"
    ? classifyScheduleLabel(item.titleEn)
    : classifyScheduleLabel(item.titleAr);
}

const scheduleIconPaths = {
  arrival: '<path d="M7 21V5.5A2.5 2.5 0 0 1 9.5 3h7A2.5 2.5 0 0 1 19 5.5V21M5 21h14"/><path d="M15.5 12h.01"/><path d="M17 3.8V2"/>',
  reception: '<path d="m3.5 4 6.2 6.2L15.9 4M9.7 10.2v6.3m-3 3h6m-3-3v3"/><path d="m11.1 5.4 5.7 5.7L22.5 5.4M16.8 11.1v5.4m-2.5 3h5m-2.5-3v3"/>',
  ceremony: '<circle cx="9" cy="12" r="6.4"/><circle cx="15" cy="12" r="6.4"/>',
  dinner: '<circle cx="12" cy="12" r="6.3"/><path d="M3.5 4v6m-2-6v3.5a2 2 0 0 0 4 0V4m-2 6v10M20 4v16m0-16c-2.1 1.9-3 4.1-3 6.2h3"/>',
  celebration: '<path d="M8 17V5l11-2v12"/><ellipse cx="5.5" cy="18.5" rx="2.5" ry="1.8" transform="rotate(-18 5.5 18.5)"/><ellipse cx="16.5" cy="16" rx="2.5" ry="1.8" transform="rotate(-18 16.5 16)"/>',
  event: '<rect x="4" y="4.5" width="16" height="16" rx="1.5"/><path d="M8 3v3m8-3v3M4 9h16m-12 4h3m-3 4h7"/>',
};

export function renderLaylaScheduleIcon(type) {
  const iconType = Object.hasOwn(scheduleIconPaths, type) ? type : "event";
  return `<svg class="schedule-item__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${scheduleIconPaths[iconType]}</svg>`;
}
