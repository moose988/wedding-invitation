// Calls for an event's custom song, per briefs/bucket-api-contract.md (bucket API base, admin token):
//   POST   /events/:eventId/song/uploads  { size }       -> { uploadId, upload: { url, headers } }  (size 1 to 15 MB)
//   PUT    upload.url with exactly upload.headers (the MP3 bytes)
//   POST   /events/:eventId/song/commit   { uploadId }   -> { eventId, size, updatedAt }            (safe to repeat)
//   DELETE /events/:eventId/song                         -> 204
//   GET    /events/:eventId/song          (public)       -> { url, expiresAt, updatedAt, size }
//   DELETE /events/:eventId                              -> 204 (purges all of the event's stored files; call on event deletion)
import { API_URL } from "./photo-bucket/config.js";
import { explainFailure } from "./admin-api.js";

export const MAX_SONG_BYTES = 15 * 1024 * 1024;
const localPreview = () => typeof location !== "undefined" && ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
const base = () => localPreview() ? "/__photo_bucket_api" : API_URL;
// In local preview signed URLs go through the preview server, as photos do.
export const storageUrl = url => localPreview() ? `/__photo_bucket_storage?url=${encodeURIComponent(url)}` : url;
const eventPath = id => `/events/${encodeURIComponent(id)}`;
const fail = (status, data, what) => Object.assign(new Error(explainFailure({ status, code: data?.code || "", message: data?.error || "", what })), { status, code: data?.code || "" });

async function call(user, method, path, body, what, fetchImpl = globalThis.fetch) {
  if (!base()) throw Object.assign(new Error("Server setup is incomplete: the song service address is not set. Contact an admin."), { status: 503 });
  let response;
  try { response = await fetchImpl(base() + path, { method, headers: { authorization: `Bearer ${await user.getIdToken()}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw fail(0, null, what); }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok || data === null) throw fail(response.ok ? 404 : response.status, data, what);
  return data;
}
export const requestSongUpload = (user, eventId, size, fetchImpl) => {
  if (!(size >= 1 && size <= MAX_SONG_BYTES)) return Promise.reject(new Error("The converted song is larger than 15 MB. Choose a shorter song."));
  return call(user, "POST", `${eventPath(eventId)}/song/uploads`, { size }, "Preparing the song upload", fetchImpl);
};
export const commitSong = (user, eventId, uploadId, fetchImpl) => call(user, "POST", `${eventPath(eventId)}/song/commit`, { uploadId }, "Saving the uploaded song", fetchImpl);
export const removeSongFile = (user, eventId, fetchImpl) => call(user, "DELETE", `${eventPath(eventId)}/song`, null, "Removing the song", fetchImpl);
export const removeEventFiles = (user, eventId, fetchImpl) => !base() ? Promise.resolve(null) /* no bucket service configured (local demo): nothing is stored there */ : call(user, "DELETE", eventPath(eventId), null, "Removing the event's stored files", fetchImpl);
export const previewSongUrl = async (eventId, fetchImpl = globalThis.fetch) => {
  const r = await fetchImpl(base() + `${eventPath(eventId)}/song`).catch(() => null);
  if (!r?.ok) throw fail(r?.status || 0, null, "Loading the saved song");
  return storageUrl((await r.json()).url);
};

// PUT with progress (fetch cannot report upload progress). Sends exactly the headers the server signed.
export function putSong(url, headers, blob, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); xhr.open("PUT", storageUrl(url));
    for (const [k, v] of Object.entries(headers || {})) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(xhr.status === 403 ? "The upload was refused (the link may have expired). Try again." : `The upload failed (${xhr.status}). Try again.`));
    xhr.onerror = () => reject(new Error("The upload could not reach the server. Check your internet connection and try again."));
    xhr.send(blob);
  });
}

// Upload, then commit. Commit is safe to repeat, so a failed commit is retried once before an error is shown.
export async function uploadAndCommitSong({ user, eventId, blob, onProgress = () => {} }) {
  const grant = await requestSongUpload(user, eventId, blob.size);
  await putSong(grant.upload.url, grant.upload.headers, blob, onProgress);
  try { return await commitSong(user, eventId, grant.uploadId); } catch { return commitSong(user, eventId, grant.uploadId); }
}
