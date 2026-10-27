# Layla & Zaid invitation visual audit

27 October 2026. Reviewed on `codex/layla-zaid-visual-audit` and pushed to `main` at the user's request. No site deployment was initiated. The two pre-existing untracked door media files were left untouched.

## Reference limitation

The supplied attachment contains the written brief. The six referenced screenshots were not attached or available in that attachment directory. This review covers all six current page components—hero, countdown, details/map, timeline, seating and RSVP—against fresh before captures. **A comparison against the six missing reference images is not verified.**

## Changes

- Added `visual-polish.css`, loaded only by the Layla invitation and scoped beneath `body.layla-zaid-invitation`. Shared CSS, the gender-reveal styles and dashboard styles are unchanged.
- Applied consistent text/control colors, heading hierarchy, readable body text, tab labels, countdown labels and button dimensions. Preserved script names and Arabic fonts, with separate Arabic line-height and tracking rules.
- Allowed the hero to grow for short screens and large text; date, time and venue now occupy separate localized lines.
- Made tab/panel text wrap, reduced panel/map padding, aligned venue actions and retained the floral map frame.
- Aligned timeline times and icons to the first text line; the connector follows the icon centers after font loading.
- Reduced the seating greeting, increased chair names from 11.52px to 14px and metadata from 10.4px to 13px at the 390px baseline. Added a selected checkmark and legible unassigned copy. At enlarged text, cards scroll horizontally instead of squeezing long names into narrow columns.
- Fixed duplicate table prefixes in a display formatter; stored assignment names are unchanged. Retained seat targets, coordinates, fit bounds, geometry and controls. Initial fitting waits for fonts. The existing Layla design has no My seats button; other themes retain theirs.
- Reduced the seating viewport to 340px and removed unnecessary empty-state height.
- Kept full-width RSVP actions, flexible radio choices, a 112px textarea, visible focus/error/loading/disabled/confirmation states and the optional note. Suppressed duplicate RSVP overlay toasts for this design because the form/summary already communicates the result.
- Kept the audio control fixed at the bottom left and the language control fixed at the upper right. The local live-data link now clears the session's saved emulator flag so a previous emulator login cannot silently route a later local link to demo data. Kept developer warnings visible.

Background image URLs, positioning, sizes, repeats, attachment, backdrop object-fit/position, decorative assets, media, opening video and duration were not changed. RSVP persistence, authorization, schema, rules, map destinations and calendar generation were not changed.

## Verified in Chrome through Playwright

| Check | Evidence / extent |
| --- | --- |
| Responsive layout | Actual rendering at 320, 360, 375, 390, 430, 768 and 1440 CSS pixels, both English and Arabic. No detected horizontal page overflow or clipped text in the inspected elements. |
| Short screen and enlarged text | 320×480; all seven widths with 200% root font size, long English/Arabic names and longer venue strings. Hero content remained inside its growing frame. |
| Font fallback | Remote font stylesheet replaced with an empty response in the test browser. 320px layout remained accessible. |
| Countdown | Three-digit days, equal columns and expired zero state. |
| Opening and audio | The real 5.041667-second local video advanced and completed naturally. Skip also exercised. Audio play/pause changed the media and button state. No audio quality/listening claim. |
| Details | View details navigation; keyboard tab navigation and selected state; Maps href preserved; calendar downloaded and contained VCALENDAR data. |
| Seating | One guest/no companions, three guests including unassigned, eleven members with horizontal scrolling. Enter selected the exact assigned chair and kept it in the viewport. Unassigned selection removed the marker. Fit, zoom and mouse pan worked; resizing retained a manual transform. |
| Empty seating | Browser-only state injection used to render an unpublished/empty floor plan. |
| RSVP validation | Native required-radio validation blocked empty submission. Whole-label selection exercised. |
| Loading and error | A browser-only response wrapper delayed saving and deliberately threw an error. Disabled controls, saving text, retry, preserved choice and note were inspected. This is a simulated service failure. |
| RSVP persistence | A real save to the loopback demo Firestore emulator updated canonical guest, public invitation, seating and check-in mirrors. Double-click invoked one save. Reload retained the confirmation. Change response and decline were exercised. |
| Map states | Loading and error/retry were inspected using browser-only iframe-load suppression and an injected iframe error. Actual Google map tiles/provider controls were not validated. |
| Uninstrumented sample | Opened the sample without browser source hooks, submitted its sample-only RSVP, switched to Arabic, checked RTL summary direction and verified the 360px page width. The document intentionally retains its existing LTR geometry while Arabic content regions use RTL. |
| Background protection | Compared computed background/image properties before and after and reviewed the source diff; artwork files and background declarations were unchanged. |
| Other pages | Before/current screenshots of the authenticated dashboard, gender-reveal invitation, Ali & Salma design and generic invitation at 390 and 1440px. See regression results and captures. The new stylesheet is absent on these pages. This is a visual smoke test, not a complete functional audit of those products. |

