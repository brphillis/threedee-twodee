---
"@td2d/schema": minor
"@td2d/core": minor
"@td2d/cli": minor
---

Phase 1 rendering: a three.js harness rendered in Playwright's Chromium headless shell with SwiftShader, the `td2d render --glb` command, a rendering check in `td2d doctor`, and frame warnings for blank or clipped frames. The `dimetric` camera preset now uses a 30 degree pitch, which is what produces 2:1 pixel lines.
