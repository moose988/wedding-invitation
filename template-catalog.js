// The invitation templates customers can browse on templates.html, and that
// platform admins can hide from that page. Every entry opens its built-in
// sample, so a customer sees it exactly as a guest would.
//
// Hiding is stored in siteSettings/templateShowcase (hidden: [ids]). It only
// affects the customer page; admins still see and can choose every template.

export const SHOWCASE_SETTINGS_PATH = ["siteSettings", "templateShowcase"];

export const SHOWCASE_CATEGORIES = Object.freeze([
  Object.freeze({ id: "wedding", name: { en: "Weddings & engagements", ar: "الأعراس والخطوبة" }, short: { en: "Weddings", ar: "أعراس" } }),
  Object.freeze({ id: "gender_reveal", name: { en: "Gender reveals", ar: "حفلات معرفة الجنس" }, short: { en: "Gender reveal", ar: "معرفة الجنس" } }),
  Object.freeze({ id: "celebration", name: { en: "Birthdays & celebrations", ar: "أعياد الميلاد والاحتفالات" }, short: { en: "Birthdays", ar: "أعياد ميلاد" } })
]);

const WEDDING_SAMPLE = "?sample=1&wedding=luxury-wedding-demo";
const wedding = id => `./invitations/wedding-designs/${id}/index.html${WEDDING_SAMPLE}`;

export const SHOWCASE_TEMPLATES = Object.freeze([
  {
    id: "layla-zaid", category: "wedding", name: { en: "Floral Wedding", ar: "الزهور" },
    thumb: "./invitations/wedding-designs/layla-zaid/assets/layla-zaid-sculpted-floral-cover.webp",
    blurb: { en: "An envelope opens into sculpted ivory florals.", ar: "ظرفٌ يُفتح على زهورٍ عاجيةٍ منحوتة." },
    url: wedding("layla-zaid")
  },
  {
    id: "moonlit-conservatory", category: "wedding", name: { en: "Moonlit Conservatory", ar: "حديقة القمر" },
    thumb: "./invitations/wedding-designs/moonlit-conservatory/assets/thumbnail.webp",
    blurb: { en: "A cinematic moonlit garden and a record player.", ar: "حديقةٌ تحت ضوء القمر ومشغّل أسطوانات." },
    url: wedding("moonlit-conservatory")
  },
  {
    id: "pomegranate-courtyard", category: "wedding", name: { en: "Pomegranate Courtyard", ar: "فناء الرمّان" },
    thumb: "./invitations/wedding-designs/pomegranate-courtyard/assets/thumbnail.webp",
    blurb: { en: "Scratch a copper-foiled card to open a candlelit courtyard.", ar: "اكشط بطاقةً نحاسية لتنفتح على فناءٍ مضاءٍ بالشموع." },
    url: wedding("pomegranate-courtyard")
  },
  {
    id: "mandoos", category: "wedding", name: { en: "Mandoos", ar: "المندوس" },
    thumb: "./invitations/wedding-designs/mandoos/assets/thumbnail.webp",
    blurb: { en: "Trace a string of pearls to unlock the bride's chest.", ar: "تتبّع خيط اللؤلؤ لتفتح مندوس العروس." },
    url: wedding("mandoos")
  },
  {
    id: "yasmine", category: "wedding", name: { en: "Yasmine", ar: "ياسمين" },
    thumb: "./invitations/wedding-designs/yasmine/assets/thumbnail.webp",
    blurb: { en: "Stitch a tatreez star, then rise to a jasmine terrace.", ar: "اطرز نجمة التطريز لتصعد إلى شرفة الياسمين." },
    url: wedding("yasmine")
  },
  {
    id: "shiraa", category: "wedding", name: { en: "Shiraa", ar: "شراع" },
    thumb: "./invitations/wedding-designs/shiraa/assets/thumbnail.webp",
    blurb: { en: "Lift the veil to find the couple by the sea.", ar: "ارفع الطرحة لترى العروسين على البحر." },
    url: wedding("shiraa")
  },
  {
    id: "petit-nuage", category: "gender_reveal", name: { en: "Petit Nuage", ar: "الغيمة الصغيرة" },
    thumb: "./invitations/gender-reveal-designs/petit-nuage/assets/thumbnail.webp",
    blurb: { en: "Hold the pearl balloon until it pops, then guess boy or girl.", ar: "اضغط على البالون حتى ينفجر، ثم خمّن ولد أم بنت." },
    url: "./invitations/gender-reveal-designs/petit-nuage/index.html?sample=1"
  },
  {
    id: "ember", category: "celebration", name: { en: "Ember", ar: "الجمرة" },
    thumb: "./invitations/wedding-designs/ember/assets/thumbnail.webp",
    blurb: { en: "Strike a match to light the candles and watch the age roll up.", ar: "أشعل عود الثقاب لتضيء الشموع ويظهر العمر." },
    url: wedding("ember")
  }
].map(Object.freeze));

export const SHOWCASE_IDS = SHOWCASE_TEMPLATES.map(t => t.id);

// Keep only ids we know and digits for the phone number, whatever the stored doc holds.
export function normalizeShowcaseSettings(data = {}) {
  const hidden = Array.isArray(data.hidden) ? data.hidden.filter(id => SHOWCASE_IDS.includes(id)) : [];
  const whatsapp = typeof data.whatsapp === "string" ? data.whatsapp.replace(/\D/g, "").slice(0, 15) : "";
  return { hidden: [...new Set(hidden)], whatsapp };
}

export function visibleTemplates(settings, category = "") {
  const { hidden } = normalizeShowcaseSettings(settings);
  return SHOWCASE_TEMPLATES.filter(t => !hidden.includes(t.id) && (!category || t.category === category));
}

export function showcaseLink(base, category = "") {
  const url = new URL("./templates.html", base);
  if (SHOWCASE_CATEGORIES.some(c => c.id === category)) url.searchParams.set("event", category);
  return url.href;
}

export function whatsappLink(number, templateName) {
  const digits = String(number || "").replace(/\D/g, "");
  if (!digits) return "";
  const text = `Hello QD Systems, I'd like the "${templateName}" invitation template.`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
