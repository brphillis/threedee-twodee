# Phase 8 notes: caching, selective regeneration, batch generation and parallelism

Status: complete locally on 2026-10-02.

## Acceptance criteria

| Criterion | Evidence |
|---|---|
| Editing one clip key in the knight example reruns only the affected samples | render test "rerenders only the samples whose pose a clip edit changed": after editing the attack key at 0.3 s, 16 samples render (the frames at 0.3 s and 0.4 s in 8 directions) and 176 come from the item cache; the pixel stage processes the same 16 |
| `td2d batch --filter 'props/*' --continue-on-error` with one broken asset exits 6, reports the failure with its code and leaves the other outputs intact | e2e test: exit 6, `E_BATCH_PARTIAL`, report status `partial` with the broken asset's `E_ASSET_INVALID`, and every other sheet on disk; `--resume` then runs only the fixed asset |
| SIGINT during a batch exits 130 within 3 seconds, leaves no browser or worker processes, and the next run completes without manual cleanup | e2e test: SIGINT during the first render, exit 130 well within 3 s, no process carrying the run's `--td2d-run` tag, report status `cancelled`; the next batch exits 0, `.td2d/tmp` is empty and no `.partial` directory remains. Worker threads end with the process. |
| Benchmark: 2880 samples in under 4 minutes with peak RSS under 1 GB | `pnpm bench`: 20.2 s, td2d at most 514 MB, the browser at most 93 MB (table below) |
| `cache clean --older-than 1d` removes only entries older than a day | unit test with faked modification times; e2e test of the command |

## Decisions

- **Samples are keyed by their posed geometry.** The roadmap keyed a sample on the model hash and the clip time. The baked animation changes whenever any key of a clip changes, so that key would rerender every frame of the clip. The plan stage hashes the vertices of every pose instead (`PlanData.poses`), and a sample's key combines that hash with the scene, yaw, materials, lighting and backend. Frames whose pose did not change are reused, even across clips: two clips that share a pose share its render.
- **Fitted scales still invalidate everything.** `pixelsPerUnit: "auto"` and `groundMargin: "auto"` depend on every pose. An edit that changes a clip's reach can change the fit and so every sample; the first version of the clip-edit test showed exactly this with the knight. The guide says to fix both while iterating on animation.
- **Sprites are cached per frame unless the palette is automatic.** An automatic palette is built from all frames, so those sprites are processed as a set.
- **Restored items are copied, not decoded.** Profiling a clip edit showed most time going to decoding and re-encoding cached PNGs. Each item now has a small `.json` sidecar (coverage, colour count, cleanup counts), and the export stage decodes sprites only for the GIF preview. A 20-asset clip edit went from 13.3 s to 11.3 s; an item format version in the keys keeps old sidecars from matching.
- **One browser, serialised.** Concurrent assets share one backend whose renders run one at a time, and one piscina pool (up to 4 threads) for pixel processing and sheet compositing. Jobs under 48 frames run inline, since starting a thread costs more than it saves.
- **Concurrency bugs found and fixed by the SIGINT test.** Two assets with the same model (the knight and the packed knight) wrote to the same temporary stage directory, and two commits of the same cache entry raced. Temporary stage directories are now unique per run, and a commit that loses the race keeps the winner's entry.
- **Crash recovery.** A page crash or an unexpected browser disconnect is `E_BACKEND_CRASHED`; the render stage restarts the browser once and renders the asset again with `W_BACKEND_RESTARTED`. A test crashes a real renderer with `chrome://crash`.
- **No partial outputs.** New build files are staged in `build/<id>/.partial/` and moved into place entry by entry; each run's temporary directory records its process id, and later runs remove those whose process has gone.
- **LRU by use time.** Reading a stage entry or an item touches its file, `cache clean` removes the least recently used first, and `index.json` lists every entry with its size and last use. After each run the cache is pruned to `cache.maxSize` (default 5 GB) with `W_CACHE_PRUNED`.
- **Frame filters complete from the cache.** With `generate`, a filter says which samples may render; any other sample must be in the cache or the run fails with `E_PARTIAL_PLAN` (exit 2). `td2d render` keeps its Phase 6 behaviour: a partial render that stops at the render stage.
- **Results report item counts.** `td2d generate --json` and the batch report show samples rendered and reused and sprites processed and reused.

## Deviations

- Worker progress is reported per chunk of 32 frames, not per frame, which is as often as a chunk finishes.
- Workers are threads (`worker_threads` through piscina), so "no worker processes" is checked as no process left at all after exit.

## Measurements

`pnpm bench` on an Apple M5 with 10 cores and 32 GB, Node 24.3, concurrency 2 (raw numbers in `docs/roadmaps/assets/phase-8/bench.json`):

| Run | Wall time | Samples rendered | Samples reused | Stage cache hits | td2d peak | Browser peak |
|---|---|---|---|---|---|---|
| Cold: 20 characters x 8 directions x 3 clips x 6 frames | 20.2 s | 2880 | 0 | 0% | 514 MB | 93 MB |
| Warm rerun, nothing changed | 2.8 s | 0 | 2880 | 100% | 514 MB | 0 MB |
| One key of one clip edited in all 20 | 11.3 s | 640 | 2240 | 11% | 530 MB | 89 MB |
| One asset of 512 samples, own process | 4.9 s | 512 | 0 | | 470 MB | |

That is 142 samples per second cold, and 470 MB for a 512-sample asset against the 500 MB target.

| Measurement | Value |
|---|---|
| Tests | 483 across unit, render, harness and e2e projects, plus 7 experiments |

## Linux

The render, harness, pipeline and example suites (59 tests) pass in the Playwright Linux image on arm64 and on x86_64 under emulation. All 9 harness goldens match exactly on both, and every exported file of every example regenerates byte for byte against the outputs recorded on macOS.

The first arm64 run crashed with SIGSEGV in a worker thread. The sheet layout module imported sharp for its bounds helpers, so sharp was loaded inside piscina workers, and sharp's native module is not safe to load in worker threads on Linux arm64. The bounds helpers moved to a module with no sharp import (`packages/core/src/pixel/bounds.ts`), and `packages/core/test/workers.test.ts` now walks the worker's import graph and fails if it reaches sharp.
