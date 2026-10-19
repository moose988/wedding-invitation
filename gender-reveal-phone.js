export const GENDER_REVEAL_COUNTRIES = Object.freeze([
  ["AE", "United Arab Emirates", "971"], ["SA", "Saudi Arabia", "966"], ["QA", "Qatar", "974"],
  ["KW", "Kuwait", "965"], ["OM", "Oman", "968"], ["BH", "Bahrain", "973"], ["JO", "Jordan", "962"],
  ["LB", "Lebanon", "961"], ["EG", "Egypt", "20"], ["TR", "Türkiye", "90"], ["IN", "India", "91"],
  ["PK", "Pakistan", "92"], ["BD", "Bangladesh", "880"], ["LK", "Sri Lanka", "94"], ["NP", "Nepal", "977"],
  ["PH", "Philippines", "63"], ["ID", "Indonesia", "62"], ["MY", "Malaysia", "60"], ["SG", "Singapore", "65"],
  ["TH", "Thailand", "66"], ["CN", "China", "86"], ["HK", "Hong Kong", "852"], ["JP", "Japan", "81"],
  ["KR", "South Korea", "82"], ["AU", "Australia", "61"], ["NZ", "New Zealand", "64"], ["GB", "United Kingdom", "44"],
  ["IE", "Ireland", "353"], ["FR", "France", "33"], ["DE", "Germany", "49"], ["IT", "Italy", "39"],
  ["ES", "Spain", "34"], ["PT", "Portugal", "351"], ["NL", "Netherlands", "31"], ["CH", "Switzerland", "41"],
  ["SE", "Sweden", "46"], ["NO", "Norway", "47"], ["DK", "Denmark", "45"], ["FI", "Finland", "358"],
  ["GR", "Greece", "30"], ["RU", "Russia", "7"], ["UA", "Ukraine", "380"], ["US", "United States", "1"],
  ["CA", "Canada", "1"], ["MX", "Mexico", "52"], ["BR", "Brazil", "55"], ["AR", "Argentina", "54"],
  ["ZA", "South Africa", "27"], ["KE", "Kenya", "254"], ["NG", "Nigeria", "234"], ["GH", "Ghana", "233"],
  ["MA", "Morocco", "212"], ["TN", "Tunisia", "216"], ["AF", "Afghanistan", "93"], ["IQ", "Iraq", "964"],
  ["IR", "Iran", "98"], ["IL", "Israel", "972"], ["PS", "Palestine", "970"], ["YE", "Yemen", "967"],
  ["ET", "Ethiopia", "251"], ["TZ", "Tanzania", "255"], ["UG", "Uganda", "256"], ["MU", "Mauritius", "230"],
  ["CY", "Cyprus", "357"], ["AT", "Austria", "43"], ["BE", "Belgium", "32"], ["PL", "Poland", "48"],
  ["CZ", "Czechia", "420"], ["RO", "Romania", "40"], ["CO", "Colombia", "57"], ["CL", "Chile", "56"],
  ["PE", "Peru", "51"], ["VE", "Venezuela", "58"], ["JM", "Jamaica", "1876"], ["TT", "Trinidad and Tobago", "1868"],
]);

export function normalizeInternationalPhone(input, selectedCallingCode) {
  if (typeof input !== "string" || typeof selectedCallingCode !== "string") {
    throw new TypeError("Enter an international phone number.");
  }
  const raw = input.trim();
  if (!raw) throw new TypeError("Enter an international phone number.");
  const digits = raw.replace(/\D/g, "");
  let internationalDigits;
  if (raw.startsWith("+") || raw.startsWith("00")) {
    internationalDigits = raw.startsWith("00") ? digits.slice(2) : digits;
  } else {
    const code = selectedCallingCode.replace(/\D/g, "");
    if (!/^[1-9]\d{0,3}$/.test(code)) throw new TypeError("Choose a country calling code.");
    let national = digits.replace(/^0+/, "");
    if (national.startsWith(code) && national.length > code.length + 6) national = national.slice(code.length);
    internationalDigits = `${code}${national}`;
  }
  if (!/^[1-9]\d{7,14}$/.test(internationalDigits)) {
    throw new TypeError("Enter a valid phone number with 8 to 15 international digits.");
  }
  return `+${internationalDigits}`;
}