All persisted test responses were confined to fresh synthetic fixtures under `demo-wedding-security` on loopback emulators. No real customer response was submitted and no production guest data was edited. Long-copy, empty-plan, font/service/map failure scenarios were confined to the test browser; hooks are not shipped in application source.

Of the eight cross-theme screenshot pairs, six were pixel-identical. The 1440px dashboard differed in four pixels within a 2×2 area of a sidebar icon. The 390px generic invitation differed in 5,649 pixels; visual inspection found no structural layout change. These two pairs are not claimed as pixel-identical, and the precise rendering cause is unconfirmed. Gender-reveal and Ali & Salma captures were identical at both tested widths. The shared stylesheets match the original checkout and none of these pages loads the new polish stylesheet.

## Tests and limits

- Focused invitation, Layla, intro, gender-reveal and category tests: **91 passed, 0 failed, 2 skipped**.
- Full `npm test`: **217 passed, 2 failed, 9 skipped**. One failure is the missing backend `sharp` dependency. The other is an existing workspace-order test whose exact LF substring does not match this CRLF checkout of unchanged `weddings.css`. These are not claimed as passing.
- Normal before/after browser runs reported no uncaught page errors or failed requests. The error-state test deliberately invokes the existing error logging path.
- Physical iOS/Android devices, Safari/WebKit, screen readers, OS/browser zoom at 200%, audible sound quality and third-party Maps behavior were not tested. The enlargement test changes root font size to 200%; it is not a claim about every browser's zoom implementation.
- No production event URL/credential was supplied for inspection. The built-in sample uses 8:00 PM, with a schedule of 7:30/8:00/9:00 PM, and Sofitel Dubai The Palm in both venue and map configuration. The brief's 9:08 PM versus 17:30/19:00 and Pearl Ballroom versus FIVE Palm discrepancies are not present in that built-in sample. **Whether they remain in the customer event is unverified; no event values were corrected.**

## Local review artifacts

- `.local-evidence/layla-visual-audit/index.html`: before/after gallery plus state captures.
- `.local-evidence/layla-visual-audit/before-after.png`: six-component comparison sheet.
- `.local-evidence/layla-visual-audit/states/results.json`: state checks and enlarged-text measurements.
- `.local-evidence/layla-visual-audit/regressions/results.json`: cross-theme screenshot comparisons.
- `.local-evidence/layla-audit-focused.log` and `.local-evidence/layla-audit-unit.log`: test output.
- `.local-evidence/audit-layla.mjs`, `audit-layla-states.mjs` and `audit-layla-regressions.mjs`: local browser review harnesses. They require the explicit loopback demo emulator variables and the synthetic fixture file. Browser hooks and screenshots are ignored by Git.

Safe sample preview while the local server is running: `http://127.0.0.1:5173/invitations/wedding-designs/layla-zaid/?wedding=luxury-wedding-demo&sample=1&emulator=1`. Sample mode intentionally omits personal seating; the synthetic fixture preview is listed in the gallery.
