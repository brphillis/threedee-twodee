---
"@td2d/schema": minor
"@td2d/core": minor
"@td2d/render-harness": minor
"@td2d/cli": minor
---

Phase 11 hardening, the headless-gl backend, performance and release: `td2d asset emit` runs scripts under the Node permission model with reads limited to the project and the SDK, no file writes, child processes or worker threads, the network APIs blocked, 512 MB of heap, a 30 s limit (`--timeout`) and 8 MB of output, reporting `E_SCRIPT_PERMISSION` with what was denied; a script's `@td2d/core/sdk` import falls back to the running td2d, so scripts work with a global install. GLB files are size-limited and their headers checked before parsing, JSON documents are limited in size and nesting depth, and preset and palette names cannot be paths. Pipeline commands take `--timeout` (`E_ASSET_TIMEOUT`) and warn with `W_MEMORY_HIGH` (`TD2D_MEMORY_WARN_MB`). New optional `headless-gl` backend (install `gl` next to td2d; on Linux run under `xvfb-run`), checked by `td2d doctor`. Generation is about a third faster: the browser renders the next batch while frames are written, cached files are copied as clones where the file system supports it, sprites are encoded once and renders use PNG level 6, a rerun leaves build directories that already match the generation record in place, and `td2d batch` defaults to one fewer than the cores, at most 4. Every package ships a README and LICENSE.
