// Chooses online (S3 + DynamoDB) or browser-only storage from config.js.
import { API_URL } from './config.js';
import { anonymousIdentity, guestAdapter, ownerAdapter } from './adapter.js';
import { liveTransport, mockTransport } from './transport.js';

export const online = Boolean(API_URL);
export const createOwnerAdapter = async user => online ? (await import('./adapter-api.js')).ownerAdapterApi(user) : ownerAdapter(user.uid);
export async function createGuestAdapter(publicDetails) {
  return online ? (await import('./adapter-api.js')).guestAdapterApi(publicDetails) : guestAdapter(await anonymousIdentity());
}
export const defaultTransport = () => online ? liveTransport() : mockTransport();
