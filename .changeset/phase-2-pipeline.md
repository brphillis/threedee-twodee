---
"@td2d/schema": minor
"@td2d/core": minor
"@td2d/cli": minor
"@td2d/viewer": minor
---

Phase 2 end-to-end pipeline: `td2d generate` builds primitive models, renders every direction, makes binary-alpha sprites, lays out a grid sheet, validates it and exports Aseprite JSON and a manifest. Stages are cached by content, so a colour change reuses geometry. Adds `inspect`, `preview`, `history list`, `model build`, `model inspect`, `render <id>` and a read-only `viewer`. The camera ground margin now defaults to `"auto"`, fitted to the model's footprint.
