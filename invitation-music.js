// Which music an invitation plays. musicMode is "off", "default" or "custom". Anything else (or no value, for
// events made before this setting existed) means "default", so old invitations keep their song.
import { API_URL } from "./photo-bucket/config.js";

export const MUSIC_MODES = Object.freeze(["off", "default", "custom"]);
export const DEFAULT_SONG = { src: "./music/wedding.m4a", type: "audio/mp4" };
export const musicModeOf = wedding => MUSIC_MODES.includes(wedding?.musicMode) ? wedding.musicMode : "default";

// Public route (no sign-in): GET {api}/events/:eventId/song returns { url, ... } for the custom song.
export const publicMusicPath = (eventId, version) => `/events/${encodeURIComponent(eventId)}/song${Number.isInteger(version) ? `?v=${version}` : ""}`;
// Signed song links last 15 minutes; refresh well before that.
export const SONG_URL_MAX_AGE_MS = 10 * 60 * 1000;
export const musicKey = wedding => `${wedding?.id || ""}:${musicModeOf(wedding)}:${Number.isInteger(wedding?.musicVersion) ? wedding.musicVersion : 0}`;
const localPreview = () => typeof location !== "undefined" && ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
const apiBase = () => (typeof location !== "undefined" && ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) ? "/__photo_bucket_api" : API_URL;

// Returns { mode, src, type, fallback }. For "off" there is no source. For "custom" the signed URL is fetched;
// if that fails the default song is used and fallback is true (the page may also fall back later if the audio itself fails).
export async function resolveMusic(wedding, { fetchImpl = globalThis.fetch, base = apiBase() } = {}) {
  const mode = musicModeOf(wedding);
  if (mode === "off") return { mode, src: "", type: "", fallback: false };
  if (mode === "default" || !wedding?.id || !base) return { mode: "default", ...DEFAULT_SONG, fallback: mode === "custom" };
  try {
    const version = Number.isInteger(wedding.musicVersion) ? wedding.musicVersion : 0;
    // ?v= changes on every replace, so a cached answer never points at a purged file.
    const response = await fetchImpl(`${base}${publicMusicPath(wedding.id, version)}`, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(String(response.status));
    const { url } = await response.json();
    // https only, except the local emulator backend's own loopback links while previewing on this machine.
    const loopbackLink = localPreview() && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);
    if (typeof url !== "string" || !(/^https:\/\/|^\//.test(url) || loopbackLink)) throw new Error("bad url");
    return { mode, src: localPreview() ? `/__photo_bucket_storage?url=${encodeURIComponent(url)}` : url, type: "audio/mpeg", fallback: false, resolvedAt: Date.now() };
  } catch { return { mode: "default", ...DEFAULT_SONG, fallback: true }; /* custom song unavailable: the default plays instead */ }
}
