# Phase 9 notes: web viewer

Status: complete locally on 2026-10-02.

## Acceptance criteria

| Criterion | Evidence |
|---|---|
| Every feature in section 10.2 is present and covered by at least one automated test | Feature table below: each row names its tests |
| Regenerating an asset while the viewer is open updates the library within 1 second | e2e "updates the library within a second of a regeneration": the knight's card changes 2 ms after `td2d generate` exits and 55 to 59 ms after its newest output file was written (three runs); the test fails above 1000 ms |
| Playback at 10 fps advances exactly 10 frames per second within 5 percent over 5 seconds (fake timers) | Browser test "advances exactly 10 frames per second within 5% over 5 s of fake time" runs the animation tab on faked `requestAnimationFrame` and clock; the Node unit test runs the same loop on a faked 60 Hz timer and on an irregular 8 to 33 ms display. Both allow 47.5 to 52.5 frames |
| Static mode serves the same SPA from a plain file server with `index.json` | e2e "serves the same viewer as a static site written by td2d index": a Node `http` server with no API routes and no fallback page; library, sheet, compare (with history copies) and the 3D view all work, and the page reports `static` |
| Viewer bundle under 600 KB gzipped excluding the lazy 3D route | e2e bundle test walks the Vite manifest from the entry through its static imports: 87.7 KB of JavaScript and 2.7 KB of CSS gzipped. three.js is only in the lazy chunk (158 KB gzipped), checked by a glTF extension name that survives minification |

### Features and their tests

| Area | Feature | Tests |
|---|---|---|
| Library | Grid and list, thumbnails of the first cell of the first clip | browser `Library` (thumbnail size, `v`), e2e navigation |
| | Search, status filter, tag filter, sort, last generated time | browser `Library`, unit "library filters" (search words, sorts, ages) |
| Sprite view | Canvas with nearest-neighbour drawing, integer zoom 1x to 32x, fit | unit "zoom and pan maths", browser "fits the image", "zooms with the wheel about the cursor" |
| | Pan by dragging | browser "selects the clicked overlay and pans on drag without selecting" |
| | Backgrounds: checker 8 and 16, solid colours, custom colour | browser `SheetView` (`b`), settings persisted per browser |
| | Pixel grid above 8x | browser "draws the pixel grid only above 8x" |
| | Cell boundary overlay | browser `SheetView` (`c`), e2e sheet |
| | Hover readout: x, y, hex, alpha, palette index | browser "reads out the hovered pixel", e2e sheet |
| | Draw only the visible region (risk: 4096 px sheet) | browser "draws only the visible region of a 4096 px sheet at 32x": every draw covers at most 21 x 16 source pixels and takes under 50 ms; unit `visibleRegion` |
| Sheet view | Frame rectangles, click to select, tag (clip) colour coding, pivots, sheet pages | browser `SheetView`, e2e sheet |
| Animation | Play, pause, step, scrub | browser "steps, scrubs and pauses", e2e "plays the walk cycle" |
| | fps override, loop, ping-pong, once | browser "overrides fps and plays a once-only clip to its last frame", unit "orders frames for loop, ping-pong and once" |
| | Direction selector | browser (`[` and `]`), e2e |
| | Onion skin of the previous frame | browser "draws an onion skin" |
| | 8-direction simultaneous playback | browser "plays all eight directions at once in a compass grid", e2e |
| Metadata | Frame size, pivot, clip table, camera and lighting, stage hashes and timings | browser `MetadataTab`, e2e metadata (9 stages) |
| | Palette swatches with usage counts computed client-side | browser `MetadataTab` checks every count against the fixture's pixel rule; unit `countColours` |
| Validation | Check list with level, affected frames highlighted | browser `ValidationTab`, e2e validation |
| History | Generation list per asset, select two to compare | browser `HistoryTab`, e2e history |
| Compare | Side by side, swipe, blink, heat map, changed pixel count and stats | browser `CompareTab` (exactly 3 changed pixels in the fixture, every mode, `k`), e2e compare: the count equals `td2d compare --json` (7077 pixels in 192 sprites after a tabard colour change) |
| 3D preview | `model.glb` in an orbit view with the harness materials, lazy loaded | e2e "loads model.glb into the 3D view" (23 meshes, clip playback), static mode, bundle test |
| Keyboard | Shortcuts and a help overlay | browser `HelpOverlay` lists every shortcut, unit "has no key bound twice", e2e tab keys, `?` and `Escape` |
| Live reload | SSE, 100 ms debounce, cache invalidation | unit `debounce` (fake timers), "streams a hello and then one debounced change event", `ViewerState`, `watchBuild` native and poll |

## Q11: `fs.watch({ recursive: true })` on Linux and in Docker

`node scripts/q11/run.ts` runs the viewer's watcher in the Playwright Linux image (`mcr.microsoft.com/playwright:v1.63.0-noble`) on arm64 and on x86_64 under emulation, with OrbStack 29.4 on macOS as the Docker host. Results are in `docs/roadmaps/assets/phase-9/q11.json`.

Latency until the change event, in the recorded run (arm64, then x86_64). Four earlier runs also noticed every change, with native latencies within 20 ms of these; polled host writes ranged from 114 to 330 ms across all runs, depending on where in the 200 ms polling interval the write fell.

| Scenario | native | poll |
|---|---|---|
| Container directory, written in the container | 102, 114 ms | 126, 139 ms |
| New asset directories made after the watch started | 102, 106 ms | 116, 118 ms |
| A file in a directory made after the watch started | 103, 101 ms | |
| Bind mount, written in the container | 101, 111 ms | 119, 117 ms |
| Bind mount, written on the host | 116, 123 ms | 317, 330 ms |

