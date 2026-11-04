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
| opening.webp | Opening-screen picture and video poster | Original generated architectural photograph |
| garden.webp | Hero and closing picture | Original generated architectural photograph |
| table.webp | Details-page supporting picture | Original generated editorial photograph |
| botanical.webp | Schedule decorative artwork | Original generated engraved botanical illustration |
| thumbnail.webp | Separate event-picker thumbnail | Optimized landscape crop of the new garden picture |
| opening.mp4 | Actual five-second opening film | FFmpeg camera move + dissolve between opening and garden |
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
