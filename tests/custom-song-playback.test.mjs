import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { musicKey, publicMusicPath, resolveMusic, SONG_URL_MAX_AGE_MS } from "../invitation-music.js";
import { cspAllowsHost } from "../scripts/post-deploy-check.mjs";

const cspOf = async (file) => {
  const text = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  return [...text.matchAll(/"value":\s*"(default-src[^"]+)"/g)].map((m) => m[1]);
};

test("both hosting configs let custom songs play from S3 in eu-north-1", async () => {
  for (const file of ["vercel.json", "firebase.json"]) {
    const policies = await cspOf(file);
    assert.ok(policies.length, `${file} has a CSP`);
    for (const csp of policies) {
      assert.ok(cspAllowsHost(csp, "https://pbs-shared-843968571498-eu-north-1.s3.eu-north-1.amazonaws.com", "media-src"), `${file} media-src`);
      assert.equal(cspAllowsHost(csp, "https://evil.example", "media-src"), false);
    }
  }
});

test("the song lookup is versioned, so a replaced song is never served from cache", async () => {
  assert.equal(publicMusicPath("evt-1", 3), "/events/evt-1/song?v=3");
  const seen = [];
  const fetchImpl = async (url) => { seen.push(url); return { ok: true, json: async () => ({ url: "https://pbs.s3.eu-north-1.amazonaws.com/a.mp3?sig" }) }; };
  const plan = await resolveMusic({ id: "evt-1", musicMode: "custom", musicVersion: 4 }, { fetchImpl, base: "https://api.example" });
  assert.equal(seen[0], "https://api.example/events/evt-1/song?v=4");
  assert.equal(plan.mode, "custom"); assert.ok(plan.resolvedAt > 0);
  assert.notEqual(musicKey({ id: "e", musicMode: "custom", musicVersion: 1 }), musicKey({ id: "e", musicMode: "custom", musicVersion: 2 }));
  assert.ok(SONG_URL_MAX_AGE_MS < 15 * 60 * 1000, "refreshed before the 15 minute link expires");
});

test("a failed custom song falls back to the default; off plays nothing", async () => {
  const failing = async () => ({ ok: false, status: 404 });
  const plan = await resolveMusic({ id: "evt-1", musicMode: "custom", musicVersion: 1 }, { fetchImpl: failing, base: "https://api.example" });
  assert.equal(plan.fallback, true); assert.match(plan.src, /wedding\.m4a/);
  assert.equal((await resolveMusic({ id: "evt-1", musicMode: "off" })).src, "");
});

test("the invitation listens for source errors (capture) and refreshes the link before it expires", async () => {
  const script = await readFile(new URL("../script.js", import.meta.url), "utf8");
  assert.match(script, /source\.addEventListener\("error"/, "fallback listens on the <source> element");
  assert.match(script, /}, true\);/, "the audio error listener uses capture");
  assert.match(script, /function scheduleSongRefresh/);
  assert.match(script, /state\.musicKey === key/, "unchanged settings do not reload the song");
});