Latencies include the 100 ms debounce. Node 24's recursive watcher on Linux picks up directories created after it starts, and OrbStack forwards host file events into bind mounts. **Answer: native watching is reliable on Linux and in these Docker setups, so it stays the default.** Polling is kept behind `--watch-mode poll` for mounts that deliver no events at all, which were not available to test (network file systems, and Docker hosts that do not forward events); there it notices a change within one 200 ms polling interval plus the debounce.

On macOS, FSEvents also reports changes made shortly before a watch began, including the watched directory itself. The watcher maps those to a full reload, and the unit test lets them settle before it counts events.

One arm64 run failed to load the container script right after the script had been edited on the host; the error came from Node's module loader. Three later runs on both architectures passed every scenario. The cause was not established; a stale read through the bind mount is the likely one.

## Decisions

- **Hash routing.** `#/` is the library and `#/asset/<id>/<tab>?a=..&b=..&mode=..` an asset. It works from any static host without rewrites, and ids are encoded as one segment, with plain slashes accepted when typed by hand.
- **Server and static data share one index builder.** `buildIndex`, `assetDetail` and `historyDetail` take a URL scheme: `/files/build/` and `/files/history/` for the server, paths relative to the page for the static site.
- **The page finds its mode by probing `api/index`.** A JSON answer means the td2d server; anything else (a 404, or an HTML page from a host that answers every path) means the static files.
- **Static site layout.** `td2d index` writes into `build/` by default, as section 9.2 says, adding `index.html`, `index.json` and one `_td2d/` directory (the app, per-asset JSON, history copies). Vite emits its files under `_td2d/app` so nothing collides with asset ids. It only replaces an `index.html` carrying the viewer's generator tag, and `--out` copies the outputs it needs to another directory.
- **Index cache.** While watching, the index is cached and dropped on every change event; without a watcher it is rebuilt for each request.
- **Changes are reported per asset.** The watcher maps a changed path to the nearest directory holding td2d's `.td2d-output` marker or a manifest, ignores `.partial` staging and `.tmp` files, and sends one event per 100 ms burst. An open asset reloads only when it is among the changed ids. After a dropped stream reconnects, the page reloads in case it missed events.
- **One canvas component.** The sheet, history, validation and single-direction animation views share `PixelCanvas`, which keeps an integer zoom and a whole-pixel pan and draws only the visible region. Small fixed-zoom sprites (thumbnails, the direction grid, compare panes) use a plain canvas.
- **Exact playback timing.** A `FrameClock` turns elapsed time into whole frames and carries the remainder, so the rate holds on any refresh rate; a gap over a second (a background tab) counts as one frame.
- **Compare works on sprites, not sheets.** Every cell of both generations is rebuilt at frame size, so layout changes do not matter. The headline count is exact RGBA differences, with fully transparent pixels equal; it matches `td2d compare`, which counts pixelmatch differences at threshold 0, as the e2e test checks.
- **History entries identical to the current build** are marked, and compare defaults to the newest entry whose export hash differs from the current one (from `generation.json`: the manifest cannot carry its own export hash).
- **3D preview.** three.js, `GLTFLoader` and `OrbitControls`, with `td2dMaterial` and `materialFromSpec` from the render harness applied the way the harness does, and the asset's lights. Camera-space lights follow the orbit azimuth.
- **Shortcuts in one table** (`lib/shortcuts.ts`) drive both the handlers and the help overlay; a unit test checks no key is bound twice among scopes that are active together.
- **Errors.** A port in use is `E_USAGE` with a `--port 0` hint instead of an internal error.

## Deviations

- The Phase 9 approach said "plain CSS modules"; the viewer uses one plain stylesheet, as the stack table in section 4.6 says.
- `--watch-mode poll` replaces the unnamed "server option" for the chokidar fallback.
- The 1 second live reload is measured from the CLI's exit and from the newest output file's modification time; the page cannot observe the moment a regeneration starts.

## Testing

- Unit (Node): 14 server tests (routes, path safety, history, SSE, cache, static site), 7 watcher tests and 23 tests of the client's pure modules (zoom and pan, playback, palette, library, routes, cells, diff, shortcuts).
- Browser (Vitest browser mode, Chromium with SwiftShader): 21 component tests against a generated fixture build with known pixels, a history entry with exactly three changed pixels, and a 4096 px sheet.
- E2E (Playwright): 10 tests against the knight from `examples/characters`, including static mode, the bundle budget, `--no-watch` and a busy port. `TD2D_DOCS_IMAGES=1` writes the guide's screenshots.

Under a full parallel suite, real `requestAnimationFrame` in the browser test iframe can stall for over a second after a mount. The real-time playback test therefore samples until it has seen every frame instead of within a fixed window, and the large-sheet test times each draw call rather than the whole mount. The exact rate is checked under fake timers, where stalls cannot occur.

## Measurements

| Measurement | Value |
|---|---|
| Main bundle, gzipped | 87.7 KB JavaScript, 2.7 KB CSS |
| Lazy 3D chunk, gzipped | 158 KB |
| Library update after regeneration | 2 ms after the CLI exits, 55 to 59 ms after the newest output file |
| Watch latency in Docker (Q11) | 101 to 123 ms native; 116 to 139 ms polling, 317 to 330 ms polling host writes |
| Tests | 555 across all projects (65 viewer unit and browser tests and 10 viewer e2e tests are new), plus 7 experiments |

## Linux

In the Playwright Linux image on arm64 and on x86_64 under emulation, the render, harness and viewer browser projects pass (81 tests, including the 21 viewer component tests), and so do all 10 viewer end-to-end tests: live reload, compare counts matching `td2d compare`, static mode and the bundle budget. The first arm64 run caught a timing-dependent onion-skin test, which now waits for the frames to load and compares the distinct canvases drawn rather than the number of draw calls.
