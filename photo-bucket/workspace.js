import { createOwnerAdapter, online } from './adapters.js';
import { dateLabel } from './links.js';
export async function renderLocalBuckets(ownerId, user = { uid: ownerId }) {
  let section = document.getElementById('localPhotoBuckets');
  if (!section) {
    section = document.createElement('section'); section.id = 'localPhotoBuckets'; section.className = 'local-photo-buckets';
    document.querySelector('.workspace-hero').after(section);
  }
  section.replaceChildren();
  section.dataset.owner = ownerId;
  try {
    const buckets = await (await createOwnerAdapter(user)).list();
    if (section.dataset.owner !== ownerId) return;
    if (!buckets.length) return;
    const title = document.createElement('h2'); title.textContent = 'Photo Buckets';
    const note = document.createElement('p'); note.textContent = online ? 'Photos are stored online.' : 'Local demo · Photos stay in this browser.';
    const grid = document.createElement('div'); grid.className = 'wedding-grid';
    for (const bucket of buckets) {
      const card = document.createElement('article'); card.className = 'wedding-card';
      const label = document.createElement('p'); label.className = 'workspace-kicker'; label.textContent = online ? 'Photo Bucket' : 'Photo Bucket · Local demo';
      const heading = document.createElement('h3'); heading.textContent = bucket.name;
      const meta = document.createElement('p'); meta.textContent = `${dateLabel(bucket.date)} · ${bucket.location}`;
      const link = document.createElement('a'); link.className = 'primary-button'; link.textContent = 'Manage photos & QR'; link.href = `./photo-bucket-manage.html?bucket=${encodeURIComponent(bucket.id)}`;
      card.append(label, heading, meta, link); grid.append(card);
    }
    section.append(title, note, grid);
  } catch { section.textContent = 'Local Photo Buckets could not load. Allow browser storage and refresh.'; }
}
