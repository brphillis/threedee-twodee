---
"@td2d/viewer": minor
"@td2d/cli": minor
---

Phase 9 web viewer: a library with thumbnails, search, status and tag filters and sorting; a pixel canvas with integer zoom 1x to 32x, pan, backgrounds, a pixel grid, clip-coloured cell outlines, pivots and a hover readout with palette index, drawing only the visible region; an animation player with step, scrub, fps override, loop, ping-pong and once, onion skin and all directions at once; metadata with colour counts, camera, lighting and stage timings; validation with highlighted frames; history and a compare view (side by side, swipe, blink, heat map) whose counts match `td2d compare`; a lazy 3D model view; keyboard shortcuts with a help overlay. Live reload over server-sent events with per-asset change events. New `td2d viewer --no-watch` and `--watch-mode poll`, and `td2d index` to write the viewer as a static site.
