import { processImage } from './images.js';
// Explicitly invoked only. Local repository photographs, never a remote stock API.
const samples = [
  ['courtyard', 'Amelia', '../images/gallery-1.jpg'],
  ['pearl', 'Oliver', '../images/gallery-2.jpg'],
  ['garden', 'Sofia', '../images/gallery-3.jpg'],
];
export async function loadFixtures(adapter, bucketId) {
  for (const [key, name, path] of samples) {
    const response = await fetch(new URL(path, import.meta.url));
    if (!response.ok) throw new Error('A local sample image is unavailable. Your own photos are unchanged.');
    const image = await processImage(await response.blob(), key === 'garden' ? { size: 60, x: 80 } : {});
    await adapter.addFixture(bucketId, key, name, image);
  }
}
