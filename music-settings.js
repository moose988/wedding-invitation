// Event music settings (platform admins only): Off, Default song, or a Custom song the customer provides.
// A custom song is decoded in the browser, encoded to MP3 (128 kbps) in a Web Worker, uploaded through a signed
// URL, and then musicMode, musicVersion and musicName are saved on the event.
import * as firebase from "./firebase-config.js";
import { skeleton } from "./skeleton.js";
import { confirmAction, runAction, showToast } from "./action-feedback.js";
import { esc } from "./admin-api.js";
import { projectionEqual, publicEventData } from "./event-publishing.js?v=20261018-guest-invitation-regressions-2";
import { MUSIC_LIMITS, checkAudioFile, convertSongToMp3, songNameFrom } from "./music-encoder.js";
import { previewSongUrl, removeSongFile, uploadAndCommitSong } from "./music-api.js";

export const MUSIC_COPY = Object.freeze({
  off: "No music. The invitation plays nothing and hides its music button.",
  default: "The standard event song that ships with the invitation.",
  custom: "A song the customer provides. It is converted to MP3 here before upload.",
});
const jobs = new Map(); // eventId -> in-flight job state, so a re-render never loses progress
// The dashboard re-renders settings on every live update (an RSVP arriving, for example), which mounts a new panel.
// A converted song and the panel to update live here, per event, so a conversion finishing after a re-render lands
// in the panel on screen instead of the one that was replaced.
const conversions = new Map(); // eventId -> AbortController while the browser is converting
const pendings = new Map(); // eventId -> converted song awaiting "Upload and use this song"
const panels = new Map(); // eventId -> { paint, error } of the panel currently mounted

