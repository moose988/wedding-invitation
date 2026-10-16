import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("sender progress stores only guest indexes in session storage", async () => {
  const source = await readFile(new URL("../send.js", import.meta.url), "utf8");
  assert.match(source, /sessionStorage\.getItem\(sentStorageKey\)/);
  assert.match(source, /sessionStorage\.setItem\(sentStorageKey/);
  assert.match(source, /function guestKey\(_guest, index\)[\s\S]*?return `guest-\$\{index\}`/);
  assert.match(source, /localStorage\.removeItem\(`da3wa:senderSent:\$\{payload\.w\}`\)/);
  assert.doesNotMatch(source, /localStorage\.(?:getItem|setItem)\(sentStorageKey/);
});
