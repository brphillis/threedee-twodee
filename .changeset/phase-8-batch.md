---
"@td2d/schema": minor
"@td2d/core": minor
"@td2d/cli": minor
---

Phase 8 caching, batch generation and parallelism: every rendered sample and processed sprite is cached on its own, keyed by its posed geometry, so editing a clip rerenders only the frames whose pose changed. `td2d generate --frames/--clips/--directions` renders a subset and restores the rest from the cache (`E_PARTIAL_PLAN` when it cannot). New `td2d batch` with `--filter`, `--manifest` (per-asset overrides), `--concurrency`, `--continue-on-error` (exit 6), `--fail-fast` and `--resume`, writing `build/batch-report.json`; one shared browser and a worker pool for pixel processing and compositing. Cancellation exits 130 and leaves no partial files; a crashed browser restarts once (`W_BACKEND_RESTARTED`). New `td2d cache stats|clean`, `cache.maxSize` with automatic pruning (`W_CACHE_PRUNED`), `td2d compare`, and `pnpm bench`.
