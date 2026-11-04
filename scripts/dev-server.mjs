import { createServer } from "node:http";
import { Readable } from "node:stream";
import { API_URL as photoBucketApiUrl } from "../photo-bucket/config.js";
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { OBJECT_ROUTE, bucketApiTarget, createEmulatorBucketBackend, isLoopback } from "./local-bucket-backend.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const emulatorMode = process.argv.includes("--emulator");
const host = "127.0.0.1";
const port = Number(process.env.PORT || 5173);
const deployment = JSON.parse(await readFile(path.join(root, "vercel.json"), "utf8"));
const pageRoutes = new Map(deployment.rewrites.map(({ source, destination }) => [source, destination]));
const privateRoots = new Set(["api", "backend", "docs", "functions", "node_modules", "scripts", "server", "tests", "package.json", "package-lock.json"]);
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"], [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"], [".svg", "image/svg+xml"],
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
  [".webp", "image/webp"], [".gif", "image/gif"], [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"], [".mp4", "video/mp4"], [".m4a", "audio/mp4"], [".webm", "video/webm"],
  [".ico", "image/x-icon"],
]);

const bannerScript = `(() => {
  if (location.pathname.split('/').pop().startsWith('photo-bucket')) return;
  const localHost = location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.hostname === "[::1]";
  const params = new URLSearchParams(location.search);
  if (localHost && params.get("live") === "1") {
    sessionStorage.removeItem("wedding:localEmulators");
    params.delete("live");
    history.replaceState(null, "", location.pathname + (params.size ? "?" + params.toString() : "") + location.hash);
  }
  const emulator = localHost
    ? (params.get("emulator") === "1" || sessionStorage.getItem("wedding:localEmulators") === "1")
    : false;
  if (emulator && params.get("emulator") === "1") sessionStorage.setItem("wedding:localEmulators", "1");
  const bar = document.createElement("aside");
  bar.setAttribute("role", "status");
  bar.style.cssText = "position:sticky;top:0;z-index:2147483000;display:flex;justify-content:center;gap:.6rem;align-items:center;padding:.65rem 1rem;text-align:center;font:600 14px/1.4 system-ui,sans-serif;color:#fff;background:" + (emulator ? "#24554a" : "#9b3329");
  const message = document.createElement("span");
  message.textContent = emulator ? "SAFE EMULATOR MODE · Auth and Firestore use local demo data." : "LIVE FIREBASE · Saves on this preview change live event data.";
  const link = document.createElement("a");
  if (emulator) { params.delete("emulator"); params.set("live", "1"); } else params.set("emulator", "1");
  link.href = location.pathname + (params.size ? "?" + params.toString() : "") + location.hash;
  link.textContent = emulator ? "Switch to live data" : "Switch to emulator";
  link.style.cssText = "color:inherit;text-decoration:underline;white-space:nowrap";
  bar.append(message, link);
  document.body.prepend(bar);
})();`;

function injectBanner(html) {
  const scriptTag = '<script src="/dev-banner.js" defer></script>';
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${scriptTag}</head>`) : `${scriptTag}${html}`;
}

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(body);
}

// Local-only proxy for the online Photo Bucket API and its signed S3 URLs.
// It avoids changing production CORS and never forwards browser cookies.
async function proxyPhotoBucket(req, res, requestUrl) {
  if (emulatorMode) return send(res, 500, "Refusing to proxy to a real Photo Bucket API in emulator mode"); // never reached; second guard
  const origin = req.headers.origin;
  if ((origin && origin !== `http://${host}:${port}`) || req.headers["sec-fetch-site"] === "cross-site") return send(res, 403, "Forbidden");
  let target;
  if (requestUrl.pathname.startsWith("/__photo_bucket_api/")) {
    if (!["GET", "POST", "PATCH", "DELETE"].includes(req.method)) return send(res, 405, "Method Not Allowed");
    if (!photoBucketApiUrl) return send(res, 503, "Photo Bucket API is not configured");
    const apiOrigin = new URL(photoBucketApiUrl);
    target = new URL(requestUrl.pathname.slice("/__photo_bucket_api".length) + requestUrl.search, apiOrigin);
    if (target.origin !== apiOrigin.origin) return send(res, 403, "Invalid API host");
  } else {
    if (!["GET", "PUT"].includes(req.method)) return send(res, 405, "Method Not Allowed");
    try { target = new URL(requestUrl.searchParams.get("url")); } catch { return send(res, 400, "Invalid storage URL"); }
    if (target.protocol !== "https:" || !/^pb-[a-z0-9.-]+\.s3[.-][a-z0-9-]+\.amazonaws\.com$/i.test(target.hostname) || target.username || target.password || target.port) return send(res, 403, "Invalid storage host");
  }
  const headers = {};
  for (const name of ["authorization", "content-type", "x-amz-checksum-sha256", "x-amz-server-side-encryption"]) if (req.headers[name]) headers[name] = req.headers[name];
  try {
    const options = { method: req.method, headers, redirect: "error" };
    if (["POST", "PATCH", "PUT"].includes(req.method)) { options.body = Readable.toWeb(req); options.duplex = "half"; }
    const upstream = await fetch(target, options);
    const responseHeaders = { "Cache-Control": "no-store" };
    for (const name of ["content-type", "etag"]) if (upstream.headers.has(name)) responseHeaders[name] = upstream.headers.get(name);
    res.writeHead(upstream.status, responseHeaders);
    if (upstream.body) Readable.fromWeb(upstream.body).pipe(res); else res.end();
  } catch { if (!res.headersSent) send(res, 502, "Photo Bucket service unavailable"); else res.destroy(); }
}

