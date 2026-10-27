import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { renderLaylaScheduleIcon, resolveLaylaScheduleIcon } from "../invitations/wedding-designs/layla-zaid/schedule-icons.js";

test("explicit Layla schedule event types resolve before title labels", () => {
  assert.equal(resolveLaylaScheduleIcon({ eventType: "wedding_ceremony", titleEn: "Dinner" }), "ceremony");
  assert.equal(resolveLaylaScheduleIcon({ type: "welcome_reception" }), "reception");
  assert.equal(resolveLaylaScheduleIcon({ kind: "dining" }), "dinner");
  assert.equal(resolveLaylaScheduleIcon({ category: "celebration" }), "celebration");
});

test("English and Arabic schedule labels resolve to matching event icons", () => {
  const cases = [
    ["Guest arrival", "وصول الضيوف", "arrival"],
    ["Welcome reception", "حفل استقبال", "reception"],
    ["Wedding ceremony", "مراسم عقد القران", "ceremony"],
    ["Dinner", "العشاء", "dinner"],
    ["Celebration and dancing", "الاحتفال والرقص", "celebration"],
  ];
  for (const [en, ar, expected] of cases) {
    assert.equal(resolveLaylaScheduleIcon({ titleEn: en }), expected, en);
    assert.equal(resolveLaylaScheduleIcon({ titleAr: ar }), expected, ar);
  }
});

test("unrecognized schedule events use a semantic, decorative neutral icon", () => {
  const type = resolveLaylaScheduleIcon({ eventType: "unknown", titleEn: "A special toast" });
  assert.equal(type, "event");
  const svg = renderLaylaScheduleIcon(type);
  assert.match(svg, /aria-hidden="true"/);
  assert.match(svg, /focusable="false"/);
  assert.match(svg, /fill="none"/);
  assert.match(svg, /stroke="currentColor"/);
  assert.doesNotMatch(svg, /role="img"|emoji/i);
});

test("schedule renderer retains dynamic accessible times, custom headings and live layout", async () => {
  const script = await readFile(new URL("../script.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../invitations/wedding-designs/layla-zaid/styles.css", import.meta.url), "utf8");
  assert.match(script, /Array\.isArray\(state\.wedding\?\.schedule\)/);
  assert.match(script, /<bdi dir="auto">\$\{escapeHtml\(time\)\}<\/bdi>/);
  assert.match(script, /wedding\[`\$\{key\}\$\{arabic \? "Ar" : "En"\}`\] \|\| wedding\[key\]/);
  assert.match(script, /updateLaylaScheduleConnector\(mount\)/);
  assert.match(styles, /grid-template-columns: var\(--schedule-time-column\) 28px minmax\(0, 1fr\)/);
  assert.match(styles, /min-height: 56px/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(styles, /--schedule-line-start/);
  assert.match(styles, /--schedule-line-end/);
});
