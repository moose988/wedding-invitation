# Wedding Invitation Platform Firebase MVP

This project is a luxury bilingual Arabic/English wedding invitation experience with a Firebase-powered multi-client MVP layered on top of the existing invitation flow.

## Included pages

- `index.html`
  Guest invitation page with demo fallback and Firebase guest mode
- `dashboard.html`
  Auth-protected planner/client dashboard
- `checkin.html`
  Hostess check-in page with QR-link guest lookup and manual search mode

## 1. Add Firebase config

Edit [firebase-config.js](C:\Users\mohda\OneDrive\Desktop\wedding invitaion\firebase-config.js) and replace the empty `window.FIREBASE_CONFIG` values:

```js
window.FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID",
};
```

The invitation page keeps working in static demo mode if those values stay empty.

## 2. Create Firestore collections

Use this structure:

```text
weddings/{weddingId}
weddings/{weddingId}/guests/{guestId}
weddings/{weddingId}/tables/{tableId}
weddings/{weddingId}/dashboardUsers/{userId}
weddings/{weddingId}/seatingAccess/{bride|groom}
```

## 3. Example wedding document

```json
{
  "coupleName": "Sara & Khalid",
  "brideName": "Sara",
  "groomName": "Khalid",
  "brideNameAr": "سارة",
  "groomNameAr": "خالد",
  "subtitleEn": "With love, we invite you to celebrate our special day.",
  "subtitleAr": "بكل الحب ندعوكم لمشاركتنا فرحة العمر.",
  "invitationMessageEn": "We would be honored by your presence as we begin a beautiful new chapter together.",
  "invitationMessageAr": "نتشرف بحضوركم لتشهدوا معنا بداية فصل جديد من العمر.",
  "eventDateISO": "2026-12-20T20:00:00+04:00",
  "timeEn": "8:00 PM",
  "timeAr": "الساعة ٨:٠٠ مساءً",
  "venueEn": "Pearl Ballroom, Dubai",
  "venueAr": "قاعة اللؤلؤة، دبي",
  "locationEn": "Dubai, United Arab Emirates",
  "locationAr": "دبي، الإمارات العربية المتحدة",
  "mapsUrl": "https://maps.app.goo.gl/example",
  "dressCodeEn": "Formal attire in champagne, mocha, emerald, and soft neutrals.",
  "dressCodeAr": "الزي الرسمي بألوان الشامبانيا والموكا والزمردي والدرجات الهادئة.",
  "closingEn": "Your presence makes our joy complete.",
  "closingAr": "حضوركم يزيد فرحتنا.",
  "status": "active",
  "ownerUserId": "firebase-auth-uid",
  "createdAt": "serverTimestamp()",
  "updatedAt": "serverTimestamp()"
}
```

## 4. Example guest document

```json
{
  "fullName": "Noor Ahmed",
  "fullNameAr": "نور أحمد",
  "phone": "971500000000",
  "side": "bride",
  "rsvpStatus": "pending",
  "guestToken": "secureRandomToken",
  "inviteLink": "https://your-domain/index.html?wedding=wedding123&guest=secureRandomToken",
  "tableId": "tableA",
  "tableName": "Moonlight",
  "seatNumber": "4",
  "qrCodeValue": "https://your-domain/checkin.html?wedding=wedding123&guest=secureRandomToken",
  "checkedIn": false,
  "checkedInAt": null,
  "notes": "",
  "inviteSentAt": null,
  "reminderSentAt": null,
  "createdAt": "serverTimestamp()",
  "updatedAt": "serverTimestamp()"
}
```

## 5. Example table document

```json
{
  "name": "Moonlight",
  "label": "Table A",
  "capacity": 8,
  "x": 20,
  "y": 24,
  "shape": "round",
  "floorZone": "Grand Hall",
  "guestIds": [],
  "createdAt": "serverTimestamp()",
  "updatedAt": "serverTimestamp()"
}
```

## 6. Guest links

Guest invitation:

```text
index.html?wedding={weddingId}&guest={guestToken}
```

Hostess QR check-in:

```text
checkin.html?wedding={weddingId}&guest={guestToken}
```

If `wedding` and `guest` are missing, the invitation falls back to demo mode automatically.

## 7. Dashboard login

- Create Firebase Auth email/password users.
- Add each allowed user to:

```text
weddings/{weddingId}/dashboardUsers/{userId}
```

- Set role fields like:
  - `canViewDashboard`
  - `canEditGuests`
  - `canEditSeating`
  - `canCheckIn`
  - `canExport`
  - `canManageUsers`

The dashboard verifies both Firebase Auth and the matching `dashboardUsers/{userId}` document.

## 8. Check-in flow

- QR links open the guest card directly.
- Authenticated hostess users with `canCheckIn: true` can mark guests as checked in.
- When no guest token is in the URL, hostess search mode becomes available after sign-in.
- The page shows a live checked-in counter from Firestore.

## 9. Deployment

You can deploy this as a static Firebase Hosting site:

1. Install Firebase CLI.
2. Run `firebase login`
3. Run `firebase init hosting`
4. Set the public directory to this project folder.
5. Install the Functions dependencies: `cd functions; npm install; cd ..`
6. Set the server-only encryption secret used to store recoverable owner links:

```text
firebase functions:secrets:set SEATING_LINK_ENCRYPTION_KEY
```

Use a long random value and keep it private. It is never sent to the browser.

7. Deploy rules, Functions, and Hosting with `firebase deploy`.

Any static host also works if Firebase Auth and Firestore are configured for the deployed domain.

## 10. Security notes and production recommendations

- Review [firestore.rules](C:\Users\mohda\OneDrive\Desktop\wedding invitaion\firestore.rules) before production.
- The current dashboard role model is suitable for MVP testing.
- Guest-token reads and RSVP writes are the main area that needs hardening.
- Safest production approach:
  - Use Cloud Functions or a token-keyed public mirror collection for guest-facing reads.
  - Validate guest tokens server-side before allowing RSVP or check-in writes.
- Keep planner-only fields separate from guest-facing fields.

### Bride & groom seating editor links

The Invitations page gives the wedding owner exactly two fixed seating-editor cards: Bride and Groom. Creating, opening, copying, regenerating, and revoking a link calls the deployed `manageSeatingEditorAccess` Cloud Function. The function verifies `ownerUserId`, creates a 256-bit random token, stores its SHA-256 lookup value and an AES-GCM encrypted owner-recovery copy, and returns the plaintext link only to the owner. It exchanges a valid link for a Firebase custom token restricted to one wedding and one role.

Firestore rules allow this custom-token identity to read the wedding's existing `guests` and `tables` data and update only seating fields plus table documents. It cannot read dashboard users, invitation access records, check-in data, exports, or another wedding. Revoking or regenerating increments the access version in `seatingAccess`; rules compare that version on every request, so previously issued editor sessions immediately lose Firestore access as well.

The secure editor route is `dashboard.html?seatingEditor=1&token=...`. After the one-time exchange, the raw token is removed from the address bar and the route exposes only the existing shared Seating Planner.

## Notes about the current implementation

- `index.html` preserves the envelope intro, music toggle, countdown, bilingual copy, gallery, and dress code sections.
- `dashboard.html` listens to guests and tables in real time.
- `export.js` prefers `.xlsx` via SheetJS CDN and falls back to `.csv`.
- `qr.js` prefers a QR library and falls back to a visible check-in link.