// Converts and uploads a song. onStatus({ phase, value, message }) drives the progress bar. Resolves { name, blob }.
export async function convertAndUploadSong({ file, eventId, user, onStatus = () => {}, confirmBlob = null, signal }) {
  const bad = checkAudioFile(file); if (bad) throw new Error(bad);
  onStatus({ phase: "reading", value: 0, message: "Reading the audio file…" });
  const blob = await convertSongToMp3(file, { signal, onProgress: value => onStatus({ phase: "converting", value, message: `Converting to MP3 · ${Math.round(value * 100)}%` }) });
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
  if (!host?.isConnected) return;
  const state = { mode: ["off", "default", "custom"].includes(wedding.musicMode) ? wedding.musicMode : "default", version: Number.isInteger(wedding.musicVersion) ? wedding.musicVersion : 0, name: wedding.musicName || "", preview: null };
  Object.defineProperty(state, "pending", { get: () => pendings.get(eventId) || null, set: value => { if (value) pendings.set(eventId, value); else pendings.delete(eventId); } });
  const job = () => jobs.get(eventId);
  const paint = () => {
    const j = job();
    host.innerHTML = `<header class="event-settings-section__header"><div><p class="da3wa-eyebrow">Invitation</p><h2>Music</h2><p>What plays when a guest opens the invitation.</p></div></header>
      <fieldset class="music-modes"><legend class="sr-only">Music</legend>${["off", "default", "custom"].map(m => `<label class="music-mode"><input type="radio" name="musicMode" value="${m}" ${state.mode === m ? "checked" : ""} ${j ? "disabled" : ""} /><span><strong>${{ off: "Off", default: "Default song", custom: "Custom song" }[m]}</strong><small>${esc(MUSIC_COPY[m])}</small></span></label>`).join("")}</fieldset>
      <p class="form-error" data-music-error role="alert"></p>
      ${state.mode === "custom" ? `<div class="music-custom">
        ${state.name ? `<p class="music-current">Current song: <strong>${esc(state.name)}</strong></p>` : `<p class="admin-note">No custom song uploaded yet. Until one is uploaded, the default song plays.</p>`}
        ${j ? `<div class="music-progress" role="status"><p>${esc(j.message)}</p><progress max="1" value="${j.value ?? 0}"></progress>${conversions.has(eventId) ? `<button class="secondary-button" type="button" data-music-cancel>Cancel conversion</button>` : ""}</div>` : ""}
        ${state.pending ? `<div class="music-review"><p>Converted and ready. Listen, then upload it.</p><audio controls src="${esc(state.pending.url)}"></audio><div class="admin-actions"><button class="primary-button" type="button" data-music-upload ${j ? "disabled" : ""}>Upload and use this song</button><button class="secondary-button" type="button" data-music-discard ${j ? "disabled" : ""}>Discard</button></div></div>` : ""}
        ${state.preview ? `<audio controls autoplay src="${esc(state.preview)}"></audio>` : ""}
        <div class="admin-actions"><label class="secondary-button music-file">${state.name ? "Replace song" : "Choose a song"}<input type="file" accept="audio/*" data-music-file hidden ${j ? "disabled" : ""} /></label>
          ${state.name ? `<button class="secondary-button" type="button" data-music-play ${j ? "disabled" : ""}>Play current song</button><button class="secondary-button danger-text" type="button" data-music-remove ${j ? "disabled" : ""}>Remove song</button>` : ""}</div>
        <p class="admin-note">Audio file up to 50 MB and ${MUSIC_LIMITS.maxSeconds / 60} minutes. The customer confirms they hold the rights to any music they provide.</p></div>` : ""}`;
  };
  const error = text => { const node = host.querySelector("[data-music-error]"); if (node) node.textContent = text; };
  const progress = ({ message, value }) => {
    const bar = host.querySelector(".music-progress progress");
    const status = host.querySelector(".music-progress p");
    if (bar && status) {
      if (status.textContent !== message) status.textContent = message;
      bar.value = value;
    }
  };
  panels.set(eventId, { paint, error, progress });
  const live = () => panels.get(eventId);
  const update = status => {
    jobs.set(eventId, status);
    live().progress(status);
  };

  const finishAction = (result, message) => {
    jobs.delete(eventId);
    live().paint();
    if (result.ok) onChange(state);
    else if (message) live().error(message);
  };

  host.addEventListener("change", async event => {
    const radio = event.target.closest('input[name="musicMode"]');
    if (radio) {
      if (job()) return;
      const previous = state.mode;
      state.mode = radio.value;
      jobs.set(eventId, { message: "Saving music setting…", value: 0 });
      paint();
      let failure = "";
      const result = await runAction(null, () => saveMusicFields(db, eventId, { musicMode: state.mode, musicVersion: state.version, musicName: state.name }), { what: "Saving the music setting", success: "Music setting saved.", onError: (_, message) => { failure = message; } });
      if (!result.ok) state.mode = previous;
      finishAction(result, failure);
      return;
    }
    const input = event.target.closest("[data-music-file]"); if (!input?.files?.[0] || job()) return;
    const file = input.files[0]; input.value = "";
    const controller = new AbortController();
    conversions.set(eventId, controller);
    const observer = new MutationObserver(() => {
      // A new settings panel replaces the old host on ordinary live redraws.
      if (!document.getElementById(host.id)) controller.abort();
    });
    observer.observe(host.closest("#pageContent") ?? host.parentNode, { childList: true, subtree: true });
    error(""); jobs.set(eventId, { message: "Starting…", value: 0 }); paint();
    try {
      await convertAndUploadSong({ file, eventId, user, signal: controller.signal, onStatus: update, confirmBlob: async blob => {
        if (state.pending) URL.revokeObjectURL(state.pending.url);
        state.pending = { url: URL.createObjectURL(blob), blob, name: songNameFrom(file.name) };
        return false;
      } });
    } catch (failure) {
      if (failure.name === "AbortError") {
        if (document.getElementById(host.id)) showToast("Song conversion cancelled.");
      } else {
        jobs.delete(eventId); live().paint(); live().error(failure.message);
        return;
      }
    } finally {
      observer.disconnect();
      conversions.delete(eventId);
      if (jobs.delete(eventId)) live().paint();
    }
  });
  host.addEventListener("click", async event => {
    const cancel = event.target.closest("[data-music-cancel]");
    if (cancel) {
      cancel.disabled = true;
      cancel.textContent = "Cancelling…";
      conversions.get(eventId)?.abort();
      return;
    }
    const upload = event.target.closest("[data-music-upload]");
    if (upload && state.pending && !job()) {
      const { blob, name } = state.pending;
      let failure = "";
      const result = await runAction(upload, async () => {
        jobs.set(eventId, { message: "Uploading…", value: 0 });
        live().paint();
        await uploadAndCommitSong({ user, eventId, blob, onProgress: value => update({ message: `Uploading · ${Math.round(value * 100)}%`, value }) });
        await saveMusicFields(db, eventId, { musicMode: "custom", musicVersion: state.version + 1, musicName: name });
        state.version += 1; state.name = name; state.mode = "custom";
        URL.revokeObjectURL(state.pending.url); state.pending = null; state.preview = null;
      }, { busyLabel: "Uploading…", success: "Custom song saved. The invitation now plays it.", what: "Uploading the song", onError: (_, message) => { failure = message; } });
      finishAction(result, failure);
      return;
    }
    if (event.target.closest("[data-music-discard]") && state.pending && !job()) { URL.revokeObjectURL(state.pending.url); state.pending = null; paint(); return; }
    const play = event.target.closest("[data-music-play]");
    if (play) {
      await runAction(play, async () => { state.preview = await previewSongUrl(eventId); paint(); }, { what: "Loading the saved song", busyLabel: "Loading…" });
      host.querySelector("audio[autoplay]")?.addEventListener("error", () => error("The saved song could not be played here. Check your connection and try again; if it keeps failing, upload the song again."), { once: true });
      return;
    }
    const remove = event.target.closest("[data-music-remove]");
    if (remove) {
      if (job() || !(await confirmAction({ title: "Remove the custom song?", message: "The invitation will play the default song.", confirmLabel: "Remove song", danger: true }))) return;
      if (job()) return;
      let failure = "";
      const result = await runAction(remove, async () => {
        jobs.set(eventId, { message: "Removing…", value: 0 });
        live().paint();
        await removeSongFile(user, eventId);
        await saveMusicFields(db, eventId, { musicMode: "default", musicVersion: state.version + 1, musicName: "" });
        state.name = ""; state.version += 1; state.mode = "default"; state.preview = null;
        if (state.pending) URL.revokeObjectURL(state.pending.url);
        state.pending = null;
      }, { busyLabel: "Removing…", success: "Custom song removed. The default song plays.", what: "Removing the song", onError: (_, message) => { failure = message; } });
      finishAction(result, failure);
    }
  });
  host.innerHTML = skeleton.lines(4, "Loading music settings…"); paint();
}
