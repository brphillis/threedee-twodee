# Phase 11 notes: hardening, secondary backend, security, performance and release

Status: complete locally on 2026-10-02, apart from the two criteria that need the repository owner: a CI run on GitHub's runners (Windows included) and a published prerelease. Both are set up and checked as far as is possible without the owner's GitHub repository and npm account; see "Not done here" below.

## Acceptance criteria

| Criterion | Evidence |
|---|---|
| A user script that attempts to write outside the allowed path fails with `E_SCRIPT_PERMISSION` and no file is written | e2e "does not let scripts write files, read outside the project, use the network or start processes": a write inside the project, a write outside it, a read outside it, `fetch`, `net.connect`, `http.get`, a child process and a worker thread each fail with exit 3 and `E_SCRIPT_PERMISSION` naming what was denied; afterwards neither target file nor the asset exists, and a local server saw no request. "stops a script that never finishes, and one that runs out of memory" covers the time and memory limits |
| Malformed GLB and traversal fixtures all produce typed errors, never crashes or writes | `packages/core/test/hardening.test.ts`: imports that climb out of the project directly or through a symlink, asset ids that are not paths, a GLB over 50 MB (refused before it is read), plain text, a version 1 header, a truncated file and a wrong first chunk, as imports and for `td2d render --glb` (which then writes nothing), JSON nested past 100 levels or over 8 MB, and preset or palette names that are paths. Each gives a typed error |
| headless-gl passes parity tests on macOS and Linux CI (with xvfb) or is documented as unsupported with a doctor message | `packages/core/test/render/headless-gl.test.ts` renders every golden scene and the starter crate with headless-gl and compares them with the committed goldens at the render tolerance (0.5 percent of pixels). It passes on macOS and in the Playwright Linux image on arm64 and x86_64 under xvfb with Mesa. Without a display it is reported by `td2d doctor` as a skip with the reason and the `xvfb-run` hint. CI has a headless-gl job on Linux under xvfb |
| `npm pack` plus `npm install -g` of the tarball gives a working `td2d doctor` and `td2d generate` on macOS, Linux and Windows | `pnpm pack:smoke` packs the five packages, installs them locally and with `npm install -g` into a temporary prefix, and runs doctor (`--fix` from the global install), init, generate, a recolour and second generate, compare, batch, preview, validate, index, `asset emit` with an SDK script, and the live viewer; then `npx` with the tarballs as its packages runs doctor `--fix`, init and generate. It passes on macOS arm64 and in the Linux image on arm64 and x86_64. CI runs it on ubuntu-24.04, macos-15 and windows-2025; Windows has not been run here (see below) |
| The release workflow publishes a prerelease to npm with provenance from CI | `release.yml` publishes a snapshot under the `next` tag on a manual run, with `NPM_CONFIG_PROVENANCE` and OIDC trusted publishing. Not run: it needs the owner's GitHub repository and npm trusted-publisher setup. A dry run of the same steps passed (below) |

## Tasks

