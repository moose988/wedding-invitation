import { createOwnerAdapter, online } from './adapters.js';
import { dateLabel } from './links.js';
export async function renderLocalBuckets(ownerId, user = { uid: ownerId }) {
  let section = document.getElementById('localPhotoBuckets');
  if (!section) {
    section = document.createElement('section'); section.id = 'localPhotoBuckets'; section.className = 'local-photo-buckets';
    document.getElementById('sampleInvitationPanel').before(section);
  }
  section.replaceChildren();
  section.dataset.owner = ownerId;
  const customerView = document.body.dataset.accountSurface === 'customer';
  if (customerView) {
    const prompt = document.createElement('article');
    prompt.className = 'photo-bucket-discovery';
    prompt.innerHTML = `<div class="photo-bucket-discovery__image"><img src="./photo-bucket/assets/customer-photo-bucket.webp" alt="" loading="lazy" /></div>
      <div class="photo-bucket-discovery__content"><p class="photo-bucket-discovery__eyebrow">MORE WAYS TO CELEBRATE</p><h2>Collect the moments that matter.</h2><p>Bring the photos from your celebration together in one shared place.</p><span class="photo-bucket-discovery__link" role="link" aria-disabled="true">Discover Photo Bucket <span aria-hidden="true">↗</span></span><span class="photo-bucket-discovery__note">More information coming soon</span></div>`;
    section.append(prompt);
  }
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
  } catch (error) {
    if (customerView && [401, 403].includes(error.status)) return;
    console.error('Photo Buckets could not load:', error);
    const message = document.createElement('p');
    message.setAttribute('role', 'status');
    if (customerView) message.className = 'customer-bucket-status';
    message.textContent = customerView && /paused until the event/i.test(error.message || '') ? 'Photo collection access is currently paused.' : online ? 'Photo Buckets could not load. Check your connection and refresh.' : 'Local Photo Buckets could not load. Allow browser storage and refresh.';
    section.append(message);
  }
}
