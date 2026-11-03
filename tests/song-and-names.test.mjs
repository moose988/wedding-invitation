import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";
import { MUSIC_LIMITS, checkAudioFile, checkDuration, songNameFrom } from "../music-encoder.js";
import { resolveMusic, musicModeOf, DEFAULT_SONG } from "../invitation-music.js";
import { DEFAULT_TERMS, MUSIC_RIGHTS_TERM } from "../admin-money.js";
import { publicEventData, publicEventFields } from "../event-publishing.js";

const read = f => readFile(new URL(`../${f}`, import.meta.url), "utf8");

test("lamejs is vendored unmodified with its licence notice, not added as a dependency", async () => {
  const bytes = await readFile(new URL("../vendor/lame.min.js", import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "15d285e2587b3bdbfd18a68de6ce07cc074f7480a82c3815da2dc1c348ec6df4");
  const notices = await read("vendor/THIRD-PARTY-NOTICES.md");
  assert.match(notices, /lamejs 1\.2\.1/); assert.match(notices, /LGPL-3\.0/); assert.match(notices, /unmodified/i);
  assert.doesNotMatch(await read("package.json"), /lamejs/);
  const worker = await read("music-worker.js"); assert.match(worker, /importScripts\("\/vendor\/lame\.min\.js"\)/); assert.match(await read("music-encoder.js"), /new Worker\(workerUrl\)/);
});

test("song limits: audio only, 50 MB, 10 minutes, 128 kbps", () => {
  assert.equal(MUSIC_LIMITS.kbps, 128);
  assert.match(checkAudioFile({ type: "image/png", size: 5 }), /not audio/); assert.match(checkAudioFile({ type: "audio/mpeg", size: 51 * 1024 * 1024 }), /50 MB/);
  assert.equal(checkAudioFile({ type: "audio/mpeg", size: 1000 }), ""); assert.match(checkDuration(601), /10 minutes/); assert.equal(checkDuration(600), "");
  assert.equal(songNameFrom("Our Song.final.mp3"), "Our Song.final"); assert.equal(songNameFrom("x".repeat(200) + ".mp3").length, 80);
});

test("the invitation obeys musicMode: off plays nothing, default keeps the song, custom falls back only on failure", async () => {
  assert.equal(musicModeOf({}), "default"); assert.equal(musicModeOf({ musicMode: "weird" }), "default");
  assert.deepEqual(await resolveMusic({ id: "e", musicMode: "off" }), { mode: "off", src: "", type: "", fallback: false });
  assert.equal((await resolveMusic({ id: "e", musicMode: "default" })).src, DEFAULT_SONG.src); assert.equal(DEFAULT_SONG.src, "./music/wedding.m4a");
  const ok = await resolveMusic({ id: "e1", musicMode: "custom" }, { base: "/api", fetchImpl: async url => { assert.match(url, /\/api\/events\/e1\/song\?v=0$/); return { ok: true, json: async () => ({ url: "https://s3.example/song.mp3?sig=1" }) }; } });
  assert.equal(ok.src, "https://s3.example/song.mp3?sig=1"); assert.equal(ok.type, "audio/mpeg"); assert.equal(ok.fallback, false);
  for (const bad of [async () => ({ ok: false, status: 500 }), async () => { throw new Error("net"); }, async () => ({ ok: true, json: async () => ({ url: "javascript:alert(1)" }) })]) {
    const r = await resolveMusic({ id: "e1", musicMode: "custom" }, { base: "/api", fetchImpl: bad }); assert.equal(r.src, DEFAULT_SONG.src); assert.equal(r.fallback, true);
  }
  const script = await read("script.js");
  assert.match(script, /state\.musicOff/); assert.match(script, /elements\.musicToggle\.hidden = state\.musicOff === true/); assert.match(script, /resolveMusic\(wedding\)/);
});

test("public projection carries musicMode and musicVersion but never musicName", () => {
  assert.ok(publicEventFields.includes("musicMode") && publicEventFields.includes("musicVersion")); assert.ok(!publicEventFields.includes("musicName"));
  const d = publicEventData({ eventCategory: "wedding_engagement", musicMode: "custom", musicVersion: 3, musicName: "Secret title" });
  assert.equal(d.musicMode, "custom"); assert.equal(d.musicVersion, 3); assert.ok(!("musicName" in d));
  assert.equal(publicEventData({ eventCategory: "wedding_engagement" }).musicMode, "default", "old events keep the default song");
});

test("admin music UI: three modes, replace, remove, preview, progress; saved as its own write; version up by exactly one", async () => {
  const s = await read("music-settings.js"), d = await read("dashboard.js"), w = await read("weddings.js");
  for (const part of [/Off/, /Default song/, /Custom song/, /data-music-remove/, /data-music-play/, /Replace song/, /<progress/, /accept="audio\/\*"/, /runAction/]) assert.match(s, part);
  assert.match(s, /\{ musicMode, musicVersion, musicName, updatedAt: firebase\.serverTimestamp\(\) \}/);
  assert.match(s, /state\.version \+= 1; state\.name = songNameFrom/); assert.doesNotMatch(s, /grant\.version/);
  assert.match(s, /publicEventData\(event\.data\(\)\)/);
  assert.match(d, /id="musicPanel"/); assert.match(d, /state\.isAdmin === true && !genderReveal/); assert.match(w, /name="musicModeCreate"|musicModeCreate/);
});

test("uploader names: create switch (default on), bucket settings, optional remembered guest name, owner sees names only when sent", async () => {
  const [app, html, adapter, wd] = await Promise.all(["photo-bucket/app.js", "all-events.html", "photo-bucket/adapter-api.js", "weddings.js"].map(read));
  assert.match(html, /name="bucketShowNames" checked/); assert.match(wd, /showUploaderNames: f\.bucketShowNames\.checked/);
  assert.match(adapter, /showUploaderNames: input\?\.showUploaderNames !== false/); assert.match(adapter, /showUploaderNames: info\.showUploaderNames === true/);
  assert.match(app, /bucket\.showUploaderNames \? `<label class="pb-name-field">Your name \(optional\)/); assert.match(app, /photo-bucket:uploader-name:\$\{bucket\?\.id\}/);
  assert.match(app, /enqueue\(bucket\.id, file, bucket\.showUploaderNames \? currentName\(\) : ''\)/); assert.match(app, /owner \? \(photo\.name \|\| ''\)/);
  assert.match(app, /name="showUploaderNames" type="checkbox"/); assert.match(app, /bucket\.canAdmin \?/); assert.match(app, /filterAllowed\(\)/); assert.doesNotMatch(app + adapter, /showNames/);
  assert.match(adapter, /body: \{ name: saved \}/);
});

test("quotation terms carry the music rights sentence", () => {
  assert.equal(MUSIC_RIGHTS_TERM, "The customer confirms they hold the rights to any music they provide.");
  assert.match(DEFAULT_TERMS, /The customer confirms they hold the rights to any music they provide\./);
  assert.ok(DEFAULT_TERMS.startsWith("Photo buckets are deleted 48 hours after the event."));
});

test("song routes follow the contract: uploads, PUT, commit, delete, public get, and event deletion purges files", async () => {
  const api = await read("music-api.js"), w = await read("weddings.js");
  for (const part of [/\/song\/uploads/, /\/song\/commit/, /`\$\{eventPath\(eventId\)\}\/song`/, /DELETE", eventPath\(eventId\)/, /upload\.url, grant\.upload\.headers/, /15 \* 1024 \* 1024/]) assert.match(api, part);
  assert.doesNotMatch(api + await read("invitation-music.js"), /\/e\/\$\{|\/music\/upload|\/music`/);
  assert.match(w, /removeEventFiles\(state\.user, weddingId\)\)\.then\(\(\) => null, \(error\) => error\)/); assert.match(w, /stored files were NOT removed/);
  const calls = []; const user = { getIdToken: async () => "t" };
  const { requestSongUpload, commitSong, removeSongFile, removeEventFiles } = await import("../music-api.js");
  const fakeFetch = async (url, init) => { calls.push([init.method, url]); return { status: 204, ok: true }; };
  globalThis.location = { hostname: "x.example" };
  await commitSong(user, "e/1", "u1", async (url, init) => { calls.push([init.method, url, init.body]); return { ok: true, status: 200, json: async () => ({}) }; });
  assert.match(calls[0][1], /\/events\/e%2F1\/song\/commit$/); assert.equal(calls[0][2], '{"uploadId":"u1"}');
  assert.equal((await requestSongUpload(user, "e", 16 * 1024 * 1024).catch(e => e)).message.includes("15 MB"), true);
  void removeSongFile; void removeEventFiles; void fakeFetch;
});

test("licence texts for lamejs are bundled next to the library", async () => {
  assert.match(await read("vendor/LGPL-3.0.txt"), /GNU LESSER GENERAL PUBLIC LICENSE\s+Version 3/);
  assert.match(await read("vendor/GPL-3.0.txt"), /GNU GENERAL PUBLIC LICENSE\s+Version 3/);
  assert.match(await read("vendor/THIRD-PARTY-NOTICES.md"), /LGPL-3\.0\.txt/);
});