// Emulator mode only: run the admin functions in api/ against the local emulators,
// so demo creation and customer linking can be tried without Vercel.
async function localApi(req, res, name) {
  const file = path.join(root, "api", `${name}.js`);
  try { await access(file, constants.R_OK); } catch { return send(res, 404, "Not Found"); }
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 65536) return send(res, 413, "Payload Too Large"); chunks.push(chunk); }
  const text = Buffer.concat(chunks).toString("utf8");
  let body = {}, invalid = false;
  if (text) { try { body = JSON.parse(text); } catch { invalid = true; } }
  Object.defineProperty(req, "body", { get() { if (invalid) throw new SyntaxError("Invalid JSON"); return body; } });
  const shim = Object.assign(res, {
    status(code) { res.statusCode = code; return shim; },
    json(value) { if (!res.headersSent) res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(value)); return shim; },
  });
  try { await (await import(pathToFileURL(file).href)).default(req, shim); }
  catch (error) { console.error(`Local api/${name} failed:`, error?.code || error?.name); if (!res.headersSent) send(res, 500, "Internal Server Error"); }
}

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${host}:${port}`);
  const apiMatch = emulatorMode && requestUrl.pathname.match(/^\/api\/([a-z][a-z-]*)$/);
  if (apiMatch) return localApi(req, res, apiMatch[1]);
  if (requestUrl.pathname.startsWith("/__photo_bucket_api/") || requestUrl.pathname === "/__photo_bucket_storage" || requestUrl.pathname === OBJECT_ROUTE) {
    if (bucketApiTarget({ emulatorMode, liveApiUrl: photoBucketApiUrl }).kind === "live") return requestUrl.pathname === OBJECT_ROUTE ? send(res, 404, "Not Found") : proxyPhotoBucket(req, res, requestUrl);
    // Emulator mode: the in-process local backend, for loopback same-origin callers only. Never the live API.
    const origin = req.headers.origin;
    if (!isLoopback(req.socket.remoteAddress) || (origin && origin !== `http://${host}:${port}`) || req.headers["sec-fetch-site"] === "cross-site") return send(res, 403, "Forbidden");
    try { return await (await localBuckets()).handle(req, res, requestUrl); }
    catch (error) { console.error("Local Photo Bucket backend failed:", error?.message); if (!res.headersSent) return send(res, 500, "Local Photo Bucket backend failed"); res.destroy(); return; }
  }
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method Not Allowed");
  const pathname = new URL(req.url, `http://${host}:${port}`).pathname;
  if (pathname === "/dev-banner.js") return send(res, 200, bannerScript, "text/javascript; charset=utf-8");

  let relativePath;
  try { relativePath = decodeURIComponent(pageRoutes.get(pathname) || pathname).replace(/^\/+/, ""); }
  catch { return send(res, 400, "Bad Request"); }
  if (!relativePath || relativePath.endsWith("/")) relativePath += "index.html";
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(root + path.sep)) return send(res, 403, "Forbidden");
  const parts = path.relative(root, target).split(path.sep);
  if (privateRoots.has(parts[0].toLowerCase()) || parts.some((part) => part.startsWith(".")) || /\.(?:md|log)$/i.test(target)) return send(res, 404, "Not Found");

  try {
    await access(target, constants.R_OK);
    let body = await readFile(target);
    const type = contentTypes.get(path.extname(target).toLowerCase()) || "application/octet-stream";
    if (type.startsWith("text/html")) body = Buffer.from(injectBanner(body.toString("utf8")));
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch (error) {
    if (["ENOENT", "EACCES", "EISDIR"].includes(error.code)) return send(res, 404, "Not Found");
    console.error("Preview server error:", error);
    send(res, 500, "Internal Server Error");
  }
});

let emulator, localBucketBackend;
// Created on first use, after the emulator env vars below are set.
const localBuckets = () => (localBucketBackend ||= createEmulatorBucketBackend({ root, origin: `http://${host}:${port}` }).catch((error) => { localBucketBackend = null; throw error; }));
if (emulatorMode) {
  // api/ admin functions call buckets here too: the local backend, never a real stack, whatever the shell had set.
  process.env.PHOTO_BUCKET_API_URL = `http://${host}:${port}/__photo_bucket_api`;
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  process.env.QD_LOCAL_ADMIN_EMULATOR = "1";
  console.log("Starting Firebase Auth and Firestore emulators for demo-wedding-security...");
  emulator = spawn("firebase emulators:start --only auth,firestore --project demo-wedding-security", {
    cwd: root, shell: true, stdio: "inherit", windowsHide: true,
  });
  emulator.on("error", (error) => {
    console.error("Could not start Firebase emulators. Install the Firebase CLI and ensure it is on PATH.", error);
    process.exitCode = 1;
    server.close();
  });
}

server.listen(port, host, () => {
  console.log(`Wedding invitation preview: http://${host}:${port}/`);
  console.log(`Live Firebase routes:       http://${host}:${port}/customer-login.html`);
  if (emulatorMode) console.log(`Safe emulator routes:       http://${host}:${port}/customer-login.html?emulator=1\nPhoto buckets:              local backend, data in .local-buckets/ (never the live API)`);
  else console.log(`Safe emulator mode:         npm run dev:emulator`);
});

function shutdown() {
  server.close();
  if (emulator && !emulator.killed) emulator.kill();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
