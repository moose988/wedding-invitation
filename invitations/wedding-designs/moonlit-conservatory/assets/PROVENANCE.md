# Original Moonlit Conservatory assets

Created for this template on 29 October 2026. No existing customer's media was
changed or reused for the visual design. Raster generation used the built-in
`image_gen.imagegen` tool, one call for each original. Original PNG outputs
remain in the user's Codex generated-images folder; the website uses optimized
project-local WebPs. The film is an original local motion composition from those
images, not an AI-generated live-action clip. Existing shared wedding music is
retained by the guest runtime.

| File | Role | Source |
|---|---|---|
| opening.webp | Opening-screen picture and video poster | First frame of the Higgsfield opening film (12 Nov 2026) |
| garden.webp | Hero and closing picture | Original generated architectural photograph |
| table.webp | Details-page supporting picture | Original generated editorial photograph |
| botanical.webp | Schedule decorative artwork | Original generated engraved botanical illustration |
| thumbnail.webp | Separate event-picker thumbnail | Optimized landscape crop of the new garden picture |
| opening.mp4 | Six-second opening film: the doors open and the camera glides to the moon | Higgsfield Seedance 2.0 image-to-video from the original opening picture (12 Nov 2026) |
| details-loop.mp4 | Eight-second looping background behind the details section | Higgsfield Seedance 2.0, start and end frame both the garden picture, locked camera (12 Nov 2026) |
| details-loop.webp | Poster for the details background | First frame of details-loop.mp4 |
| moon.svg | Moon illustration and favicon | Original hand-authored vector |
| chair.svg | Personalized guest-chair artwork | Original hand-authored vector |

## Prompt set

### Opening picture

Photorealistic natural, portrait 1024×1536. Cinematic night photograph looking
straight into a dark botanical conservatory. Two tall slim blackened bronze
glass doors, closed but transparent, art deco curved muntins and symmetry.
Through the glass, a long shallow reflecting pool leads into olive trees and
white jasmine under a pearly full moon. Deep midnight blue-green and silver,
warm candle flames near the ground, wet dark limestone. Architectural editorial
photography, textured foliage, serene luxury and high contrast. Moon in upper
center, doorway occupies most of frame. No people, text, logos, rings, envelopes,
or pale floral borders. Portrait composed for mobile.

### Garden photograph

Photorealistic natural, wide 1536×1024. Inside a magnificent dark bronze and
glass botanical conservatory after sunset. Centered long reflecting pool, white
jasmine and silvery olive trees in stone pots, slender classical arches,
pearly full moon in blue-black sky beyond a central arch, tiny candles on wet
limestone. Deep midnight blue-green, cool stone silver, restrained golden
candlelight. Spacious architectural editorial photograph with film texture.
No people, text, logos, rings, envelopes, fantasy castles, or collage.

### Dinner photograph

Photorealistic natural, portrait 1024×1536. Intimate close-up of a wedding dinner
setting in a dark glasshouse at night. Slate-blue linen table, silver cutlery,
clear goblets, folded pale sage napkin on white porcelain, olive twigs and white
jasmine, three slender ivory candles in antique silver candlesticks. Olive tree
and bronze glass architecture blurred behind. Night blue teal and silver with
candle warmth, asymmetrical editorial still life, natural tactile textures and
fine grain. No people, words, logos, rings, or envelopes.

### Botanical engraving

Original illustration, portrait 1024×1536. A delicate silver olive branch with
tiny jasmine blossoms, hand-engraved copperplate etching, off-white and pale sage
silver inks, narrow graceful composition growing from bottom left to top right.
Fine hatching and tactile print detail; nineteenth-century botanical specimen
engraving with modern art direction. Dark blue-green background #1c3236, sparse
negative space, no border. No text, lettering, stars, moon, rings, or wreath.

## Rebuilding optimized media

Run from the workspace root with FFmpeg on PATH:

```powershell
node scripts/build-moonlit-media.mjs <opening-source.png> <garden-source.png> <table-source.png> <botanical-source.png>
```

The MP4 uses gentle image motion and a one-second dissolve; its first frame
matches the opening artwork and its final scene continues into the hero garden.
H.264, yuv420p, 720×1080, 30 fps, no embedded audio, and fast-start metadata
support mobile playback. The separate wedding-audio control owns music.

## Higgsfield films (12 November 2026)

Both films were generated with Higgsfield Seedance 2.0 (720p, std, no audio)
from this template's own pictures, then re-encoded with FFmpeg: H.264 High,
yuv420p, 24 fps, no audio track, fast-start. The opening film is 720×1280 and
the template ends it at 5.8 s (`finishAt`). The details loop is 1280×720; the
same picture is its first and last frame, so it loops without a jump. It loads
only near the details section, plays only while visible, and stays a still
poster for reduced motion and Save-Data.

### Opening film prompt (start frame: opening picture, 9:16, 6 s)

Cinematic night opening shot. The two tall bronze-framed glass conservatory
doors slowly swing open inward, revealing the moonlit botanical conservatory.
The camera then glides smoothly forward through the doorway along the long
reflecting pool, between silver olive trees and white jasmine, toward the
pearly full moon. Candle flames flicker softly on wet dark limestone, gentle
ripples on the water, a few fireflies drift. Deep midnight blue-green and
silver with warm gold candlelight. Elegant, slow, dreamy luxury wedding
atmosphere, steady camera, no people, no text.

### Details loop prompt (start and end frame: garden picture, 16:9, 8 s)

Locked-off static camera, no camera movement. A calm living photograph of a
moonlit glass conservatory at night: candle flames flicker gently, soft ripples
shimmer across the reflecting pool and the moon's reflection, white jasmine and
olive leaves sway slightly in a light breeze, thin mist drifts low over the
water, a few tiny golden fireflies float. Deep midnight teal and silver with
warm gold candlelight. Subtle, slow, seamless ambient loop for a website
background. No people, no text.