| Task | What was built |
|---|---|
| Sandboxed `asset emit` | The script runs in a child Node process with `--permission`, reads allowed only for the project, the script's directory and the real paths of `@td2d/core` and its dependency closure, no write, child process, worker or addon permission, `--max-old-space-size=512`, a 30 s limit (`--timeout <ms>`), 8 MB of output at most, and the network APIs replaced. The output is parsed as JSON and validated as an asset definition before td2d itself writes it. A denied operation is reported as `E_SCRIPT_PERMISSION` with the permission and the resource |
| Input hardening | Paths through `resolveInside` with symlink resolution, `MAX_IMPORT_BYTES` (50 MB) checked before reading, GLB headers checked before parsing, JSON size (8 MB) and depth (100) limits measured without counting brackets inside strings, and kebab-case preset and palette names. td2d has no archive import, so the zip-slip check has nothing to guard yet; `resolveInside` is the function such an import must use |
| Resource limits | `--timeout <ms>` on every pipeline command stops an asset with `E_ASSET_TIMEOUT` (checked by a timer and between stages), `W_MEMORY_HIGH` after a stage when memory passes the warning level (half the machine's memory, at most 4 GB, or `TD2D_MEMORY_WARN_MB`), and the Phase 8 browser restart on a crash, which is how an out-of-memory browser shows up |
| headless-gl backend | `packages/core/src/render/headless-gl.ts`: the harness scene from the render harness's new Node build on a headless-gl WebGL2 context, `gl@9.0.0-rc.10` as an optional peer dependency, the same `RenderJob` handling, a fingerprint of the `gl` version and the harness source, a `td2d doctor` check, and docs in the rendering and installation guides |
| Profiling pass | Below: the cold benchmark is 34 percent faster measured the same way as Phase 8, and takes 10.7 s with the corrected bench sampler |
| Packaging | `files` lists, the `td2d` bin, the harness bundle and the viewer build inside their packages, no install scripts and no browser download at install, and a README and LICENSE in every package. `pnpm pack:smoke` in CI on all three runners |
| Release workflow | changesets with one shared version, `release.yml` (version pull request, publish on merge, snapshot prerelease on demand) with trusted publishing and provenance, `pnpm run release:check` as its first step, `CHANGELOG.md`, and the version policy in the CI and release guide |
| 1.0 readiness review | Below |

## Profiling

`scripts/profile-stages.ts` runs the benchmark's cold batch once and sums each stage's time over the 20 assets; `node --cpu-prof` on the same script showed where the main thread went. Before the pass, about 4 s of the main thread's 13.9 s went to synchronous file copies, renames, opens and directory work, and the browser sat idle while Node wrote each batch of 16 frames.

| Change | Why |
|---|---|
| The browser renders batch n + 1 while Node writes batch n | Rendering and writing were strictly alternating. Frames are still delivered in sample order, and a sink failure while the next batch is in flight is reported as before (render test) |
| Files are copied as copy-on-write clones (`COPYFILE_FICLONE`) | Cached renders and sprites are copied into stage directories and `build/`. A clone is a metadata update on APFS, Btrfs and XFS and an ordinary copy elsewhere; the files stay independent (unit test) |
| `materialize` copies with one `mkdir` per directory instead of `cpSync` per file | `cpSync` checked paths and changed modes for every file |
| A rerun leaves a stage's build directory in place when every file matches the previous generation record | A warm rerun used to delete and copy every render and sprite. Each kept file is checked against the record's size and SHA-256, so a file changed by hand is still repaired (render test) |
| Sprites are encoded once | The pixel stage encoded each sprite for the item cache and again for the stage directory |
| Renders are written at PNG level 6, not 1 | The roadmap's "6 for intermediates". On the benchmark's 128 x 192 renders level 6 writes 1.3 KB a frame against 3.0 KB at level 1 for 0.07 ms more; level 9 saves another 0.2 KB for 0.55 ms more. Sprites stay at 6 and sheets at `export.png.compressionLevel` (9 by default) |
| The harness encodes frames with the native `Uint8Array.prototype.toBase64` | Building the string by hand had cost about 1.3 ms of every 2.7 ms frame in the browser |
| `td2d batch` defaults to cores minus one, at most 4 | See "Deviations" |

The benchmark's memory sampler ran `ps` synchronously every 250 ms. On macOS `ps` is slow enough that this blocked the batch's own event loop: a warm rerun measured 2.3 s on macOS and 0.3 s in the Linux container. It now samples asynchronously. The first table compares like with like, using the Phase 8 harness before the sampler fix and before the build directory reuse; the second is the corrected harness with every change, which is what `docs/roadmaps/assets/phase-11/bench.json` holds.

Apple M5, 10 cores, 32 GB, macOS, Node 24.3. Raw numbers: `docs/roadmaps/assets/phase-8/bench.json`, `docs/roadmaps/assets/phase-11/bench-phase8-harness.json` and `docs/roadmaps/assets/phase-11/bench.json`.

| Run (Phase 8 harness) | Phase 8, concurrency 2 | Phase 11, concurrency 2 | Phase 11, default (4) |
|---|---|---|---|
| Cold, 2880 samples | 20.2 s | 14.9 s (26 % less) | 13.4 s (34 % less) |
| Warm rerun | 2.8 s | 2.3 s | 2.3 s |
| Clip edit, 640 rendered | 11.3 s | 9.8 s (13 % less) | 9.0 s (20 % less) |
| One 512-sample asset | 4.9 s | 3.4 s (31 % less) | 3.4 s |
| Peak td2d memory | 530 MB | 534 MB | 525 MB |

| Run (corrected harness) | Phase 11, default (4) |
|---|---|
| Cold | 10.7 s, 269 samples a second |
| Warm rerun | 0.7 s |
| Clip edit | 7.6 s |
| One 512-sample asset | 3.4 s, 476 MB |
| Peak td2d memory, browser memory | 569 MB, 94 MB |

The clip edit improved less than the cold run: it renders 640 samples, but the sheet, validation and export stages run again over all 2880 sprites of every edited asset, and those were not the bottleneck the pass removed. Lane counts were measured at 2, 3, 4 and 9 (cold, Phase 8 harness, before the build directory reuse): 14.8, 13.3, 13.4 and 13.1 s, with peak memory rising from 518 to 585 MB.

## Q12 and Q13

- **Q12: Node's permission model with pnpm's symlinked `node_modules`.** Node 24's `--allow-fs-read` takes paths, not globs, and checks the real path of every file it opens. pnpm's `node_modules` entries are symlinks into `node_modules/.pnpm`, so allowing `node_modules` alone denies every import. td2d allows the real path of `@td2d/core` and of each package in its dependency closure (`scriptReadAllowlist`), plus the project and the script's directory. The e2e tests run scripts from the workspace and from a project outside it, and `pnpm pack:smoke` runs one from an npm install, local and global. A project with no `@td2d/core` of its own, as after `npm install -g`, could not import the SDK at first (found by the smoke test); the runner now falls back to the running td2d's copy through a resolve hook that runs in the script's thread, since workers are denied. Node 24 has no network permission, so the script runner replaces the `net`, `tls`, `http`, `https`, `http2`, `dgram` and `dns` APIs and `fetch`, `WebSocket` and `EventSource` before the script loads, and reports a use as `E_SCRIPT_PERMISSION`. That replacement is a guard against accidents, not a security boundary: native addons are denied, but a script could still reach the network through a path the replacement does not cover. The models guide says so: the limits catch mistakes in scripts you or your agent wrote and are not a boundary against deliberately hostile code.
- **Q13: headless-gl 9 coverage of what the harness uses.** The harness needs a WebGL2 context with a depth buffer, GLSL 3 shaders including skinning, alpha, and `readPixels` from the default framebuffer; it uses no render targets or depth textures. `gl@9.0.0-rc.10` provides all of these through ANGLE. Every golden scene matches within the tolerance on macOS and on Linux under xvfb with Mesa: at most 8 of 36,864 pixels (0.022 percent) differ. headless-gl reports its renderer only as "ANGLE", so which graphics stack ANGLE used underneath is not recorded. Without an X display on Linux it cannot create a context; td2d now checks `DISPLAY` first, because the native module otherwise prints its error straight to stderr, where td2d's NDJSON progress goes (found by the Linux e2e run).

## Release dry run

In a scratch copy of the repository with its own git history: `changeset status` planned a minor bump for all five packages from the pending changesets, `changeset version --snapshot next` set them all to `0.0.0-next-20261002124028` with internal dependencies pinned to that version, the build passed, and `pnpm -r publish --dry-run --no-git-checks --tag next` packed all five for `registry.npmjs.org` without publishing. The packed `@td2d/cli` has the `td2d` bin, `dist` and `src`, and exact versions of its siblings.

The dry run showed that no package declared `repository`, which npm provenance requires to name the repository the workflow runs in; a real publish would have been rejected. `pnpm run release:check` now runs first in `release.yml` and fails with the exact `repository` entry to add. Once the repository was created at `github.com/brphillis/threedee-twodee` (2026-10-03), every package got its `repository`, `homepage` and `bugs` fields, and the check passes for that repository.

## Linux

In the Playwright Linux image (v1.63.0, Ubuntu 24.04) on arm64 and on x86_64 under emulation, with Mesa, xvfb, zsh and fish installed as CI installs them: the full suite, the headless-gl parity test under `xvfb-run`, `pnpm run release:check`, `pnpm pack:smoke` and, on arm64, the benchmark.

| Check | arm64 | x86_64 (emulated) |
|---|---|---|
| Full suite | 615 passed, 4 skipped | 614 passed, 4 skipped, 1 failed |
| headless-gl parity under xvfb | Passes | Passes |
| Render goldens | All 9 byte-identical with macOS; headless-gl at most 8 of 36,864 pixels off | Same |
| `pnpm run release:check` | Passes | Passes |
| `pnpm pack:smoke` (local, `npm install -g`, npx) | Passes | Passes |

The 4 skipped tests are the headless-gl parity tests, which need a display and run in the xvfb step instead. The one x86_64 failure is the Phase 1 speed test, "64 frames at 128 x 128 in under 3 seconds including browser start": 3.5 to 3.9 s in four emulated runs, against 0.8 s natively on arm64. CI's x86_64 runners are native.

The benchmark on arm64 in the container (10 cores, 16 GB, Node 24.20, corrected harness):

| Run | Time | Peak td2d memory |
|---|---|---|
| Cold, 2880 samples | 10.0 s | 509 MB |
| Warm rerun | 0.2 s | 509 MB |
| Clip edit | 3.3 s | 517 MB |
| One 512-sample asset | 2.8 s | 457 MB |

The Linux runs found four problems, all fixed:

- **headless-gl wrote to stderr.** On Linux without a display, `td2d doctor`'s probe let the native module print an error into the NDJSON progress stream; the probe and the backend now check `DISPLAY` first (Q13).
- **The zsh completion test needed zsh.** It now runs wherever zsh is installed and always on CI.
- **A key-press race in the viewer browser tests.** Under emulation a test pressed a shortcut before the component's listener was registered, which React does in an effect after the render. The test helper now sends a key until a handler takes it, which handlers show by calling `preventDefault`, so each press still counts once.
- **The development install needed a C++ toolchain.** `gl` was a devDependency of `@td2d/core`, and on Linux arm64 there is no prebuilt binary for Node 24, so `pnpm install` failed in a container without a compiler. It is now an optional dependency of the private workspace root, which pnpm skips when it cannot be built; the published packages never install it (npm installs neither devDependencies nor optional peers), and the pack-and-install smoke test passes in that container.

## Decisions

- **Scripts write nothing.** The roadmap gave the script write access to its output file. Instead the script has no write permission at all: it prints the definition, and td2d validates it and writes the file. A script cannot overwrite a different file even by naming the output path.
- **The optional backend is lazy.** `gl` is loaded only when the headless-gl backend is used or probed, so a missing or broken `gl` never affects the default backend. Its fingerprint includes the `gl` version and a hash of the harness source, so frames from the two backends never share cache entries.
- **The bench writes to `build/bench.json`** unless `BENCH_OUT` says otherwise, so a local run never overwrites a phase's recorded numbers; the CI and nightly workflows upload `build/bench.json`.
- **The release preflight is a tested library** (`scripts/lib/release.ts`): one shared version, the `@td2d` scope, MIT with a LICENSE file, a `files` list, a README, and in GitHub Actions a `repository.url` naming `GITHUB_REPOSITORY`.

## Deviations

- **Batch concurrency.** Section 9.1 proposed a default of cores minus one. Every asset shares one browser, which renders one asset at a time, so extra lanes only overlap pixel and sheet work: 3 lanes ran the cold benchmark in 13.3 s and 9 lanes in 13.1 s with 11 percent more memory. The default is cores minus one, at most 4.
- **`npx td2d`** is tested with the tarballs as npx's packages (`npx --package=<tarball> ... td2d`), the closest test possible before the packages are on the registry.
- **The zsh completion test** now runs wherever zsh is installed and always on CI, which installs it; before, it failed on a Linux machine without zsh.

## Not done here

- **CI on GitHub's runners.** Done on 2026-10-03, after these notes were first written: on commit `19578a5` of `github.com/brphillis/threedee-twodee`, every CI job passed, including pack-and-install on windows-2025. The first push found two problems a clean checkout exposes: the `history/` ignore pattern had also ignored `packages/core/src/history/`, and the release workflow lacked zsh for the completion test. The release workflow's tests pass; its "Version packages" step waits for the repository setting that lets Actions open pull requests (CI and release guide).
- **Windows.** No Windows machine was available here; the pack-and-install smoke test passes on GitHub's windows-2025 runner.
- **Publishing.** No prerelease or 1.0.0 has been published: that needs the owner's npm account and the trusted-publisher setup, and is an outward-facing step for the owner to take.

## 1.0 readiness review (section 21)

| Criterion | State |
|---|---|
| Phases 0 to 11 done per section 20 | Done: CI passes on every configured runner (2026-10-03) |
| `npx td2d init`, `doctor --fix`, `generate`, `batch`, `preview`, `compare`, `viewer` from a published package on macOS, Linux and Windows | From the packed tarballs, installed with npm locally and globally and run through `npx`: passes on macOS, Linux (arm64 and x86_64) and Windows (CI). Not yet from the registry |
| The pipeline runs without the viewer, and the viewer presents section 10.2 without the CLI running | Done: every e2e pipeline test runs without the viewer; `td2d index` writes a static viewer, tested in the browser from a plain static file server |
| No MCP server or external 3D application required | Done |
| All examples regenerate on CI and match their expected manifests; sprite goldens match within policy | Done: the example regeneration tests compare every committed expected file, on CI and locally, and the render goldens are byte-identical on macOS and Linux arm64 and x86_64 |
| Same-machine regeneration byte-identical; cross-OS raw render drift within 0.5 percent and documented | Done: identical across separate browser launches, and the raw goldens are byte-identical across macOS and both Linux architectures (rendering guide) |
| Agent workflow test passes and a fresh-session transcript reaches a validated sheet in under ten commands | Done in Phase 10 (8 commands) |
| Every error code has a catalogue entry, every command an example, every registry is introspectable | Done: 42 errors and 24 warnings (Phase 11 added `E_SCRIPT_PERMISSION`, `E_ASSET_TIMEOUT` and `W_MEMORY_HIGH`), 31 commands, `td2d describe` |
| Security negative tests and the licence allowlist pass | Done |
| The Phase 8 benchmark meets its targets and is tracked nightly | Meets them (10.7 s cold against 240 s, 569 MB against 1 GB, 476 MB for the large asset against 500 MB); `nightly.yml` runs it with `bench-check`, not yet on GitHub |
| Documentation complete, no stale generated pages or broken links | Done: `pnpm docs:check` and the staleness tests |
| `CHANGELOG.md` and 1.0.0 published with provenance | `CHANGELOG.md` is written; publishing is the owner's step |

### Open defects

| Defect | Severity | Triage |
|---|---|---|
| The network replacement in `asset emit` is not a security boundary | Medium | Documented; scripts are code the user chose to run. A real boundary needs a network permission in Node or an OS sandbox |
| headless-gl output depends on the machine's graphics stack | Low | By design and documented; the backend warns with `W_HARDWARE_RENDERER` |
| The 64-frame render speed test can miss its 3 s budget under x86_64 emulation | Low | 3.5 to 3.9 s under emulation, 0.8 s natively on arm64; CI's x86_64 runners are native |
| Packages could not be published without a `repository` | Fixed | Every package names `github.com/brphillis/threedee-twodee`; `release:check` keeps it that way |
| `meta.app` in the Aseprite, PixiJS and Phaser data is `td2d` without the URL the roadmap asked for | Low | Phase 7 left the URL for this phase's release, but there is still no public URL. Adding one changes every exported file, so it belongs with the first release that has one, with the exporter versions bumped |
