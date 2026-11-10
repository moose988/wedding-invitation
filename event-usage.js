// What one event uses and roughly what it costs. No Firebase and no DOM, so it runs in Node tests.
// Everything here is an estimate worked out from the event's size. Nothing is measured.

// Firebase free plan: the daily allowance shared by every event.
export const FREE_DAILY = Object.freeze({ reads: 50_000, writes: 20_000 });

// Approximate AWS list prices in US dollars for the region the photos are stored in (Stockholm).
// Change them here if AWS changes its prices; the page labels every figure as approximate.
export const PRICES = Object.freeze({
  storagePerGbMonth: 0.023, // S3 Standard: the photos guests see
  backupPerGbMonth: 0.0125, // S3 Standard-IA: the backup copies
});

const GB = 1024 ** 3;
const n = (value) => (Number.isFinite(value) && value > 0 ? value : 0);

// counts is { collectionName: number } for one event.
export function eventEstimate({ counts = {}, seatingEnabled = true, eventCategory = "wedding_engagement" } = {}) {
  const c = (name) => n(counts[name]);
  const shared = eventCategory === "gender_reveal"; // one shared link, no personal invitations or seating
  const records = Object.values(counts).reduce((sum, value) => sum + n(value), 0) + 1;
  // The dashboard listens to these whole collections, plus the event, the membership and the summary.
  const dashboardOpen = (shared ? c("genderRevealResponses") : c("guests") + c("tables") + c("seatAssignments") + c("seatOccupancy") + c("invitationSecrets")) + 3;
  // A guest's page reads the invitation, the event and the scene, then the schedule and, with seating on, the hall layout.
  const invitationOpen = shared ? 2 : 3 + c("publicSchedule") + (seatingEnabled ? c("publicLayouts") + c("publicVenue") : 0);
  const people = shared ? c("genderRevealResponses") : c("guests");
  // A reply writes the invitation, the guest and its seating and check-in copies; a shared-link reply writes four records too.
  const replyWrites = 4;
  return {
    records, people, dashboardOpen, invitationOpen, replyWrites,
    everyoneOpensOnce: people * invitationOpen,
    everyoneReplies: people * replyWrites,
    backupDownload: records,
  };
}

export function shareOf(amount, allowance) {
  if (!allowance) return "";
  const percent = (n(amount) / allowance) * 100;
  if (percent === 0) return "0%";
  if (percent < 0.1) return "under 0.1%";
  return `${percent >= 10 ? Math.round(percent) : percent.toFixed(1)}%`;
}

// usedBytes is what guests' photos take; backupBytes is the backup copies; limitGb is the bucket's size.
export function bucketEstimate({ usedBytes = 0, backupBytes = 0, limitGb = 0 } = {}, prices = PRICES) {
  const storage = (n(usedBytes) / GB) * prices.storagePerGbMonth;
  const backup = (n(backupBytes) / GB) * prices.backupPerGbMonth;
  // A full bucket: every byte of the limit used, with backups about a third the size (they are stored at lower quality).
  const whenFull = n(limitGb) * prices.storagePerGbMonth + n(limitGb) * prices.backupPerGbMonth / 3;
  return { storage, backup, total: storage + backup, whenFull };
}

export function money(amount) {
  const value = n(amount);
  if (value === 0) return "$0.00";
  if (value < 0.01) return "under $0.01";
  return `$${value.toFixed(2)}`;
}

export function sizeText(bytes) {
  const value = n(bytes);
  if (value >= GB) return `${(value / GB).toFixed(value >= 10 * GB ? 0 : 1)} GB`;
  return `${Math.round(value / 1024 ** 2)} MB`;
}
