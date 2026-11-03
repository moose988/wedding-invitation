// Event music settings (platform admins only): Off, Default song, or a Custom song the customer provides.
// A custom song is decoded in the browser, encoded to MP3 (128 kbps) in a Web Worker, uploaded through a signed
// URL, and then musicMode, musicVersion and musicName are saved on the event.
import * as firebase from "./firebase-config.js";
import { skeleton } from "./skeleton.js";
import { runAction } from "./action-feedback.js";
import { esc } from "./admin-api.js";
import { projectionEqual, publicEventData } from "./event-publishing.js";
import { MUSIC_LIMITS, checkAudioFile, checkDuration, decodeAudio, encodeMp3, songNameFrom } from "./music-encoder.js";
import { previewSongUrl, removeSongFile, uploadAndCommitSong } from "./music-api.js";

export const MUSIC_COPY = Object.freeze({
  off: "No music. The invitation plays nothing and hides its music button.",
  default: "The standard event song that ships with the invitation.",
  custom: "A song the customer provides. It is converted to MP3 here before upload.",
});
const jobs = new Map(); // eventId -> in-flight job state, so a re-render never loses progress

// Converts and uploads a song. onStatus({ phase, value, message }) drives the progress bar. Resolves { name, blob }.
export async function convertAndUploadSong({ file, eventId, user, onStatus = () => {}, confirmBlob = null }) {
  const bad = checkAudioFile(file); if (bad) throw new Error(bad);
  onStatus({ phase: "reading", value: 0, message: "Reading the audio file…" });
  const buffer = await decodeAudio(file);
  const long = checkDuration(buffer.duration); if (long) throw new Error(long);
  const blob = await encodeMp3(buffer, { onProgress: value => onStatus({ phase: "converting", value, message: `Converting to MP3 · ${Math.round(value * 100)}%` }) });
  if (confirmBlob && !(await confirmBlob(blob))) return null;
  onStatus({ phase: "uploading", value: 0, message: "Uploading…" });
  await uploadAndCommitSong({ user, eventId, blob, onProgress: value => onStatus({ phase: "uploading", value, message: `Uploading · ${Math.round(value * 100)}%` }) });
  return { name: songNameFrom(file.name), blob };
}

// A music change is its own write holding only these four fields, never mixed with other settings. The public
// copy then carries the exact mode and version (musicName stays private on the event document).
export async function saveMusicFields(db, eventId, { musicMode, musicVersion, musicName }) {
  const eventRef = firebase.doc(db, "weddings", eventId);
  await firebase.updateDoc(eventRef, { musicMode, musicVersion, musicName, updatedAt: firebase.serverTimestamp() });
  try {
    const detailsRef = firebase.doc(db, "weddings", eventId, "publicEvent", "details");
    const [event, previous] = await Promise.all([firebase.getDoc(eventRef), firebase.getDoc(detailsRef)]);
    const data = publicEventData(event.data());
    if (!previous.exists() || !projectionEqual(previous.data(), data)) await firebase.setDoc(detailsRef, { ...data, updatedAt: firebase.serverTimestamp() });
  } catch (error) {
    throw new Error(`The setting was saved, but the invitation copy could not be updated (${error?.code || error?.message || "unknown problem"}). Save the setting again to retry.`);
  }
}

