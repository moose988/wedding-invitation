# Security model and review notes

This repository is prepared for Firebase Spark with Firebase Authentication, Cloud Firestore rules, and a Vercel-hosted static frontend. Browser workflows do not call Cloud Functions or expose service-account credentials or encryption secrets. This review describes the source and emulator tests; it does not certify production configuration.

## Access matrix

| Data/action | Owner or authorized organizer | Side seating account | Check-in account | Invitation bearer | Public visitor |
| --- | --- | --- | --- | --- | --- |
| Full event and guest documents | Owner; other dashboard permissions are scoped | No | No | No | No |
| Seating guest projection | Yes | Allowed side only | No | No | No |
| Change seating | Yes, if allowed | Allowed side and seating enabled | No | No | No |
| Read layout and occupied state | Yes | Yes, when seating is enabled | No | No | No |
| Invitation link management | Authorized guest manager | Only guest records permitted by membership | No | No | No |
| Public invitation and RSVP | No special path | No | No | Exact token only | No |
| Check-in roster and state | Owner or `canCheckIn` | No | Allowed side only | No | No |
| Sender recipients | Authorized organizer creates/revokes | No | No | Exact capability and chunks | No |
| Public summary | Yes | Yes | Yes | No | Counts-only summary |

The event membership document keyed by Firebase Auth UID is the authority. URL `side` values are hints for routing and display only. Firestore rules validate role, side, event, event category, seating state, check-in state, and allowed update fields. A membership owner cannot be self-created or self-promoted except for the owner record bootstrapped atomically with event creation.

## Protected projections

- `publicGuests/{token}` contains one invitation and the RSVP fields required by that invitation. Anonymous access is exact-document `get`; collection listing is denied. The matching RSVP batch also updates the private canonical guest, with allowance and field validation in rules.
- `seatingGuests/{guestId}` contains only full name, side, party size, and RSVP values needed by seating. Side queries must be filtered to the account's allowed side.
- `checkinGuests/{guestId}` contains only the data needed to search and check in. Reads and check-in updates require a signed-in `canCheckIn` membership and respect `allowedSide`.
- `seatAssignments`, `seatedPeople`, and `seatOccupancy` separate private assignments, unique person bindings, and PII-free occupancy flags. Rules reject cross-side changes; transactions prevent chair races and double seating.
- `publicSummary/summary` contains event display values and aggregate counts only. `publicStats/summary` is owner-only. Both carry `updatedAt` so the UI can communicate that a summary is projected and may be stale.
- `senderCapabilities/{capability}/recipients/{chunk}` is a revocable bearer capability. Each child read requires the active parent; child listing is denied. A sender link reveals the selected recipients' names, normalized phone numbers, sides, and invitation URLs to anyone who holds it.

## Session isolation

Authenticated dashboard routes use one named Firebase app with `browserSessionPersistence` per browser tab. Public invitations use a separate Firestore-only Firebase app. Invitation load, RSVP, or sender-link opening does not initialize dashboard Auth or sign out another tab.

## Migration and revocation

The owner dashboard runs an idempotent seating migration that retains table/chair IDs, geometry, and assignments while creating canonical records. It can resume after interruption. **Repair projections** refreshes invitation projections, summaries, and minimal seating/check-in documents from the current event data. Event deletion sets `deleting: true` before paginated child cleanup; rules stop ordinary access immediately, and owners can retry cleanup if the browser closes.

Stable browser-generated invitation tokens do not expire automatically. Explicit revoke removes the public projection and marks the private token index revoked. Sender capabilities are manually revocable and currently have no automatic expiry. Firestore TTL policies are not required.

Older encrypted server-only invitation values cannot be decrypted without the original Functions encryption secret. The local browser cannot recover them; issue a replacement link for any guest without an active browser-generated token. Existing browser-generated token records and links remain stable.

## Verification scope

The repository's Firestore emulator tests cover owner membership bootstrap, same-side seating transactions and races, event/side boundaries, anonymous token reads and RSVP allowance, stable/revoked invitation tokens, exact sender capability reads, and permission-controlled check-in. Run `npm test` and `npm run test:security` as described in [README.md](README.md). Real account sign-in, two-tab browser behavior, Firebase Console Auth settings, Hosting, and production rules remain deployment smoke checks; no production deploy is performed by these commands.
