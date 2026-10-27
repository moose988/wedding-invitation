import { createOwnerAdapter, createGuestAdapter, defaultTransport, online } from './adapters.js';
import { guestUrl, readGuestUrl, validId, dateLabel, isLoopback } from './links.js';
import { LIMITS, validateFile, friendlyError } from './limits.js';
import { uploadQueue } from './transport.js';
import { decode, rotatedCanvas, cropRect, processImage } from './images.js';
import { qrCanvas, canvasBlob } from './qr.js';
import { download, makeZip, photoFilename } from './zip.js';
const app = document.getElementById('app'), mode = document.body.dataset.mode;
const owner = mode !== 'guest';
let adapter, bucket, queue, photos = [], filter = '', queueStates = new Map(), galleryUrls = [], viewerUrl, editor, refreshing = false, pendingRefresh = false, disposed = false;
const jobUrls = new Map();
const $ = selector => document.querySelector(selector);
const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const icons = {
  camera: '<rect x="3" y="6" width="18" height="15" rx="3"/><path d="m8 6 1-3h6l1 3"/><circle cx="12" cy="13" r="4"/>',
  gallery: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
const brand = back => `<nav class="pb-brand" aria-label="Photo Bucket"><${back ? 'a href="./all-events.html"' : 'span'} class="pb-wordmark">${icon('camera')} PHOTO BUCKET</${back ? 'a' : 'span'}><span class="pb-demo">${online ? 'Live' : 'Local demo · this browser'}</span></nav>`;
const meta = () => `<p class="pb-event-meta"><span>${h(dateLabel(bucket.date))}</span><span>${h(bucket.location)}</span></p>`;
const notice = () => `<div id="pauseNotice" class="pb-notice" role="status" ${bucket.paused ? '' : 'hidden'}>New photos are paused. ${owner ? 'Resume whenever you are ready.' : 'Your host will welcome more photos soon. You can still edit your saved moments.'}</div>`;
function message(text, error = false) { const node = $('#message'); if (node) { node.textContent = text; node.classList.toggle('pb-error', error); } }
function run(work) { return async event => { try { await work(event); } catch (error) { message(friendlyError(error), true); } }; }
function listen(selector, type, work) { $(selector)?.addEventListener(type, run(work)); }
function revokeGallery() { galleryUrls.forEach(url => URL.revokeObjectURL(url)); galleryUrls = []; }
function thumb(blob) { const url = URL.createObjectURL(blob); galleryUrls.push(url); return url; }
function dialogs() {
  return `<dialog id="viewer" class="pb-dialog pb-viewer" aria-labelledby="viewerTitle"><header><h2 id="viewerTitle">A shared moment</h2><button type="button" class="pb-icon-button" data-close="viewer" aria-label="Close photo viewer">×</button></header><img id="viewerImage" alt="Selected event photo"><div class="pb-dialog-body"><p id="viewerCaption"></p></div></dialog>
  <dialog id="confirmDelete" class="pb-dialog" aria-labelledby="deleteTitle"><header><h2 id="deleteTitle">Delete this photo?</h2></header><div class="pb-dialog-body"><p>This removes the saved photo${online ? '' : ' from this browser'}. This cannot be undone.</p><p id="deleteError" class="pb-error" role="alert"></p></div><footer><button type="button" data-close="confirmDelete" autofocus>Keep photo</button><button id="deleteConfirm" type="button" class="pb-danger">Delete photo</button></footer></dialog>
  ${owner ? '' : `<dialog id="editor" class="pb-dialog pb-editor" aria-labelledby="editorTitle"><header><h2 id="editorTitle">Make it yours</h2><button type="button" class="pb-icon-button" data-close="editor" aria-label="Cancel photo editing">×</button></header><div class="pb-dialog-body"><div class="pb-editor-stage"><canvas id="editCanvas" aria-label="Photo preview with crop boundary"></canvas></div><div class="pb-editor-tools"><button type="button" id="rotateButton">↻ Rotate</button><button type="button" id="replaceButton">Replace photo</button></div><div class="pb-crop-controls"><label>Crop size <input id="cropSize" type="range" min="40" max="100" value="100"></label><label>Horizontal position<input id="cropX" type="range" min="0" max="100" value="50"></label><label>Vertical position<input id="cropY" type="range" min="0" max="100" value="50"></label></div><p class="pb-subtle">Move the crop with the sliders. Save keeps the area inside the frame.</p><p id="editError" class="pb-error" role="alert"></p><input id="replaceInput" type="file" accept="image/jpeg,image/png,image/webp,image/avif" hidden></div><footer><button type="button" data-close="editor">Cancel</button><button id="saveEdit" type="button" class="pb-primary">Save photo</button></footer></dialog>`}`;
}
async function boot() {
  try {
    if (owner) {
      const { requireOwnerSession } = await import('./auth.js');
      const user = await requireOwnerSession(() => { disposed = true; revokeGallery(); app.replaceChildren(); document.querySelectorAll('dialog').forEach(d => d.close()); });
      adapter = await createOwnerAdapter(user); const id = new URLSearchParams(location.search).get('bucket');
      bucket = await adapter.get(validId(id));
    } else {
      const info = readGuestUrl(location.href); adapter = await createGuestAdapter(info); bucket = await adapter.open(info);
    }
    if (disposed) return;
    document.title = `${bucket.name} · ${mode === 'guest' ? 'Share your moments' : 'Photo Bucket'}`;
    if (mode === 'poster') {
      await renderPoster();
      window.addEventListener('focus', run(async () => {
        const current = await adapter.get(bucket.id);
        if (current.updatedAt !== bucket.updatedAt) { bucket = current; await renderPoster(); }
      }));
    }
    else {
      owner ? renderOwner() : renderGuest(); bindCommon();
      if (owner) { bindOwner(); await renderShare(); }
      else { bindGuest(); queue = uploadQueue({ adapter, bucketId: bucket.id, changed: onJobChange, transport: defaultTransport() }); await loadQueue(); await queue.start(); }
      await refreshGallery();
    }
    app.setAttribute('aria-busy', 'false');
  } catch (error) {
    app.setAttribute('aria-busy', 'false'); app.innerHTML = `${brand(owner)}<div class="pb-state"><strong>This collection could not open</strong><p>${h(friendlyError(error))}</p><button id="reloadButton" type="button">Try again</button></div>`;
    $('#reloadButton').addEventListener('click', () => location.reload());
  }
}
function renderGuest() {
  app.innerHTML = `${brand(false)}<header class="pb-hero"><p class="pb-kicker">A day to remember, together</p><h1 class="pb-event-title" id="eventName">${h(bucket.name)}</h1><div id="eventMeta">${meta()}</div><div class="pb-rule"></div><p class="pb-welcome">The little moments.<br>The big feelings. Your point of view.</p></header>
  <section class="pb-upload" aria-labelledby="uploadHeading"><h2 id="uploadHeading">Share a little joy</h2><p class="pb-subtle">Your memories belong in the picture.</p><div class="pb-upload-actions"><button type="button" class="pb-primary" id="cameraButton">${icon('camera')}Take a photo</button><button type="button" id="galleryButton">${icon('gallery')}Choose from gallery</button></div><input id="cameraInput" type="file" accept="image/*" capture="environment" hidden><input id="galleryInput" type="file" accept="image/*" multiple hidden>
  </section>
  ${notice()}<p id="message" class="pb-message" role="status" aria-live="polite"></p><section id="queueSection" hidden aria-label="${online ? 'Upload progress' : 'Local demo processing'}"><div class="pb-section-head"><h2>Saving your moments</h2></div><p class="pb-subtle">${online ? 'Uploading' : 'Local demo processing'} · Keep this page open while saving.</p><div id="queueList" class="pb-queue"></div></section>
  <section aria-labelledby="galleryHeading"><div class="pb-section-head"><h2 id="galleryHeading">Your moments</h2><span id="photoCount" class="pb-count"></span></div><div id="gallery" class="pb-grid"></div><div id="galleryState" class="pb-state" role="status">Loading your photos…</div></section>${dialogs()}`;
}
function renderOwner() {
  app.innerHTML = `${brand(true)}<header class="pb-owner-heading"><div><h1 id="eventName">${h(bucket.name)}</h1><div id="eventMeta">${meta()}</div></div></header>${notice()}<p id="message" class="pb-message" role="status" aria-live="polite"></p>
  <div class="pb-owner-layout"><section aria-labelledby="galleryHeading"><div class="pb-section-head pb-gallery-head"><h2 id="galleryHeading">The photo collection</h2><span id="photoCount" class="pb-count"></span></div><div class="pb-gallery-toolbar"><button type="button" id="zipButton">Download all as ZIP</button><button type="button" id="pauseButton">${bucket.paused ? 'Resume uploads' : 'Pause uploads'}</button></div><p id="zipStatus" class="pb-subtle" role="status"></p><div id="gallery" class="pb-grid"></div><div id="galleryState" class="pb-state" role="status">Loading your photos…</div>
  </section>
  <aside><section class="pb-panel pb-sharing" aria-labelledby="shareHeading"><h2 id="shareHeading">Invite their perspective</h2><div id="qrSlot" class="pb-qr-slot" role="status">Preparing QR code…</div><button type="button" id="copyLink">Copy guest link</button><a id="guestLink" class="pb-button" target="_blank" rel="noopener">Open guest page</a><button type="button" id="downloadQr">Download QR image</button><a class="pb-button" href="./photo-bucket-poster.html?bucket=${encodeURIComponent(bucket.id)}">Preview & print A5 card</a></section>
  <details class="pb-panel pb-owner-details"><summary>Edit details</summary><form id="detailsForm"><label>Event title<input name="name" required maxlength="100" value="${h(bucket.name)}"></label><label>Date<input name="date" type="date" required value="${h(bucket.date)}"></label><label>Place<input name="location" required maxlength="160" value="${h(bucket.location)}"></label><button type="submit" class="pb-primary">Save</button></form></details></aside></div>${dialogs()}`;
}
async function refreshGallery() {
  if (disposed) return;
  if (refreshing) { pendingRefresh = true; return; } refreshing = true;
  try {
    photos = (await adapter.photos(bucket.id)).sort((a,b) => b.createdAt - a.createdAt);
    if (disposed) return;
    drawGallery();
  } catch (error) { $('#galleryState').hidden = false; $('#galleryState').textContent = friendlyError(error); }
  finally { refreshing = false; if (pendingRefresh) { pendingRefresh = false; void refreshGallery(); } }
}
function visiblePhotos() { return filter ? photos.filter(p => p.contributorId === filter) : photos; }
function drawGallery() {
  const focused = document.activeElement?.closest('[data-photo]');
  const focusId = focused?.dataset.photo, focusAction = focused?.dataset.action;
  revokeGallery(); const visible = visiblePhotos();
  $('#photoCount').textContent = `${visible.length} ${visible.length === 1 ? 'photo' : 'photos'}`;
  $('#galleryState').hidden = Boolean(visible.length);
  $('#galleryState').innerHTML = filter ? '<strong>No photos from this contributor</strong>Choose Everyone to see the collection.' : `<strong>${owner ? 'The best moments are still to come' : 'Your story starts here'}</strong>${owner ? 'Share the guest link or add demo samples below.' : 'Take a photo or choose a favourite from your gallery.'}`;
  $('#gallery').innerHTML = visible.map(photo => `<article class="pb-tile"><button class="pb-image-button" type="button" data-photo="${h(photo.id)}" data-action="view" aria-label="Open photo by ${h(photo.name || 'Anonymous guest')}"><img src="${thumb(photo.thumbnail)}" alt="Event memory shared by ${h(photo.name || 'Anonymous guest')}" loading="lazy" width="240" height="300"></button><div class="pb-tile-body"><p>${h(owner ? photo.name || 'Anonymous guest' : (online ? 'Saved online' : 'Saved on this device'))}${photo.source === 'fixture' ? ' · Demo sample' : ''}</p><div class="pb-tile-actions"><button type="button" data-photo="${h(photo.id)}" data-action="${owner ? 'download' : 'edit'}">${owner ? 'Download' : 'Edit photo'}</button><button type="button" class="pb-danger" data-photo="${h(photo.id)}" data-action="delete" aria-label="Delete photo by ${h(photo.name || 'Anonymous guest')}">Delete</button></div></div></article>`).join('');
  if (owner) $('#zipButton').disabled = !visible.length;
  if (focusId) {
    const replacement = [...$('#gallery').querySelectorAll('[data-photo]')].find(n => n.dataset.photo === focusId && n.dataset.action === focusAction);
    if (replacement) replacement.focus();
    else { $('#galleryHeading').tabIndex = -1; $('#galleryHeading').focus(); }
  }
}
function bindCommon() {
  app.addEventListener('click', run(async event => {
    const close = event.target.closest('[data-close]'); if (close) { if (editor?.busy && close.dataset.close === 'editor') return; document.getElementById(close.dataset.close).close(); return; }
    const action = event.target.closest('[data-action][data-photo]'); if (!action) return;
    const photo = photos.find(p => p.id === action.dataset.photo); if (!photo) return;
    if (action.dataset.action === 'view') {
      const blob = await adapter.image(bucket.id, photo.id); if (viewerUrl) URL.revokeObjectURL(viewerUrl); viewerUrl = URL.createObjectURL(blob);
      $('#viewerImage').src = viewerUrl; $('#viewerCaption').textContent = `${photo.name || 'Anonymous guest'}${photo.source === 'fixture' ? ' · Demo sample' : ''}`; $('#viewer').showModal();
    }
    if (action.dataset.action === 'download') download(await adapter.image(bucket.id, photo.id), photoFilename(photo));
    if (action.dataset.action === 'edit') await openEditor(photo);
    if (action.dataset.action === 'delete') {
      $('#deleteError').textContent = ''; $('#confirmDelete').dataset.photo = photo.id; $('#confirmDelete').showModal();
    }
  }));
  $('#viewer').addEventListener('close', () => { $('#viewerImage').removeAttribute('src'); if (viewerUrl) URL.revokeObjectURL(viewerUrl); viewerUrl = null; });
  listen('#deleteConfirm', 'click', async () => {
    const button = $('#deleteConfirm'); button.disabled = true;
    try { await adapter.delete(bucket.id, $('#confirmDelete').dataset.photo); $('#confirmDelete').close(); message(online ? 'Photo deleted.' : 'Photo deleted from this browser.'); await refreshGallery(); }
    catch (error) { $('#deleteError').textContent = friendlyError(error); } finally { button.disabled = false; }
  });
  // Native <dialog> supplies modal focus containment, Escape and focus return.
  window.addEventListener('focus', run(async () => { bucket = owner ? await adapter.get(bucket.id) : await adapter.status(bucket.id); syncDetails(); await refreshGallery(); }));
  window.addEventListener('pagehide', () => { queue?.stop(); revokeGallery(); for (const url of jobUrls.values()) URL.revokeObjectURL(url); editor?.bitmap?.close(); }, { once: true });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
}
function bindGuest() {
  listen('#cameraButton', 'click', () => $('#cameraInput').click());
  listen('#galleryButton', 'click', () => $('#galleryInput').click());
  for (const input of ['#cameraInput', '#galleryInput']) {
    listen(input, 'change', async event => {
      const files = [...(event.target.files || [])]; event.target.value = ''; if (!files.length) return;
      if (files.length > LIMITS.batch) message('Choose up to 30 photos at a time. The first 30 will be processed.', true);
      let accepted = 0; const errors = [];
      for (const file of files.slice(0, LIMITS.batch)) {
        try { const job = await adapter.enqueue(bucket.id, file, ''); queueStates.set(job.id, job); accepted++; renderJobs(); void queue.start(); }
        catch (error) { errors.push(`${file.name}: ${friendlyError(error)}`); }
      }
      message(errors.length ? `${accepted} queued. ${errors.join(' ')}` : `${accepted} ${accepted === 1 ? 'photo' : 'photos'} queued for ${online ? 'upload' : 'local demo processing'}.`, Boolean(errors.length));
    });
  }
  listen('#queueList', 'click', async event => {
    const button = event.target.closest('[data-job]'); if (!button) return;
    if (button.dataset.retry) { const job = queueStates.get(button.dataset.job); queueStates.set(job.id, { ...job, state: 'queued', attempts: 0, error: '' }); renderJobs(); await queue.retry(job.id); }
    else { await adapter.discardJob(bucket.id, button.dataset.job); queueStates.delete(button.dataset.job); renderJobs(); }
  });
  listen('#rotateButton', 'click', () => { editor.rotation = (editor.rotation + 90) % 360; drawEditor(); });
  listen('#replaceButton', 'click', () => $('#replaceInput').click());
  listen('#replaceInput', 'change', async event => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    try { validateFile(file); const bitmap = await decode(file); editor.bitmap.close(); editor.bitmap = bitmap; editor.source = file; editor.rotation = 0; resetCrop(); drawEditor(); $('#editError').textContent = ''; }
    catch (error) { $('#editError').textContent = friendlyError(error); }
  });
  for (const selector of ['#cropSize', '#cropX', '#cropY']) listen(selector, 'input', drawEditor);
  listen('#saveEdit', 'click', async () => {
    if (editor.busy) return; editor.busy = true; setEditorBusy(true); $('#editError').textContent = '';
    try {
      const image = await processImage(editor.source, editValues()); await adapter.replace(bucket.id, editor.photo.id, image, editor.photo.revision);
      editor.busy = false; $('#editor').close(); message(online ? 'Your updated photo is saved.' : 'Your updated photo is saved on this device.'); await refreshGallery();
    } catch (error) { $('#editError').textContent = friendlyError(error); }
    finally { if (editor) editor.busy = false; setEditorBusy(false); }
  });
  $('#editor').addEventListener('cancel', event => { if (editor?.busy) event.preventDefault(); });
  $('#editor').addEventListener('close', () => { editor?.bitmap?.close(); editor = null; });
}
function setEditorBusy(busy) { $('#editor').querySelectorAll('button,input').forEach(n => n.disabled = busy); $('#saveEdit').textContent = busy ? 'Saving…' : 'Save photo'; }
async function openEditor(photo) {
  const source = await adapter.image(bucket.id, photo.id); const bitmap = await decode(source);
  editor?.bitmap?.close(); editor = { photo, source, bitmap, rotation: 0, busy: false }; resetCrop(); $('#editError').textContent = ''; $('#editor').showModal(); drawEditor();
}
function resetCrop() { $('#cropSize').value = '100'; $('#cropX').value = $('#cropY').value = '50'; }
function editValues() { return { rotation: editor.rotation, size: Number($('#cropSize').value), x: Number($('#cropX').value), y: Number($('#cropY').value) }; }
function drawEditor() {
  if (!editor) return;
  const rotated = rotatedCanvas(editor.bitmap, editor.rotation, 900), c = $('#editCanvas'); c.width = rotated.width; c.height = rotated.height; const ctx = c.getContext('2d'); ctx.drawImage(rotated, 0, 0);
  const rect = cropRect(c.width, c.height, editValues()); ctx.fillStyle = '#102a2580'; ctx.beginPath(); ctx.rect(0,0,c.width,c.height); ctx.rect(rect.x,rect.y,rect.width,rect.height); ctx.fill('evenodd'); ctx.strokeStyle = '#fffdf3'; ctx.lineWidth = 3; ctx.strokeRect(rect.x+1.5,rect.y+1.5,rect.width-3,rect.height-3);
  $('#cropX').disabled = $('#cropY').disabled = Number($('#cropSize').value) === 100;
}
async function loadQueue() { for (const job of await adapter.jobs(bucket.id)) queueStates.set(job.id, job); renderJobs(); }
function onJobChange(job) {
  if (disposed) return;
  if (job.state === 'queue-error') return message(job.error, true);
  if (job.state === 'saved') {
    queueStates.delete(job.id);
    message((online ? 'Saved online' : 'Saved on this device') + '. Thank you for sharing a little joy.');
    renderJobs();
    void refreshGallery();
    return;
  }
  queueStates.set(job.id, job); renderJobs();
}
function renderJobs() {
  const jobs = [...queueStates.values()]; $('#queueSection').hidden = !jobs.length;
  $('#queueList').innerHTML = jobs.map(job => {
    const state = { queued:'Queued', processing:`${online ? 'Uploading' : 'Local demo processing'} · ${job.progress || 0}%`, retrying:`Retrying ${online ? 'upload' : 'local processing'} · attempt ${job.attempts}/3`, saved:online ? 'Saved online' : 'Saved on this device', failed:job.error || 'Processing did not finish. Tap Retry.' }[job.state] || 'Queued';
    if (job.thumbnail && !jobUrls.has(job.id)) jobUrls.set(job.id, URL.createObjectURL(job.thumbnail));
    const preview = jobUrls.get(job.id);
    return `<article class="pb-job"><div class="pb-job-icon">${preview ? `<img src="${preview}" alt="Your photo preview">` : icon('gallery')}</div><div><p>${h(job.filename || 'Your photo')}</p><p ${job.state === 'failed' ? 'class="pb-error"' : ''}>${h(state)}</p>${!['saved','failed'].includes(job.state) ? `<progress max="100" value="${job.progress || 0}" aria-label="${online ? 'Upload progress' : 'Local demo processing progress'}"></progress>` : ''}${job.state === 'failed' ? `<button type="button" data-job="${h(job.id)}" data-retry="1">Retry</button><button type="button" data-job="${h(job.id)}">Remove</button>` : ''}</div></article>`;
  }).join('');
}
async function renderShare() {
  const url = guestUrl(bucket); $('#guestLink').href = url;
  try { $('#qrSlot').replaceChildren(await qrCanvas(url)); $('#qrSlot').removeAttribute('role'); $('#downloadQr').disabled = false; }
  catch (error) { $('#qrSlot').textContent = error.message; $('#downloadQr').disabled = true; }
}
function bindOwner() {
  listen('#pauseButton', 'click', async () => { bucket = await adapter.setPaused(bucket.id, !bucket.paused); syncDetails(); message(bucket.paused ? (online ? 'New uploads are paused.' : 'New local uploads are paused.') : (online ? 'New uploads can resume.' : 'New local uploads can resume.')); });
  listen('#copyLink', 'click', async () => {
    const url = guestUrl(bucket);
    try {
      await navigator.clipboard.writeText(url);
      message(isLoopback(url) ? 'Local preview link copied. A hosted HTTPS page is needed for phone scanning.' : 'Guest link copied.');
    } catch { window.prompt('Copy this guest link:', url); }
  });
  listen('#downloadQr', 'click', async () => download(await canvasBlob($('#qrSlot canvas')), 'photo-bucket-qr.png'));
  listen('#detailsForm', 'submit', async event => {
    event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true;
    try { bucket = await adapter.update(bucket.id, Object.fromEntries(new FormData(event.target))); syncDetails(); await renderShare(); message(online ? 'Event details saved.' : 'Event details saved on this device.'); }
    finally { button.disabled = false; }
  });
  listen('#zipButton', 'click', async () => {
    const button = $('#zipButton'); button.disabled = true;
    try { const blob = await makeZip(visiblePhotos(), p => adapter.image(bucket.id, p.id), (done,total) => { $('#zipStatus').textContent = `Preparing ${online ? '' : 'local '}ZIP · ${done} of ${total} photos`; }); download(blob, 'photo-bucket-photos.zip'); $('#zipStatus').textContent = 'Your ZIP is ready. Check your downloads.'; }
    catch (error) { $('#zipStatus').textContent = friendlyError(error); } finally { button.disabled = !visiblePhotos().length; }
  });
}
function syncDetails() {
  $('#eventName').textContent = bucket.name; $('#eventMeta').innerHTML = meta(); $('#pauseNotice').hidden = !bucket.paused;
  if (owner) $('#pauseButton').textContent = bucket.paused ? 'Resume uploads' : 'Pause uploads';
}
async function renderPoster() {
  app.innerHTML = `<nav class="pb-poster-controls"><a class="pb-button" href="./photo-bucket-manage.html?bucket=${encodeURIComponent(bucket.id)}">Back to collection</a><button type="button" class="pb-primary" id="printPoster">Print / Save as PDF</button></nav><article class="pb-poster" aria-label="A5 photo sharing table card"><img class="pb-floral pb-floral--tl" src="./photo-bucket/assets/botanical.svg" alt=""><img class="pb-floral pb-floral--br" src="./photo-bucket/assets/botanical.svg" alt=""><p class="pb-kicker">A collection of beautiful memories</p><h1>Share the moments</h1><h2>${h(bucket.name)}</h2>${meta()}<div id="posterQr"></div><p class="pb-poster-scan">Scan to share your photos</p><p class="pb-subtle">No login needed</p><p class="pb-poster-demo">${online ? 'Share your photos with the hosts' : 'Local demo · Photos stay on your device'}</p></article><p class="pb-print-note" id="posterNote"></p><p class="pb-print-note">A5 portrait · Print at 100% with browser headers and footers off.<br>Choose “Save as PDF” in your browser’s print dialog.</p>`;
  if (bucket.name.length > 60 || bucket.location.length > 110) $('.pb-poster').classList.add('pb-poster--compact');
  $('#printPoster').disabled = true; const url = guestUrl(bucket);
  $('#posterNote').textContent = isLoopback(url) ? 'Local preview only: set a hosted public origin before printing a card for phone scanning.' : 'This card opens the live photo page. Guests do not need an account.';
  const canvas = await qrCanvas(url); $('#posterQr').replaceChildren(canvas); $('#printPoster').disabled = false;
  listen('#printPoster', 'click', () => window.print());
}
// Explicit automation hook, callable only by a loopback development harness.
// No query parameter, storage flag, failure control or owner bypass exists in UI.
export function installTestTransport(transport) {
  if (owner || !isLoopback(location.href) || !queue?.idle) throw new Error('Transport injection requires an idle local guest development session.');
  queue.stop(); queue = uploadQueue({ adapter, bucketId: bucket.id, changed: onJobChange, transport });
  void queue.start();
}
void boot();