export function mountMusicSettings({ host, db, user, wedding, eventId, onChange = () => {} }) {
  if (!host) return;
  const state = { mode: ["off", "default", "custom"].includes(wedding.musicMode) ? wedding.musicMode : "default", version: Number.isInteger(wedding.musicVersion) ? wedding.musicVersion : 0, name: wedding.musicName || "", preview: null, pending: null };
  const job = () => jobs.get(eventId);
  const paint = () => {
    const j = job();
    host.innerHTML = `<header class="event-settings-section__header"><div><p class="da3wa-eyebrow">Invitation</p><h2>Music</h2><p>What plays when a guest opens the invitation.</p></div></header>
      <fieldset class="music-modes"><legend class="sr-only">Music</legend>${["off", "default", "custom"].map(m => `<label class="music-mode"><input type="radio" name="musicMode" value="${m}" ${state.mode === m ? "checked" : ""} ${j ? "disabled" : ""} /><span><strong>${{ off: "Off", default: "Default song", custom: "Custom song" }[m]}</strong><small>${esc(MUSIC_COPY[m])}</small></span></label>`).join("")}</fieldset>
      <p class="form-error" data-music-error role="alert"></p>
      ${state.mode === "custom" ? `<div class="music-custom">
        ${state.name ? `<p class="music-current">Current song: <strong>${esc(state.name)}</strong></p>` : `<p class="admin-note">No custom song uploaded yet. Until one is uploaded, the default song plays.</p>`}
        ${j ? `<div class="music-progress" role="status"><p>${esc(j.message)}</p><progress max="1" value="${j.value ?? 0}"></progress></div>` : ""}
        ${state.pending ? `<div class="music-review"><p>Converted and ready. Listen, then upload it.</p><audio controls src="${esc(state.pending.url)}"></audio><div class="admin-actions"><button class="primary-button" type="button" data-music-upload>Upload and use this song</button><button class="secondary-button" type="button" data-music-discard>Discard</button></div></div>` : ""}
        ${state.preview ? `<audio controls autoplay src="${esc(state.preview)}"></audio>` : ""}
        <div class="admin-actions"><label class="secondary-button music-file">${state.name ? "Replace song" : "Choose a song"}<input type="file" accept="audio/*" data-music-file hidden ${j ? "disabled" : ""} /></label>
          ${state.name ? `<button class="secondary-button" type="button" data-music-play>Play current song</button><button class="secondary-button danger-text" type="button" data-music-remove>Remove song</button>` : ""}</div>
        <p class="admin-note">Audio file up to 50 MB and ${MUSIC_LIMITS.maxSeconds / 60} minutes. The customer confirms they hold the rights to any music they provide.</p></div>` : ""}`;
  };
  const error = text => { host.querySelector("[data-music-error]").textContent = text; };

  host.addEventListener("change", async event => {
    const radio = event.target.closest('input[name="musicMode"]');
    if (radio) {
      const previous = state.mode; state.mode = radio.value; paint();
      await runAction(null, () => saveMusicFields(db, eventId, { musicMode: state.mode, musicVersion: state.version, musicName: state.name }), { what: "Saving the music setting", success: "Music setting saved.", onError: (e, m) => { state.mode = previous; paint(); error(m); } });
      onChange(state);
      return;
    }
    const input = event.target.closest("[data-music-file]"); if (!input?.files?.[0]) return;
    const file = input.files[0]; input.value = "";
    error(""); jobs.set(eventId, { message: "Starting…", value: 0 }); paint();
    const update = s => { jobs.set(eventId, { message: s.message, value: s.value }); if (host.isConnected) paint(); };
    try {
      const result = await convertAndUploadSong({ file, eventId, user, onStatus: update, confirmBlob: async blob => { state.pending = { url: URL.createObjectURL(blob), blob, file }; jobs.delete(eventId); paint(); return false; } });
      void result;
    } catch (failure) { jobs.delete(eventId); paint(); error(failure.message); }
  });
  host.addEventListener("click", async event => {
    const upload = event.target.closest("[data-music-upload]");
    if (upload && state.pending) {
      const { blob, file } = state.pending;
      await runAction(upload, async () => {
        jobs.set(eventId, { message: "Uploading…", value: 0 }); paint();
        await uploadAndCommitSong({ user, eventId, blob, onProgress: value => { jobs.set(eventId, { message: `Uploading · ${Math.round(value * 100)}%`, value }); paint(); } });
        state.version += 1; state.name = songNameFrom(file.name); state.mode = "custom";
        await saveMusicFields(db, eventId, { musicMode: "custom", musicVersion: state.version, musicName: state.name });
        URL.revokeObjectURL(state.pending.url); state.pending = null; state.preview = null;
      }, { busyLabel: "Uploading…", success: "Custom song saved. The invitation now plays it.", what: "Uploading the song", onError: (e, m) => { error(m); } });
      jobs.delete(eventId); paint(); onChange(state); return;
    }
    if (event.target.closest("[data-music-discard]") && state.pending) { URL.revokeObjectURL(state.pending.url); state.pending = null; paint(); return; }
    const play = event.target.closest("[data-music-play]");
    if (play) { await runAction(play, async () => { state.preview = await previewSongUrl(eventId); paint(); }, { what: "Loading the saved song", busyLabel: "Loading…" }); return; }
    const remove = event.target.closest("[data-music-remove]");
    if (remove) {
      if (!window.confirm("Remove the custom song? The invitation will play the default song.")) return;
      await runAction(remove, async () => {
        await removeSongFile(user, eventId);
        state.name = ""; state.version += 1; state.mode = "default"; state.preview = null;
        await saveMusicFields(db, eventId, { musicMode: "default", musicVersion: state.version, musicName: "" });
      }, { busyLabel: "Removing…", success: "Custom song removed. The default song plays.", what: "Removing the song", onError: (e, m) => error(m) });
      paint(); onChange(state);
    }
  });
  host.innerHTML = skeleton.lines(4, "Loading music settings…"); paint();
}
