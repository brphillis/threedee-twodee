# threedee-twodee (`td2d`): 3D-to-2D Sprite Generation Tool Roadmap

Status: Phases 0 to 11 implemented and verified locally on macOS and Linux (notes in [docs/roadmaps](docs/roadmaps)). The repository is at [github.com/brphillis/threedee-twodee](https://github.com/brphillis/threedee-twodee). CI passes on every runner, Windows included. Not yet done, because each needs the repository owner: the repository setting that lets Actions open the release pull request, the npm trusted-publisher setup, and publishing (see [phase 11 notes](docs/roadmaps/phase-11.md)). This document is the implementation source of truth.
Last updated: 2026-10-02.

This document was written before implementation began. Commands, files, schemas and snippets in it, especially those marked `(proposed)`, show the intended shape; the phase notes in [docs/roadmaps](docs/roadmaps) record what was built and where it differs.

---

## Table of contents

1. [Project overview and goals](#1-project-overview-and-goals)
2. [Scope and non-goals](#2-scope-and-non-goals)
3. [Greenfield assumptions](#3-greenfield-assumptions)
4. [Research findings](#4-research-findings)
5. [Technology decisions and rationale](#5-technology-decisions-and-rationale)
6. [Proposed architecture](#6-proposed-architecture)
7. [Proposed repository structure](#7-proposed-repository-structure)
8. [Initial asset and metadata conventions](#8-initial-asset-and-metadata-conventions)
9. [CLI design](#9-cli-design)
10. [Web viewer design](#10-web-viewer-design)
11. [Claude Code workflow](#11-claude-code-workflow)
12. [End-to-end milestone](#12-end-to-end-milestone)
13. [Phased implementation roadmap](#13-phased-implementation-roadmap)
14. [Testing and quality strategy](#14-testing-and-quality-strategy)
15. [Performance and reliability strategy](#15-performance-and-reliability-strategy)
16. [Documentation strategy](#16-documentation-strategy)
17. [Risks and mitigations](#17-risks-and-mitigations)
18. [Future extensibility](#18-future-extensibility)
19. [Security and operational safeguards](#19-security-and-operational-safeguards)
20. [Definition of done](#20-definition-of-done)
21. [Final project completion criteria](#21-final-project-completion-criteria)
22. [Technical references](#22-technical-references)

---

## 1. Project overview and goals

`td2d` is a CLI-first tool that turns declarative 3D asset definitions into production-ready 2D pixel-art sprites and sprite sheets. Its primary operator is Claude Code. A human-facing web viewer exists for inspection, comparison and review, but it is never required to generate anything.

### Goals

- **Complete pipeline through one CLI.** Define, build, render, pixelate, pack, export, validate, inspect and regenerate without leaving the terminal.
- **Declarative, schema-validated inputs.** Every asset is a JSON document with a published JSON Schema, so Claude Code can author and edit it with ordinary file tools and get precise validation errors back.
- **Reproducible output.** The same inputs on the same backend produce byte-identical output. Across backends and operating systems, output is stable within a documented tolerance.
- **Fast iteration.** Content-addressed stage caching means a material tweak rebuilds only the stages that depend on it.
- **Extensible core.** Model part types, render backends, pixel processing passes, sheet layouts and export formats are registries behind stable interfaces.
- **Production reliability.** Meaningful exit codes, structured errors, partial-failure reporting for batches, cancellation, and automated validation of every output.

### Guiding principles

1. The CLI is authoritative. The viewer only reads what the CLI wrote.
2. Files, not databases. A project is a directory tree of JSON and PNG files.
3. Declarative before imperative. Assets are data; an optional TypeScript SDK emits that same data.
4. Validate high-risk assumptions first. Headless rendering and reproducibility are proven in the first two phases, before feature work.
5. Simple core, pluggable edges.

---

## 2. Scope and non-goals

### In scope

- Procedural model creation from primitives, booleans, lathe and extrude operations, and reusable components.
- Import of external glTF/GLB models as parts or whole assets.
- Materials: flat colour, toon (banded) shading, vertex colours, palette-indexed colours, small textures.
- Rigid hierarchical rigs and optional linear-blend skinning, with pose-keyframe animation clips.
- Orthographic multi-direction rendering with configurable camera presets, lighting presets and pixel-grid scale.
- Pixel-art processing: supersampled downscale, binary alpha, edge bleed, palette mapping, ordered dither, outlines, orphan cleanup.
- Fixed-grid and packed sprite sheets with Aseprite-compatible JSON, a tool-native manifest, and additional engine formats.
- Content-addressed caching, selective regeneration, batch generation, generation history and comparison.
- Automated validation and visual regression.
- A local web viewer for browsing, playing, comparing and inspecting outputs.
- Documentation for humans and for Claude Code.

### Non-goals (initial release)

- Perspective projection sprites (orthographic only; perspective is a future backend concern).
- AI-driven mesh generation (text-to-3D). The tool is a deterministic compiler for explicit definitions.
- A general-purpose 3D editor UI.
- Game-engine runtime plugins. Export formats are files that engines import; no engine SDK is bundled.
- Cloud rendering, remote queues, or multi-machine distribution.
- Hand retouching workflows. The pipeline is fully automatic; manual edits belong in an external editor.
- Mandatory MCP server. An optional thin MCP wrapper over the CLI may be considered after release, never as a requirement.

---

## 3. Greenfield assumptions

Repository state on 2026-10-02: the root contains only an empty `docs/roadmaps/` directory. There is no git repository, no package manifest, no source code, no assets, no CI.

Local environment observed: macOS 26 on Apple Silicon (arm64), Node 24.3.0, npm 11.4.2. pnpm was not installed; Phase 0 uses pnpm 12.8.1 through `npx`. Blender and Godot are not installed and will not be required.

Decisions this roadmap therefore makes from scratch: package manager and layout, language and build tooling, CLI framework, configuration format, rendering backend, model representation, animation representation, sprite and sheet conventions, metadata schemas, caching layout, viewer architecture, testing and CI strategy, documentation layout, release process.

Nothing is inherited from other repositories. All conventions in section 8 are defaults chosen for this project and remain configurable per project and per asset.

---

## 4. Research findings

Research was conducted on 2026-10-02 against official documentation, npm registry metadata and GitHub sources, plus local experiments on the development machine (Apple Silicon, Node 24.3.0). Findings are labelled **[V]** when verified by documentation or by running code, and **[I]** when they are inferences to confirm during implementation.

### 4.1 Headless 3D rendering

| Option | Finding | Verdict |
|---|---|---|
| three.js in Playwright headless Chromium with SwiftShader | **[V]** Playwright 1.63.0 bundles Chromium 153 headless shell with SwiftShader Vulkan. A shadowed toon cube rendered with WebGL2, transparent background, in 0.3 to 0.5 ms per 128 px frame after a 200 to 430 ms launch. Output byte-identical across runs and across the `--use-angle=swiftshader` flag variants. Chrome removed automatic SwiftShader fallback in 137 but `--enable-unsafe-swiftshader` is the supported opt-in for headless systems. `page.screenshot({ omitBackground: true })` and `gl.readPixels` both work. | **Primary backend.** Same software rasteriser on every OS, most battle-tested WebGL2 implementation, used by three.js's own CI. |
| three.js in Node via headless-gl (`gl`) | **[V]** three.js requires WebGL2 since r163. `gl@8.1.6` (latest) is WebGL1 only. `gl@9.0.0-rc.10` (2026-04) adds experimental WebGL2 behind `createWebGL2Context: true`; its author describes it as "very incomplete" and not CTS-tested. It rendered the same scene correctly (shadows, toon material, skinned mesh) at 2.75 ms per frame, byte-identical across runs, and differed from the SwiftShader render by 4 edge pixels in 16384. No darwin prebuilds for 9.x (compiles locally with Xcode CLT in ~10 s), Linux needs Xvfb plus Mesa. | **Secondary backend**, optional, behind the same interface. Useful for in-process unit tests and environments where a browser download is unacceptable. Not the default because of RC status, incomplete WebGL2 and platform-dependent GL drivers. |
| three.js WebGPURenderer on Dawn (`webgpu` npm 0.6.1) | **[V]** Adapter and device creation work on macOS (Metal). No software fallback adapter on macOS; GPU-less Linux needs a provisioned lavapipe ICD. The only three.js integration is an 8-star third-party package. WebGPU is also absent in the headless shell and needs a secure context in full Chromium. | **Future backend.** Watch, do not build on it. |
| Babylon.js, PlayCanvas | **[V]** Babylon `NullEngine` and PlayCanvas `NullGraphicsDevice` produce no pixels; both need WebGL2 for real rendering and recommend Puppeteer. | Rejected: no advantage over three.js. |
| Blender headless | **[V]** Works and is deterministic enough, but is a 300 MB external install, seconds of startup, and moves model authoring to Python. | Rejected as a dependency. Possible future import path for `.blend` sources. |
| Godot headless | **[V]** `--headless` disables the rendering server; viewport capture needs a display. | Rejected. |
| Custom software rasteriser | **[I]** Feasible for ortho plus flat/toon shading and would be the only truly bit-exact cross-platform option, but it is a project in itself. | Deferred. The backend interface keeps the door open. |

Reproducibility evidence **[V]**: identical renderer, identical inputs, identical process gives byte-identical output on both tested backends. Different rasterisers disagree on sub-pixel edge coverage (Metal vs SwiftShader differed by 4 alpha pixels; three.js excludes one example from its CI for the same reason). Known nondeterminism sources: MSAA, texture filtering with mipmaps, PCF shadow filtering, FMA and SIMD width differences in llvmpipe, time-based or random inputs. Conclusion: pin the renderer binary, disable the nondeterministic features, compare with tolerance across backends and exactly within a backend.

### 4.2 Models, geometry and formats

- **[V]** `@gltf-transform/core|functions|extensions` 4.5.1 (MIT) reads and writes GLB in Node with no browser globals, creates meshes, skins and animations programmatically, and ships `weld`, `dedup`, `prune`, `normals`, `inspect` and more. This is the canonical GLB I/O layer.
- **[V]** three.js 0.186.1 imports in Node without a DOM. Geometry classes, `BufferGeometryUtils.mergeGeometries`, `Bone`, `Skeleton`, `SkinnedMesh`, `AnimationMixer.setTime` and `CCDIKSolver` all run. `mergeGeometries` rejects mixed indexed and non-indexed input (`ExtrudeGeometry` is non-indexed), so normalise with `toNonIndexed` and `mergeVertices` first.
- **[V]** three's `GLTFExporter` fails in Node (`FileReader is not defined`) and exports toon materials as plain PBR. Writing goes through gltf-transform instead.
- **[V]** `manifold-3d` 3.5.4 (Apache-2.0, WASM) provides robust booleans, hull, revolve and extrude with guaranteed manifold output, a `NotManifold` error for invalid input, and a `lib/gltf-io` bridge into gltf-transform documents. It is the CSG kernel. `three-bvh-csg` 0.0.18 is a possible three-native alternative with attribute preservation but self-described experimental output; `three-csg-ts` and JSCAD are stale or lack a glTF path.
- **[V]** `gltf-validator` 2.0.0-dev.3.10 (Khronos, Apache-2.0) validates GLB bytes in Node and reports structured issues. It flags non-zero joint indices with zero weight, which both hand-built and three-exported skins trip; the fix is trivial.
- **[V]** Prior art on LLM-authored 3D (SceneCraft, LL3M, ShapeCraft, ShapeLib, VoxelCodeBench, CadQuery code generation) consistently finds that high-level abstractions (parts, primitives, named operations) outperform raw mesh authoring for language models. The chosen representation is a declarative "part assembly" with an optional TypeScript generator that emits the same JSON. Voxel grids become an optional part type later.
- **[V]** VRM 1.0 humanoid bone names are the only widely adopted glTF bone naming convention and map to Mixamo via a published table. Adopted for humanoid rigs.

### 4.3 Animation

- **[V]** `AnimationMixer.setTime(t)` is deterministic and sufficient for sampling clips at fixed frame times.
- **[I]** Rigid hierarchical animation (parts parented to bones, no skinning) is sufficient for most pixel-art characters at 32 to 64 px and avoids weighting problems. Skinning stays available for parts that span a joint.
- **[I]** Pose keyframes in JSON (per-bone rotation and optional translation at named times with easing) compile cleanly to glTF animation samplers via gltf-transform and are easy for Claude Code to edit. STEP vs LINEAR interpolation at sprite frame rate is an open experiment.

### 4.4 Pixel-art processing

- **[V]** `sharp` 0.35.5 (Apache-2.0) ships Node 20 to 24 prebuilds for macOS arm64 and Linux, premultiplies alpha before resize and unpremultiplies after (avoiding dark halos), supports `nearest`, `linear`, `mitchell`, `lanczos3` kernels, raw RGBA buffer I/O, compositing, and indexed PNG output with `palette`, `colours` and `dither` options. Local measurement: 512 px render to 64 px palette PNG in about 5 ms.
- **[V]** `sharp` has no alpha-only threshold, no fixed-palette mapping and no morphology; these passes are written as pure TypeScript over `Uint8Array` RGBA buffers, which also makes them library-agnostic and trivially unit-testable.
- **[V]** `libimagequant` and `pngquant` are GPL-3.0 (commercial licence otherwise). `image-q` 4.0.0 (MIT) is unmaintained since 2023 but dependency-free and stable, offering WuQuant and NeuQuant palette builders and multiple dither kernels. The plan: vendor or wrap `image-q` for automatic palette generation, and implement Oklab nearest-colour mapping with ordered Bayer dithering in-house for deterministic, frame-stable fixed-palette output. Verify the licence chain of `sharp`'s palette output before relying on it in closed-source contexts.
- **[V]** Pixel-art sprites should have binary alpha, with anti-aliasing only on interior colour transitions, and transparent pixels should carry bled colour to avoid engine-side halos (Hargreaves, Courrèges, TexturePacker "Reduce border artifacts").
- **[V]** Common 3D-to-pixel recipes (GodotPixelRenderer, UPixelator, t3ssel8r) use orthographic cameras, pixel-grid snapping, nearest filtering, 2 to 4 toon bands, hard shadows, and normal or depth edge outlines. Dead Cells used a custom 3D-to-sprite converter followed by hand cleanup; cleanup beyond orphan-pixel removal is not reliably automatable.

### 4.5 Sprite sheets and metadata

- **[V]** `maxrects-packer` 2.7.3 (MIT) is the packing core behind `free-tex-packer-core` and `@assetpack/core`; it does not trim or extrude, so those are implemented in-pipeline. Fixed-grid layouts are written directly with `sharp.composite`.
- **[V]** Aseprite JSON Hash is the most widely imported format (Phaser `load.aseprite`, PixiJS spritesheet superset, Godot via plugins) and its exact shape is documented in `doc_exporter.cpp`. It is the primary emitted format, alongside a tool-native `manifest.json` that carries pivot, palette, direction order, fps and provenance.
- **[V]** Conventions: 8-direction row order S, SW, W, NW, N, NE, E, SE; 2:1 dimetric camera pitch 30 degrees (projected lines at 26.565 degrees; corrected in Phase 1); 8 to 12 fps; bottom-centre pivot; 16/24/32/48/64 px common sizes.

### 4.6 CLI, build, test and viewer stack

- **[V]** commander 15 (ESM, zero deps) for command parsing, zod 4.6 for schemas with native `z.toJSONSchema()`, pino 10 for NDJSON logs, `@clack/prompts` only on TTY, tsdown 0.23 (tsup is unmaintained per its own README), Biome 2.5 for lint and format, Vitest 5 with `@vitest/browser-playwright`, Playwright 1.63, Vite 8 and React 19 for the viewer, Hono 4 for the local server, piscina 5 for worker pools, Node's `crypto.hash` for content hashing, changesets with npm trusted publishing for release.
- **[V]** TypeScript 7.0.2 (native Go compiler) is released with build mode and project references complete but no stable programmatic API. tsdown generates declarations through Oxc isolated declarations without tsc. TypeScript 6.0 remains the fallback if any tooling incompatibility appears.
- **[V]** Node 24 strips types by default, so the CLI can run from source in development if the code uses erasable syntax only.
- **[V]** GitHub Actions `ubuntu-latest` migrates to 26.04 during October to November 2026; pin `ubuntu-24.04`. Standard macOS runners have no GPU; Linux runners have no GPU. SwiftShader via Playwright needs no system packages. headless-gl on Linux needs `xvfb-run` plus Mesa.
- **[V]** Agent-friendly CLI guidance (clig.dev, Speakeasy, gh CLI, GitLab CLI issue 8177): `--json` everywhere, data on stdout and logs on stderr, NDJSON progress, non-TTY detection, `--dry-run`, stable error codes, schema introspection commands, short task-specific agent docs.

### 4.7 Local experiments performed

All scripts live in the session scratchpad and are not part of the repository. They inform Phase 1 tasks.

| Experiment | Result |
|---|---|
| three r186 + `gl@9.0.0-rc.10` WebGL2, 128 px toon cube with shadow | Correct image, 132 ms first frame, byte-identical repeat |
| three r186 in Playwright 1.63 headless shell, same scene | SwiftShader WebGL2 by default, 0.5 ms per frame, byte-identical repeat, 4 px difference vs headless-gl |
| `webgpu` 0.6.1 Dawn bindings | Metal adapter only, no fallback adapter |
| Programmatic 2-bone skinned cylinder, `AnimationMixer.setTime` | Centroid shifts per frame as expected |
| three `GLTFExporter` in Node | Fails without `FileReader` shim |
| gltf-transform skin plus animation document round trip | Works, validator clean after zeroing unused joint indices |
| manifold-3d cube minus cylinder into gltf-transform document | 80 triangles, genus 1, validator clean |
| sharp 512 px to 64 px, alpha threshold, 8-colour palette PNG | About 5 ms |

---

## 5. Technology decisions and rationale

| Area | Decision | Alternatives considered | Rationale and risks |
|---|---|---|---|
| Language and runtime | TypeScript 7 (fallback 6), Node 24 LTS, ESM only | Deno, Bun | Node has the renderer and image ecosystem; Deno WebGPU is unstable; Bun has no headless-gl or Playwright parity guarantees. Risk: TS 7 has no stable API; mitigated by using tsdown's Oxc declaration emit. |
| Package manager and layout | pnpm 12 workspaces, five packages | Single package, Turborepo, Nx | Boundaries follow runtime targets (Node core, browser harness, browser viewer, CLI, shared schema). Plain `pnpm -r` scripts first; add Turborepo only when CI caching is worth it. |
| Build | `tsc -b` for libraries and CLI, Vite 8 for harness and viewer | tsdown, tsup, esbuild, unbuild | Decided in Phase 0: TypeScript 7 builds everything in under half a second, and tsdown's isolated declarations do not suit inferred zod types. tsup is unmaintained. |
| Lint and format | Biome 2.5 | ESLint plus Prettier | One tool, fast, formats JSON (important for agent-edited asset files). |
| Tests | Vitest 5, Playwright 1.63, pixelmatch 7, odiff for bulk | Jest | Vitest projects cover Node and browser; pixelmatch is tiny, ISC, Oklab-based. |
| CLI parsing | commander 15 plus zod re-validation of options | stricli, citty, oclif, yargs | Ubiquitous, zero deps. stricli has stronger typing and is the documented fallback if commander's typing becomes a burden. |
| Config format | JSON with `$schema` and `schemaVersion` | YAML, JSON5, TypeScript configs | Exact-match edits are reliable, schema validation native, diffs clean. Comments are sacrificed; a `description` field is allowed on every object. TypeScript is used only for the optional SDK that emits JSON. |
| Schema | zod 4 as source of truth, JSON Schema 2020-12 emitted to `schemas/` | TypeBox, valibot, arktype | Native JSON Schema export, best error paths, types inferred. |
| Logging and progress | pino NDJSON on stderr; human renderer only on TTY | consola, ora | Keeps stdout a single parseable document in `--json` mode. |
| Rendering backend | three.js 0.186 in Playwright-driven Chromium headless shell with SwiftShader forced | headless-gl, Dawn WebGPU, Blender, Godot, Babylon, PlayCanvas, custom rasteriser | Verified fastest, most tested, OS-independent rasteriser. Risks: 100 MB browser download, Chrome flag policy changes, process boundary. Mitigations: `td2d doctor`, pinned Playwright, `RenderBackend` interface with headless-gl as secondary. |
| Scene code | Isomorphic three.js module (`render-harness`) with no DOM access, run in browser now and in Node later | Browser-only code | One scene builder serves the CLI backend, the headless-gl backend and the viewer's 3D preview. |
| Model storage | Declarative JSON part assembly as source; GLB build artefact via gltf-transform | Hand-written three.js scenes, voxels only, Blender files | Schema-validated, diffable, cacheable; GLB is inspectable in any viewer. |
| CSG kernel | manifold-3d | three-bvh-csg, three-csg-ts, JSCAD | Guaranteed manifold output, maintained, bridges to gltf-transform. |
| Rig and animation | Rigid hierarchy by default, optional skinning; JSON pose clips compiled to glTF animations; three `AnimationMixer` sampling | Blender actions, Spine, Mixamo-first | Fits pixel-art scale, agent-editable, deterministic. |
| Image core | sharp 0.35 plus pure-TS pixel passes | jimp, @napi-rs/canvas, image-js | Fast native resize with premultiplied alpha; pure-TS passes isolate the pixel-art logic from the library. jimp is the documented pure-JS fallback. |
| Palette | In-house Oklab nearest mapping, Bayer dither and Wu quantiser (replaced `image-q` in Phase 5: 100 times faster, lower error) | libimagequant, pngquant, image-q | Licence clean, deterministic, frame-stable. |
| Packing | Fixed grid in-house; `maxrects-packer` for atlases | free-tex-packer-core, assetpack | Tiny MIT core; exporters written in-house against documented formats. |
| Metadata | Aseprite JSON Hash plus native `manifest.json`; PixiJS, Phaser atlas, Godot `SpriteFrames` as additional exporters | TexturePacker XML, Unity | Widest import coverage. |
| Viewer | Vite 8, React 19, plain CSS, Hono server launched by `td2d viewer`, SSE live reload via `fs.watch` | Svelte, Solid, Lit, static only | Largest widget pool and most LLM-familiar; static manifest mode retained for hosting. |
| Workers | piscina 5 with `AbortSignal` | tinypool, child processes | Mature cancellation and progress messaging. |
| Hashing | `crypto.hash('sha256')` | xxhash-wasm, hash-wasm | Zero deps; hashing is not the bottleneck. |
| Release | changesets, npm trusted publishing (OIDC provenance) | manual | Standard, tokenless. |
| Sandboxing | User TypeScript model scripts run in a child `node --permission` process with restricted fs and a timeout | `node:vm`, isolated-vm | `node:vm` is not a boundary; isolated-vm is a native addon with no fs anyway. |

### Unresolved questions carried into implementation

Each is assigned to a phase task with measurable criteria.

| ID | Question | Phase |
|---|---|---|
| Q1 | Does the Playwright headless shell on `ubuntu-24.04` expose WebGL2 without extra packages when `--enable-unsafe-swiftshader` is set? | 1: yes in the Playwright Linux image; native CI to confirm |
| Q2 | Is SwiftShader output identical between macOS and Linux for the reference scene set? | 1: byte-identical on Linux arm64 and x86_64 (emulated) |
| Q3 | Supersample 4x plus box filter plus alpha threshold versus 1x direct rendering: which gives steadier walk-cycle silhouettes? | 5: equally steady silhouettes; box averaging makes shimmering in-between colours, so 4x with the new `mode` filter is the default |
| Q4 | STEP vs LINEAR interpolation at sprite frame rate for pixel-art readability | 6: linear by default; step freezes every other frame and jumps at 10 fps |
| Q5 | Is skinning visibly better than rigid parenting at 32 to 64 px? | 6: no; at 32 px it changes at most 12 of about 100 pixels at the elbow, so rigid is the default |
| Q6 | Alpha threshold value (128 default) on thin parts | 5: 100 to 160 behave alike; sub-pixel parts vanish edge on at any of them, so 128 stays and the guide asks for parts at least 1 px thick |
| Q7 | Per-asset vs per-clip automatic palette: flicker vs fidelity | 5 and 6: per-asset default (no colour jumps between clips); on the knight's real clips per-clip palettes gave no lower error; per-clip warns with `W_PALETTE_PER_CLIP` |
| Q8 | Licence chain of `sharp` palette output (libimagequant inside libvips) | 5: libimagequant 2.4.1 BSD 2-Clause fork, so no GPL; td2d writes indexed PNGs itself anyway |
| Q9 | TypeScript 7 `tsc -b` with pnpm workspace references and Node type stripping | 0: works; workspace packages export sources under a `td2d-source` condition and the CLI runs from source |
| Q10 | tsdown isolated declarations across all exported core types | 0: not adopted; isolated declarations would need explicit types on every zod schema, and `tsc -b` alone builds in under a second |
| Q11 | `fs.watch({ recursive: true })` reliability on Linux and Docker for the viewer | 9: reliable on Linux arm64 and x86_64 and in Docker bind mounts, including host writes and new directories, at about 110 ms with the debounce; polling stays behind `--watch-mode poll` |
| Q12 | Node permission model `--allow-fs-read` globs with pnpm symlinked `node_modules` | 11: Node 24 takes paths, not globs, and checks real paths, so td2d allows the real path of `@td2d/core` and each package in its dependency closure; Node 24 has no network permission, so the script runner replaces the network APIs (a guard, not a boundary) |
| Q13 | headless-gl 9 WebGL2 coverage of the features the harness uses (render targets, depth textures) | 11: the harness needs WebGL2, a depth buffer, GLSL 3 skinning and `readPixels`, not render targets or depth textures; `gl@9.0.0-rc.10` passes every golden within tolerance (at most 0.022 percent of pixels) on macOS and on Linux under xvfb |
| Q14 | Godot `SpriteFrames` `.tres` exact text format | 7: format=3 without load_steps (Godot 4.6 form); verified by loading the export in Godot 4.7.2 |

---

## 6. Proposed architecture

### 6.1 Component overview

```
+--------------------+        +----------------------------+
|  Claude Code /     |  CLI   |  @td2d/cli                 |
|  human in terminal | -----> |  commands, --json, exit    |
+--------------------+        |  codes, progress           |
                              +-------------+--------------+
                                            |
                                            v
                              +----------------------------+
                              |  @td2d/core                |
                              |  project IO, model build,  |
                              |  rig/anim compile, frame   |
                              |  plan, pixel passes, sheet,|
                              |  export, validate, cache,  |
                              |  history, batch            |
                              +------+--------------+------+
                                     |              |
                 RenderBackend iface |              | reads/writes
                                     v              v
   +--------------------------------------+   +-------------------------+
   | @td2d/render-harness                 |   | project directory       |
   | isomorphic three.js scene builder    |   | assets/ build/ history/ |
   | + browser entry (harness.html)       |   | .td2d/cache/            |
   | hosted by Playwright (primary)       |   +------------+------------+
   | or by Node + headless-gl (secondary) |                |
   +--------------------------------------+                | reads only
                                                           v
   +--------------------------------------+   +-------------------------+
   | @td2d/schema                         |   | apps/viewer             |
   | zod schemas, TS types, JSON Schema   |<--| Hono server + React SPA |
   | shared by all packages               |   | launched by `td2d viewer`|
   +--------------------------------------+   +-------------------------+
```

### 6.2 Package responsibilities

- **`@td2d/schema`**: zod 4 schemas and inferred TypeScript types for every input document (project, asset, model, material, palette, rig, clip, camera preset, lighting preset, render settings, pixel settings, sheet layout, export settings) and every output document (manifest, validation report, generation record, batch report, CLI envelope). Emits JSON Schema files. No runtime dependencies other than zod. Every document carries `schemaVersion`.
- **`@td2d/core`**: the generation engine. Pure Node, no browser globals. Organised by pipeline stage with a registry per extension point. Depends on schema, three (geometry only), gltf-transform, manifold-3d, sharp, maxrects-packer, piscina, pino.
- **`@td2d/render-harness`**: three.js scene construction, material mapping, clip sampling and frame capture written without DOM assumptions. Exposes `createScene(job, glb)` and `captureFrame(scene, sample)` returning RGBA buffers. Has a browser entry (`harness.html`) that receives jobs over `page.exposeFunction` and `page.evaluate`, and a Node entry for the headless-gl backend. Built by Vite into a single self-contained HTML file embedded in the package.
- **`@td2d/cli`**: commander-based commands, option validation via zod, output envelopes, exit codes, progress rendering, viewer launcher. Thin: every command delegates to core.
- **`apps/viewer`**: Hono server (`server/`) that serves the built SPA, an `index.json` API over the project `build/` directory, static files and an SSE change feed; React SPA (`client/`) for browsing and inspection. Reads only; never generates.

### 6.3 Pipeline stages and the stage DAG

Each stage is a pure function from typed inputs to typed outputs plus files, registered with a name, a version, an input hash function and declared dependencies.

| Stage | Inputs | Outputs | Depends on |
|---|---|---|---|
| `resolve` | asset.json, project presets, palettes | `resolved.json`: all presets inlined, defaults applied | none |
| `model` | parts (geometry and material names only, never colours) | `model/model.glb`, `model-report.json` | none |
| `rig` (Phase 6) | resolved rig and clips, model.glb | `model.glb` with skins and animations, `rig-report.json` | model |
| `plan` | camera, frame, pixels per unit, supersample, directions, clips | `plan.json`: samples, sheet rows, fitted ground margin | model (rig from Phase 6) |
| `render` | materials, lighting, backend fingerprint | `renders/<clip>/<dir>/<nnn>.png` (supersampled RGBA) | model, plan |
| `pixel` | pixel settings, supersample | `sprites/<clip>/<dir>/<nnn>.png` (final sprite cells) | render |
| `sheet` | sheet settings, frame | the sheet image and its layout | pixel, plan |
| `validate` | acceptance, asset type, frame | `validation.json` | pixel, sheet, plan |
| `export` | export settings | `sheets/<name>.png`, `<name>.json` (Aseprite), `manifest.json`, other formats | every earlier stage |

The runner computes a content hash for each stage from the tool version, stage version, canonical JSON of the stage's own inputs and the hashes of the stages it depends on. A matching entry in `.td2d/cache/<stage>/<hash>/` is reused instead of recomputed. Validation runs before export so the manifest can carry its summary, and `generation.json` plus the history entry are written after export (decided in Phase 2). Colours enter at the render stage, so a material change reuses geometry and the plan. `--from`, `--to` and, from Phase 8, `--frames`, `--clips` and `--directions` narrow the work.

### 6.4 Rendering contract

```ts
// (proposed) packages/core/src/render/backend.ts
export interface RenderBackend {
  readonly id: string;                       // 'playwright-swiftshader' | 'headless-gl'
  capabilities(): Promise<BackendCapabilities>;
  start(options: BackendStartOptions): Promise<void>;
  render(job: RenderJob, sink: FrameSink, signal?: AbortSignal): Promise<RenderSummary>;
  stop(): Promise<void>;
}

export interface RenderJob {
  jobId: string;
  model: { glb: Uint8Array; hash: string };
  materials: ResolvedMaterial[];
  camera: ResolvedCamera;                    // projection, pitch, frustum from pixelsPerUnit
  lighting: ResolvedLighting;
  frame: { width: number; height: number; supersample: number };
  samples: FrameSample[];                    // { key, clip, time, yawDegrees }
  determinism: { antialias: false; shadowMap: 'basic'; textureFilter: 'nearest'; colorSpace: 'srgb'; toneMapping: 'none' };
}

export interface FrameSink {
  (frame: { key: string; width: number; height: number; rgba: Uint8Array }): Promise<void>;
}
```

The Playwright backend launches one browser per `render` invocation, opens the harness page via a `page.route` handler that serves the embedded HTML, transfers the GLB as a base64 string once, then calls `window.__td2d.renderSamples(batch)` for batches of samples and receives RGBA buffers back as base64 (or `ArrayBuffer` via a binding) and decodes them in Node. Direction changes rotate the camera yaw, not the model, so world-space lighting is stable; a `lighting.space: 'camera'` option attaches lights to the camera instead.

### 6.5 Data flow for a single asset

1. CLI validates `assets/<id>/asset.json` against the schema and resolves presets.
2. Core builds geometry per part (three geometry classes or manifold-3d), merges, assigns materials, writes `model.glb` with gltf-transform, validates it.
3. Core compiles the rig and clips into the GLB (skins, animations).
4. Core computes the frame plan.
5. Render backend produces supersampled RGBA frames.
6. Pixel passes convert frames into sprite cells.
7. Sheet stage composites cells and records cell rectangles.
8. Export writes images and metadata.
9. Validation runs image checks and writes `validation.json`.
10. Record writes `generation.json`, copies key outputs into `history/`.
11. CLI prints the JSON envelope with paths, warnings and the validation summary.

---

## 7. Proposed repository structure

```
threedee-twodee/
  package.json                 # workspace root: scripts, devDependencies
  pnpm-workspace.yaml
  tsconfig.base.json
  biome.json
  vitest.config.ts             # projects: unit (node), harness (browser), viewer (browser), e2e
  .github/workflows/ci.yml
  .changeset/
  ROADMAP.md
  README.md
  AGENTS.md                    # short operator guide for Claude Code (see section 11)
  docs/
    roadmaps/                  # existing empty directory; phase status notes live here
    guide/                     # human documentation (section 16)
    reference/                 # generated CLI and schema reference
  schemas/                     # generated JSON Schema files, committed, versioned
  packages/
    schema/                    # @td2d/schema
      src/
        documents/             # one file per document type
        presets/               # built-in preset JSON validated against schemas
        index.ts
        emit-json-schema.ts
    core/                      # @td2d/core
      src/
        project/               # load, resolve, paths, presets, palettes
        model/
          parts/               # part type registry: box, cylinder, sphere, lathe, extrude, csg, import, (voxel later)
          build.ts             # assembly compiler -> three geometries -> gltf-transform document
          materials.ts
          validate.ts
        rig/                   # bones, clips, procedural helpers, glTF animation writer
        plan/                  # frame plan
        render/
          backend.ts           # interface
          playwright/          # primary backend
          headless-gl/         # secondary backend (Phase 11)
          frames.ts            # frame file naming, PNG encode/decode
        pixel/
          passes/              # downscale, alphaThreshold, bleed, palette, dither, outline, cleanup, posterize
          palette/             # Oklab, fixed palettes, automatic palette
          pipeline.ts
        sheet/                 # grid, pack (maxrects), composite
        export/                # aseprite, manifest, pixi, phaser, godot
        validate/              # image checks, report
        pipeline/              # stage registry, DAG runner, cache, progress events
        history/
        batch/
        errors.ts              # error codes
        index.ts
      test/
        fixtures/              # golden images, reference GLBs, example projects
    render-harness/            # @td2d/render-harness
      src/
        scene.ts               # createScene(job, glb)
        materials.ts           # material mapping incl. toon gradient maps and outlines
        sampling.ts            # clip sampling with AnimationMixer
        capture.ts             # render to RGBA
        browser-entry.ts       # window.__td2d API
        node-entry.ts          # headless-gl adapter
      harness.html
      vite.config.ts           # single-file build
    cli/                       # @td2d/cli
      src/
        main.ts
        commands/              # one file per command group
        output/                # envelope, exit codes, progress renderer
        viewer.ts              # launches apps/viewer server
  apps/
    viewer/
      server/                  # Hono: index API, static, SSE
      client/                  # React SPA
      vite.config.ts
  examples/
    starter/                   # example project created by `td2d init`
    characters/                # humanoid example with clips
    props/                     # static props and tiles
```

Rationale: five packages map to five runtime targets or ownership boundaries. The harness is separate from core because it must be built for the browser and must never import Node modules. The viewer is an app, not a library, and depends only on schema types. Core never imports the CLI or the viewer.

---

## 8. Initial asset and metadata conventions

All values below are defaults. Projects override them in `td2d.project.json`; assets override them in `asset.json`; presets are named, reusable fragments stored in `presets/` and referenced by name.

### 8.1 Project layout

```
<project>/
  td2d.project.json            # project config: defaults, preset search paths, output dir
  assets/
    <assetId>/
      asset.json               # the asset definition (may reference files below)
      parts/*.json             # optional reusable part groups
      clips/*.json             # optional animation clips
      import/*.glb             # optional imported models
  components/*.json            # project-wide reusable part groups
  palettes/*.json              # project palettes
  presets/
    camera/*.json
    lighting/*.json
    pixel/*.json
    sheet/*.json
    export/*.json
  build/<assetId>/             # generated, gitignored by default
  history/<assetId>/           # generated, optionally committed
  .td2d/cache/                 # generated, gitignored
```

### 8.2 Identifiers and naming

- Asset ids: lowercase kebab-case, `[a-z0-9][a-z0-9-]*`, optionally namespaced with `/` (for example `characters/knight`). The id is the directory path under `assets/`.
- Clip names: `<state>[_<variant>]`, lowercase snake case: `idle`, `walk`, `attack_heavy`.
- Direction names: `s sw w nw n ne e se` (8-way), `s w n e` (4-way), `side` (1-way), or a custom list of yaw angles with names.
- Frame files: `<clip>/<direction>/<nnn>.png`, zero-padded to three digits.
- Sheet files: `<assetId>.png` with `<assetId>.json` (Aseprite JSON Hash) and `manifest.json` beside them. Multiple sheets per asset use `<assetId>.<sheetName>.png`.
- Aseprite frame keys: `<assetId> (<clip>_<direction>) <n>.png`. Frame tags: `<clip>_<direction>`.
- Material and palette names: lowercase kebab-case.
- Bone names for humanoids: VRM 1.0 names (`hips`, `spine`, `chest`, `neck`, `head`, `leftUpperArm`, ...). Other rigs: free-form kebab-case.

### 8.3 Units, scale and composition

- World units: metres, Y up, glTF conventions. A standard character is 1.6 to 2.0 units tall.
- `pixelsPerUnit` (default 16): the orthographic frustum width in world units is `frame.width / pixelsPerUnit`, which guarantees integer pixel mapping. A 32 px wide frame at 16 ppu shows 2 m.
- Frame size default: 32 x 32 for props, 32 x 48 for humanoid characters, 64 x 32 for 2:1 tiles. Always explicit in the resolved asset.
- Pivot: `bottom-center` by default. The ground plane (y = 0) projects to row `frame.height - groundMargin` where `groundMargin` defaults to 2 px. Pivot is stored in the manifest in pixel coordinates and in normalised coordinates.
- Pixel-grid snapping: the camera's position is snapped so that world origin lands on an exact pixel boundary. In camera space, the object pivot is translated to the nearest multiple of `1 / pixelsPerUnit`. This is mandatory, not configurable, because it prevents frame-to-frame shimmer.
- Object positioning: the asset's origin is at its pivot (feet for characters, base centre for props). Validation warns when geometry extends below y = 0 or outside the frustum.

### 8.4 Camera presets

| Preset | Projection | Pitch | Yaw offset | Use |
|---|---|---|---|---|
| `dimetric` (default) | orthographic | 30 (arcsin 1/2) | 45 | 2:1 pixel isometric: edges project with slope sin(pitch) = 1/2 |
| `isometric` | orthographic | 35.264 (arctan 1/sqrt 2) | 45 | true isometric |
| `three-quarter` | orthographic | 30 | 0 | classic top-down RPG |
| `top-down-45` | orthographic | 45 | 0 | steeper top-down |
| `side` | orthographic | 0 | 90 | side-scroller |
| `top` | orthographic | 90 | 0 | tiles and maps |

Yaw for direction `d` is `yawOffset + directionAngle(d)`, with `s = 0` facing the camera and angles increasing clockwise when viewed from above (sw = 45, w = 90, ...). Mirrored directions (`mirror: ['e:w', 'ne:nw', 'se:sw']`) are optional and off by default because they break asymmetric models.

### 8.5 Lighting presets

| Preset | Lights | Shadows | Notes |
|---|---|---|---|
| `studio-toon` (default) | key directional from upper-left-front (azimuth -35, elevation 50, intensity 2.0), ambient 0.45, rim off | hard, `BasicShadowMap`, 1024 map | camera-locked by default (`space: 'camera'`) so all directions shade alike |
| `world-sun` | key directional fixed in world space | hard | for tiles where lighting must match a map-wide sun |
| `flat` | ambient 1.0 only | none | silhouettes and emissive assets |

Toon shading uses `MeshToonMaterial` with a generated gradient map of `bands` steps (default 3) and `NearestFilter`. Tone mapping is off; output colour space is sRGB.

### 8.6 Materials and palettes

Materials are renderer-agnostic:

```jsonc
// (proposed) material definition
{ "name": "steel", "color": "#9aa3ad", "shading": "toon", "bands": 3, "emissive": "#000000", "outline": true }
{ "name": "cloak", "color": { "palette": "endesga-32", "index": 20 }, "shading": "toon" }
{ "name": "glass", "color": "#88ccff", "shading": "flat", "opacity": 1 }
```

Stored in GLB as `baseColorFactor` plus `COLOR_0` vertex colours with `KHR_materials_unlit` for flat shading or metallic 0 / roughness 1 PBR for toon, and an `extras.td2d` block with `shading`, `bands` and `outline`. The harness maps these to three materials. Opacity below 1 is allowed in rendering but the pixel stage will threshold it; a validation warning explains this.

Palettes are JSON lists of hex colours with a name and optional source URL. Built-in palettes: `endesga-32`, `pico-8`, `db32`, `resurrect-64`, `aap-64`. Palette mode per asset: `none`, `fixed:<name>`, `auto:<n>`.

### 8.7 Render, pixel, sheet and export defaults

| Setting | Default | Notes |
|---|---|---|
| `render.supersample` | 4 | Render at 4x frame size, antialias off |
| `render.backend` | `playwright-swiftshader` | |
| `pixel.downscale` | `mode` | alpha from block coverage; colour is the block's most common colour (`box` averages it instead). Chosen by Q3 |
| `pixel.alphaThreshold` | 128 | binary alpha; half-covered blocks follow the top-left rule. Kept by Q6 |
| `pixel.bleed` | true | transparent pixels take nearest opaque colour |
| `pixel.palette` | `none` | or `fixed:<name>`, `auto:<n>` |
| `pixel.paletteScope` | `asset` | or `clip`; chosen by Q7 |
| `pixel.dither` | `none` | or `bayer-2`, `bayer-4`, `bayer-8`, with `ditherStrength` 0.5 |
| `pixel.outline` | `none` | or `{ "color": "#000000", "side": "outside", "width": 1 }`, with `connectivity` 8 and `snapToPalette` false |
| `pixel.cleanup.orphans` | `off` | or `remove` (`true`) or `recolour` isolated pixels, with `minNeighbours` 1 |
| `animation.fps` | 10 | sampling rate for clips |
| `animation.defaultLength` | per clip | frames = round(duration * fps) |
| `sheet.layout` | `grid` | rows = clip x direction in plan order, columns = frames; or `strips`, or `packed` (maxrects) |
| `sheet.flow`, `sheet.split`, `sheet.trim`, `sheet.powerOfTwo` | `rows`, `none`, false, false | sequences along rows or columns; one sheet per clip or direction; trim packed sprites; power-of-two sheets |
| `sheet.padding` | 0 | pixels between cells |
| `sheet.extrude` | 0 | edge duplication for engines with bilinear sampling |
| `sheet.maxSize` | 4096 | split into multiple sheets beyond this |
| `export.formats` | `['aseprite-json', 'manifest']` | plus `pixi`, `phaser-atlas`, `godot-spriteframes`, `frames` (individual PNGs), `gif-preview` |
| `export.png.indexed` | `auto` | indexed PNG when a palette is set; `always` or `never` |
| `export.aseprite` | `{ variant: hash, frameNames: index }` | index names are what Phaser's `createFromAseprite` needs |
| `export.godot.directory`, `export.gif` | `res://`, `{ scale: 2, background: transparent }` | |

### 8.8 Metadata schemas

Every output JSON carries `schemaVersion` (semver string for the document type) and `generator: { name: 'td2d', version }`.

`manifest.json` (proposed, abbreviated):

```jsonc
{
  "schemaVersion": "1.0.0",
  "generator": { "name": "td2d", "version": "0.1.0" },
  "assetId": "characters/knight",
  "assetHash": "sha256:...",            // hash of the resolved asset definition
  "generatedAt": "2026-10-02T10:00:00Z",
  "frame": { "width": 32, "height": 48 },
  "pivot": { "x": 16, "y": 46, "normalized": { "x": 0.5, "y": 0.958 } },
  "pixelsPerUnit": 16,
  "camera": { "preset": "dimetric", "pitch": 30, "yawOffset": 45 },
  "directions": ["s", "sw", "w", "nw", "n", "ne", "e", "se"],
  "palette": { "mode": "fixed", "name": "endesga-32", "colors": ["#..."] },
  "clips": [ { "name": "walk", "fps": 10, "frames": 6, "loop": true, "durationMs": 600 } ],
  "sheets": [ { "name": "knight", "image": "knight.png", "data": "knight.json", "width": 192, "height": 384, "layout": "grid" } ],
  "cells": [ { "clip": "walk", "direction": "s", "index": 0, "sheet": "knight", "x": 0, "y": 0, "w": 32, "h": 48, "trimmed": false } ],
  "stages": { "model": "sha256:...", "render": "sha256:...", "pixel": "sha256:..." },
  "validation": { "status": "pass", "warnings": 1, "errors": 0, "report": "validation.json" }
}
```

`validation.json`: `{ schemaVersion, status: 'pass' | 'warn' | 'fail', checks: [{ id, level, message, frame?, details }] }`.

`generation.json`: inputs hash, resolved asset snapshot, stage timings, cache hits, backend id and version, warnings, output file list with hashes.

`batch-report.json`: per-asset status (`ok`, `warn`, `failed`, `skipped`), error summaries, durations, totals.

The schemas live in `@td2d/schema`, are emitted to `schemas/*.schema.json` and are printed by `td2d schema <name>`.

---

## 9. CLI design

Binary name: `td2d`. All commands are non-interactive by default. Interactive niceties only appear when stdout is a TTY and `--json` is absent.

### 9.1 Global options

| Option | Meaning |
|---|---|
| `--project <dir>` | Project root (default: nearest ancestor containing `td2d.project.json`) |
| `--json` | Machine-readable envelope on stdout; progress as NDJSON on stderr |
| `--log-level <level>` | `silent`, `error`, `warn`, `info`, `debug`, `trace` |
| `--no-color` | Also honoured via `NO_COLOR` and non-TTY detection |
| `--no-cache` | Neither read nor write the stage cache |
| `--force` | Recompute all stages |
| `--dry-run` | Resolve and plan; print what would run and which cache keys miss |
| `--concurrency <n>` | Worker count (default: cores minus one) |
| `--timeout <ms>` | Per-asset wall-clock limit |

### 9.2 Command reference (proposed)

| Command | Purpose |
|---|---|
| `td2d init [dir] [--template starter]` | Create a project with config, presets, palettes, one example asset |
| `td2d doctor` | Check Node version, Playwright browser presence, sharp, manifold WASM, write permissions; `--fix` installs the browser |
| `td2d schema [name] [--list]` | Print JSON Schema for a document type (`asset`, `project`, `manifest`, ...) |
| `td2d describe [--json]` | List registered part types, passes, presets, exporters, backends with their option schemas |
| `td2d asset create <id> [--from <template>]` | Scaffold `assets/<id>/asset.json` |
| `td2d asset list` / `asset show <id>` | Enumerate assets; show resolved definition |
| `td2d validate <id...> [--stage config|model|output]` | Validate definitions, built models, or generated outputs without rendering |
| `td2d model build <id>` | Run `resolve`, `model`, `rig` stages only; emit GLB and reports |
| `td2d model inspect <id>` | Bounds, triangle count, bone list, material list, clip list from the built GLB |
| `td2d render <id> [--clips a,b] [--directions s,w] [--frames 0-3]` | Run through `render`; emit supersampled frames |
| `td2d generate <id...> [filters]` | Full pipeline to validated outputs |
| `td2d sheet <id>` | Rebuild sheets and exports from existing sprites |
| `td2d export <id> --format pixi` | Re-run export only |
| `td2d inspect <id> [--frame walk/s/000]` | Output paths, manifest summary, per-frame stats |
| `td2d preview <id> [--scale 4] [--clip walk] [--out file.png]` | Write an upscaled contact sheet PNG so an agent can view the result with an image reader |
| `td2d compare <id> [--against <historyId>|<dir>] [--out diff.png]` | Pixel diff and stats between generations |
| `td2d history list|show|prune <id>` | Generation history |
| `td2d batch [--filter glob] [--manifest batch.json] [--continue-on-error]` | Generate many assets with a summary report |
| `td2d cache stats|clean [--older-than 7d]` | Cache maintenance |
| `td2d viewer [--port 4747] [--open] [--no-watch]` | Launch the web viewer server |
| `td2d index` | Write `build/index.json` for static viewer hosting |
| `td2d completion <shell>` | Shell completion |

### 9.3 Output envelope and exit codes

Every `--json` invocation prints exactly one JSON document to stdout:

```jsonc
// (proposed) success
{ "ok": true, "command": "generate", "version": "0.1.0", "durationMs": 4123,
  "data": { "results": [ { "assetId": "props/crate", "status": "ok", "outputs": { "sheet": "build/props/crate/sheets/crate.png", "manifest": "build/props/crate/sheets/manifest.json" },
                 "validation": { "status": "warn", "warnings": 1, "errors": 0 }, "cache": { "hits": 3, "misses": 4 } } ] },
  "warnings": [ { "code": "W_OPACITY_THRESHOLDED", "assetId": "props/crate", "message": "material 'glass' opacity 0.5 was thresholded to opaque", "hint": "Use dither or remove opacity" } ] }

// (proposed) failure
{ "ok": false, "command": "generate", "error": { "code": "E_ASSET_INVALID", "message": "assets/props/crate/asset.json failed validation",
  "issues": [ { "path": "model.parts[2].size", "message": "Expected array of 3 numbers, received 2" } ],
  "hint": "Run `td2d schema asset` to see the schema" } }
```

Exit codes: `0` success (warnings allowed), `1` unexpected internal error, `2` usage error, `3` validation failure of inputs (`E_ASSET_INVALID`, `E_PROJECT_INVALID`), `4` generation failure (render or stage error), `5` output validation failure (outputs written but a check failed; with `--strict`, warnings count too), `6` partial batch failure, `7` environment problem (`E_BROWSER_MISSING`, `E_NATIVE_MODULE`), `130` cancelled. Progress on stderr in `--json` mode:

```
{"t":"2026-10-02T10:00:01Z","event":"stage:start","assetId":"props/crate","stage":"render","total":48}
{"t":"2026-10-02T10:00:02Z","event":"item:done","assetId":"props/crate","stage":"render","key":"idle/s/000","n":1,"total":48}
{"t":"2026-10-02T10:00:05Z","event":"stage:done","assetId":"props/crate","stage":"render","durationMs":3100,"cached":false}
```

Error codes are an enum in `@td2d/schema` with a documented table in `docs/reference/errors.md`. Every error has `code`, `message`, optional `path`, `issues`, `hint`, and `docs` (a relative docs link).

---

## 10. Web viewer design

### 10.1 Access model

`td2d viewer` starts a Hono server on localhost that:

- serves the built React SPA;
- exposes `GET /api/index` (list of assets found under `build/`, built by scanning for `manifest.json` files), `GET /api/assets/:id` (manifest, validation, generation record, history list), `GET /api/history/:id/:entry`;
- serves `build/` and `history/` as static files under `/files/`;
- streams `GET /api/events` (SSE) when `fs.watch({ recursive: true })` sees a change under `build/`, debounced 100 ms, so the SPA refreshes.

The viewer never writes to the project. A static mode (`td2d index` plus any static file server) serves the same SPA with `index.json` and no live reload, for sharing a build directory. The SPA detects which mode it is in by probing `/api/index`.

Why a tiny local server rather than pure static or a database: browsers cannot list directories from `file://`, the project is already a file tree, and a few JSON endpoints over that tree are all the viewer needs.

### 10.2 Features

| Area | Features |
|---|---|
| Library | Grid and list of assets with thumbnails, search, filter by validation status, tags, last generated time |
| Sprite view | Canvas with `image-rendering: pixelated`, integer zoom 1x to 32x, pan, configurable background (checker, solid colour, custom), pixel grid overlay, cell boundary overlay, hover pixel colour readout |
| Sheet view | Full sheet with frame rectangles, click to select a cell, tag colour coding |
| Animation | Play, pause, step, scrub, fps override, loop and ping-pong, direction selector, onion skin of previous frame, 8-direction simultaneous playback |
| Metadata | Frame size, pivot, palette swatches with counts, clip table, camera and lighting summary, stage hashes, timings |
| Validation | Check list with level, affected frames highlighted on the sheet |
| History | Generation list per asset, select two to compare |
| Compare | Side-by-side, swipe slider, blink toggle, difference heat map with changed-pixel count |
| 3D preview (optional) | Load `model.glb` with three `GLTFLoader` in an orbit view using the same harness materials, lazy loaded |

---

## 11. Claude Code workflow

### 11.1 Discoverability

- `AGENTS.md` at the repository root (under 80 lines) tells an agent how to install, run `td2d doctor`, scaffold an asset, generate, inspect, iterate, and where the schemas are.
- `td2d schema --list` and `td2d schema asset` print JSON Schema on demand; the same files are committed under `schemas/` so they can be read without running anything.
- `td2d describe --json` enumerates every registered part type, pixel pass, preset, exporter and backend together with their option schemas and one example each.
- `td2d --help` and `td2d <command> --help` include an example invocation per command.
- Every error carries a `code`, a `path` into the offending document, a `hint`, and a `docs` link.
- Examples under `examples/` are real projects with committed expected outputs.

### 11.2 Iteration loop

1. Claude Code runs `td2d asset create props/crate --from box` or writes `assets/props/crate/asset.json` by hand using the schema.
2. `td2d validate props/crate --json` checks the definition without rendering.
3. `td2d generate props/crate --json` runs the pipeline and prints output paths plus validation summary.
4. Claude Code reads `manifest.json` and `validation.json`, and views `td2d preview props/crate --scale 8 --out /tmp/crate.png` with its image reader.
5. Claude Code edits the definition (for example the material colour) and reruns `generate`. The cache skips `model` and `rig`; only `render` onward reruns. With `--frames walk/s/0-2` only three samples render.
6. `td2d compare props/crate --against previous --json` quantifies the change.
7. Loop until the acceptance criteria written in the asset's `acceptance` block (optional per-asset checks such as maximum colours, required clips, minimum alpha coverage) pass, which `validate` enforces.

### 11.3 Asset definition example (proposed)

```jsonc
// assets/props/crate/asset.json (proposed)
{
  "$schema": "../../../schemas/asset.schema.json",
  "schemaVersion": "1.0.0",
  "id": "props/crate",
  "type": "prop",
  "description": "Wooden supply crate",
  "frame": { "width": 32, "height": 32 },
  "pixelsPerUnit": 16,
  "camera": "dimetric",
  "lighting": "studio-toon",
  "directions": ["s", "w", "n", "e"],
  "materials": {
    "wood": { "color": "#a0693a", "shading": "toon", "bands": 3, "outline": true },
    "iron": { "color": "#5b6770", "shading": "toon", "bands": 2 }
  },
  "model": {
    "parts": [
      { "id": "body", "type": "box", "size": [1, 1, 1], "position": [0, 0.5, 0], "material": "wood" },
      { "id": "band-x", "type": "box", "size": [1.04, 0.12, 1.04], "position": [0, 0.5, 0], "material": "iron" },
      { "id": "notch", "type": "csg", "op": "subtract", "a": "body", "b": { "type": "cylinder", "radius": 0.15, "height": 0.2, "position": [0, 1.0, 0] } }
    ]
  },
  "animation": { "fps": 10, "clips": { "idle": { "duration": 0.1 } } },
  "pixel": { "palette": "fixed:endesga-32", "outline": { "color": "#1a1c2c", "side": "outside" } },
  "sheet": { "layout": "grid" },
  "export": { "formats": ["aseprite-json", "manifest", "frames"] },
  "acceptance": { "maxColors": 12, "minAlphaCoverage": 0.15 }
}
```

### 11.4 Character example with rig and clip (proposed, abbreviated)

```jsonc
{
  "id": "characters/knight", "type": "character",
  "frame": { "width": 32, "height": 48 }, "pixelsPerUnit": 16,
  "rig": {
    "preset": "humanoid-basic",
    "bones": [
      { "name": "hips", "position": [0, 0.95, 0] },
      { "name": "spine", "parent": "hips", "position": [0, 0.25, 0] },
      { "name": "head", "parent": "spine", "position": [0, 0.45, 0] },
      { "name": "leftUpperLeg", "parent": "hips", "position": [0.12, 0, 0] },
      { "name": "leftLowerLeg", "parent": "leftUpperLeg", "position": [0, -0.45, 0] }
    ]
  },
  "model": { "parts": [
    { "id": "torso", "type": "box", "size": [0.5, 0.6, 0.3], "position": [0, 0.3, 0], "bone": "spine", "material": "steel" },
    { "id": "head", "type": "sphere", "radius": 0.2, "position": [0, 0.2, 0], "bone": "head", "material": "skin" },
    { "id": "l-thigh", "type": "cylinder", "radius": 0.1, "height": 0.45, "position": [0, -0.225, 0], "bone": "leftUpperLeg", "material": "cloth" }
  ] },
  "animation": { "fps": 10, "clips": {
    "idle": { "duration": 1.0, "loop": true, "keys": [ { "t": 0, "pose": {} }, { "t": 0.5, "pose": { "spine": { "rotation": [2, 0, 0] } } }, { "t": 1.0, "pose": {} } ] },
    "walk": { "duration": 0.6, "loop": true, "generator": { "type": "walk-cycle", "stride": 25, "bob": 0.03 } }
  } }
}
```

### 11.5 Workflow tests

Phase 10 adds an automated test that simulates an agent: it reads `AGENTS.md`, calls `td2d schema asset`, writes an asset from the schema's example, generates, parses the envelope, intentionally introduces a schema error, asserts the error path and hint, fixes it, regenerates with a frame filter, and asserts cache hits. This test guards the operator experience against regressions.

---

## 12. End-to-end milestone

The milestone is Phase 2. It is small but exercises the real architecture with no mocks.

Fixture: `examples/starter/assets/props/crate` as in section 11.3 but without CSG, palette or outline (those arrive in later phases). One box with two materials, four directions, one single-frame clip.

The milestone proves:

1. The asset definition validates against the real schema.
2. The `model` stage builds a GLB with gltf-transform and the validator reports zero errors.
3. The `plan` stage emits four samples.
4. The Playwright SwiftShader backend renders four 128 x 128 RGBA frames with transparent background.
5. The `pixel` stage box-downscales to 32 x 32 and thresholds alpha.
6. The `sheet` stage composites a 32 x 128 grid: one row per direction, one column per frame (corrected in Phase 2; the original text said 128 x 32).
7. The `export` stage writes `crate.png`, `crate.json` (Aseprite) and `manifest.json`.
8. The `validate` stage checks dimensions, alpha, non-blank frames and writes `validation.json`.
9. `td2d viewer` lists the asset and displays the sheet with cell overlays.
10. Vitest unit tests, a rendering determinism test, a CLI end-to-end test and a viewer smoke test pass locally and on `ubuntu-24.04` CI.

Measurable success: `pnpm test` green on macOS and Linux; `td2d generate props/crate --json` exits 0 in under 10 seconds cold and under 2 seconds warm; rerunning produces byte-identical PNGs on the same machine; the Linux and macOS sheets differ by at most 0.5 percent of pixels.

---

## 13. Phased implementation roadmap

Phases are ordered by dependency. Phases 0 to 2 validate the risky assumptions and the architecture; 3 to 7 build content capabilities; 8 to 11 build operational depth, the viewer, the operator experience and release readiness. Within a phase, tasks are listed in a sensible execution order; tasks marked `[parallel]` can proceed independently.

Phase dependency graph:

```
0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 7 -> 8 -> 10 -> 11
                    \-> 6 ---^      \-> 9 --^
```

Phase 6 (rig and animation) depends on 3 and 4 and can run alongside 5. Phase 9 (viewer) depends on 7 and 8 and can run alongside 10.

---

### Phase 0: Repository foundation, schema package and CLI skeleton

#### Objective
Create the monorepo, toolchain, shared schema package and a CLI that already behaves the way the finished tool will (JSON envelopes, exit codes, logging), so every later phase builds on stable conventions.

#### Scope
Included: git init, pnpm workspace, TypeScript config, Biome, Vitest, tsdown builds, CI skeleton, `@td2d/schema` with project and asset schemas (model and animation sub-schemas may be stubs), JSON Schema emission, `@td2d/cli` with `init`, `doctor`, `schema`, `describe`, `validate --stage config`, global options, envelope and exit codes, `AGENTS.md` first draft.
Excluded: any rendering, geometry, image processing, viewer.

#### Technical approach
- Root `package.json` with `packageManager: "pnpm@12.8.1"`, workspace scripts `build`, `test`, `lint`, `typecheck`, `schemas`.
- `tsconfig.base.json`: `strict`, `module: nodenext`, `moduleResolution: nodenext`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `rewriteRelativeImportExtensions`, `isolatedDeclarations`, `target: es2024`. Relative imports use `.ts` extensions so Node 24 can run sources directly.
- Packages build with `tsc -b` (JavaScript, declarations and source maps). The CLI build emits `dist/main.js` with a shebang; `bin` points to it. (Changed from tsdown in Phase 0; see the phase notes.)
- zod 4 schemas as the source of truth; a script emits JSON Schema 2020-12 into `schemas/` with `$id` URLs and `description` metadata from `.meta()`.
- commander 15 for parsing; each command re-validates options through a zod schema; a single `runCommand` wrapper handles envelope, exit code mapping, `--json`, TTY detection, pino setup and `SIGINT`.
- Error class `Td2dError { code, message, path?, issues?, hint?, docs? }` with a code registry in schema.

#### Dependencies
None.

#### Implementation tasks
- [x] `git init`, `.gitignore` (node_modules, dist, build/, .td2d/, history/ except examples), `.editorconfig`, `LICENSE` (MIT), `README.md` stub.
- [x] `pnpm-workspace.yaml` listing `packages/*` and `apps/*`; root `package.json` with scripts and pinned devDependencies (typescript 7.0.x, biome, vitest 5, @vitest/coverage-v8, changesets).
- [x] `tsconfig.base.json` and per-package `tsconfig.json` using project references; verify `tsc -b` succeeds (Q9) and that `node packages/cli/src/main.ts --help` runs under Node 24 type stripping.
- [x] `biome.json` with formatter for TS and JSON (2-space, trailing commas none for JSON), lint rules recommended plus `noConsole` off for the CLI output module only.
- [x] `vitest.config.ts` with `projects`: `unit` (node, `packages/**/test/**`), `e2e` (node, `packages/cli/e2e/**`, longer timeout). Browser projects are added in Phase 1 and Phase 9.
- [x] `@td2d/schema`: implement `ProjectConfig`, `AssetDefinition` (frame, pixelsPerUnit, camera ref or inline, lighting ref or inline, directions, materials, model stub, animation stub, pixel, sheet, export, acceptance), `MaterialDefinition`, `PaletteDefinition`, `CameraPreset`, `LightingPreset`, `PixelSettings`, `SheetLayout`, `ExportSettings`, `CliEnvelope`, `ErrorCode` enum, `ValidationReport`, `GenerationRecord`, `BatchReport`, `Manifest`. Each with `.meta({ description, examples })`.
- [x] `emit-json-schema.ts` writing `schemas/<name>.schema.json`; a test asserts committed files match emitted output (fails CI when stale).
- [x] Preset JSON files (in `@td2d/core`) for cameras (section 8.4), lighting (8.5), pixel, sheet and export defaults, and built-in palettes (`endesga-32`, `pico-8`, `db32`, `resurrect-64`, `aap-64`) with source attribution; a test validates each against its schema.
- [x] `@td2d/cli` skeleton: `main.ts`, `runCommand` wrapper, envelope writer, exit code map, pino logger (NDJSON to stderr; pretty transport only when TTY and not `--json`), progress event emitter with TTY renderer (simple line updates, no spinner library yet).
- [x] Commands: `init` (copies the `starter` template from `@td2d/core`, writes `td2d.project.json`), `doctor` (Node version, pnpm, sharp loadable, manifold WASM loadable, Playwright browser present; `--fix` runs `playwright install chromium-headless-shell`), `schema`, `describe` (reads registries, which are empty stubs for now), `validate --stage config`.
- [x] Project loader in core (`packages/core/src/project`): find root, parse `td2d.project.json`, enumerate assets, resolve preset references, apply defaults, path safety helper (`resolveInside(root, p)` with realpath check).
- [x] `AGENTS.md` first draft and `docs/guide/getting-started.md`.
- [x] CI workflow: `ubuntu-24.04` job running install, lint, typecheck, build, test; `macos-15` job running build and e2e only. Cache pnpm store.
- [x] Changesets initialised; release workflow stub (no publish yet).
- [x] Added during the phase: `asset list|show|create`, generated `docs/reference/errors.md`, and a width-aware JSON writer.

#### Acceptance criteria
- `pnpm install && pnpm build && pnpm test && pnpm lint && pnpm typecheck` succeed on macOS and on CI Linux.
- `td2d init /tmp/p && cd /tmp/p && td2d validate --stage config --json` exits 0 with `ok: true`.
- Corrupting `frame.width` to a string makes `validate` exit 3 with `issues[0].path === "frame.width"` and a hint.
- `td2d schema asset` prints a JSON Schema that validates the starter asset using an independent validator (ajv in a test).
- `td2d doctor --json` reports each check with `status` and, when the browser is missing, exit code 7 and a `hint` naming the fix command.
- Non-TTY invocation without `--json` prints no ANSI escape codes.

#### Testing
- Unit: schema parse and reject cases for every document type; preset validity; path safety (traversal, absolute, symlink escape); envelope formatting; exit code mapping.
- E2E: spawn the built CLI in a temp dir with `tinyexec`, `NO_COLOR=1`, non-TTY stdio; assert envelopes and exit codes for `init`, `validate`, `schema`, `doctor`.
- CI: both OS jobs green.

#### Deliverables
Monorepo scaffold, `@td2d/schema` with emitted `schemas/`, `@td2d/cli` with five commands, core project loader, presets and palettes, `AGENTS.md`, getting-started guide, CI.

#### Risks and mitigations
- TypeScript 7 tooling gaps (Q9, Q10): if `tsc -b` or isolated declarations fail, pin TypeScript 6.0 and record the decision in `docs/roadmaps/phase-0.md`.
- commander ESM-only with Vitest pools: verified in the e2e test; fallback is stricli.

---

### Phase 1: Render backend validation and harness

#### Objective
Prove headless, deterministic, transparent-background orthographic rendering of a GLB through the production `RenderBackend` interface on macOS and GPU-less Linux CI, before any pipeline code depends on it.

#### Scope
Included: `@td2d/render-harness` isomorphic scene builder and browser entry; Playwright SwiftShader backend in core; determinism and cross-OS tolerance tests; `td2d render` operating on a hand-placed GLB fixture.
Excluded: model building from definitions, pixel processing, sheets.

#### Technical approach
- Harness built by Vite into one HTML file with inlined JS (`vite-plugin-singlefile` or equivalent) and shipped in the package `dist/`. Node loads the file contents and serves them through `page.route('https://td2d.local/harness', ...)`. A secure-looking origin keeps future WebGPU options open.
- Browser API: `window.__td2d.loadModel(base64Glb)`, `window.__td2d.configure(jobWithoutSamples)`, `window.__td2d.renderSamples(samples[]) -> { key, width, height, rgbaBase64 }[]`. Readback via `gl.readPixels` on the WebGL context after each render (`preserveDrawingBuffer` not needed). Batches of 16 samples per evaluate call to bound memory.
- Determinism settings enforced in the harness: `antialias: false`, `BasicShadowMap`, all textures `NearestFilter` without mipmaps, `toneMapping: NoToneMapping`, `outputColorSpace: SRGBColorSpace`, no `Math.random` or time usage; a lint test greps the harness for `Math.random`, `Date.now`, `performance.now`.
- Browser launch: `chromium` headless shell with args `--use-angle=swiftshader`, `--enable-unsafe-swiftshader`, `--disable-gpu-watchdog`; `td2d doctor` records the renderer string reported by `WEBGL_debug_renderer_info`. A backend option `allowHardware: true` drops the SwiftShader flags for speed at the cost of reproducibility, off by default.
- Frames are written as PNG via sharp from the raw RGBA (vertical flip handled in Node).
- Camera: `OrthographicCamera` sized from `frame * supersample / pixelsPerUnit`; pitch and yaw from the job; pixel-grid snapping of the pivot in camera space.

#### Dependencies
Phase 0.

#### Implementation tasks
- [x] Create `packages/render-harness` with Vite single-file build, `three` 0.186 pinned exactly, type-only dependency on `@td2d/schema`.
- [x] `scene.ts`: `createScene(job)` builds scene, camera, lights (directional with shadow, ambient), optional ground shadow catcher (`ShadowMaterial`, off by default), loads GLB with `GLTFLoader.parseAsync` from an ArrayBuffer, applies `extras.td2d` material mapping (Phase 3 fills this out; Phase 1 maps `baseColorFactor` to `MeshToonMaterial` with a 3-band gradient).
- [x] `capture.ts`: render the given sample (set camera yaw, set mixer time if clips exist), `readPixels`, return `Uint8Array`.
- [x] `browser-entry.ts`: expose `window.__td2d`; report capabilities (`isWebGL2`, renderer string, max texture size).
- [x] Core `render/playwright/backend.ts` implementing `RenderBackend`: launch, route, load, batch, decode, flip, sink; honour `AbortSignal` by closing the browser; map Playwright errors to `E_BACKEND_*` codes.
- [x] Core `render/frames.ts`: frame key to path, PNG encode via sharp, PNG decode.
- [x] Core `render/registry.ts`: backend registry keyed by id; `playwright-swiftshader` registered.
- [x] CLI `render` command accepting `--glb <file>` for this phase (the asset path comes in Phase 2), plus `--directions`, `--frame-size`, `--supersample`, `--camera`, `--lighting`.
- [x] Fixture GLBs under `packages/core/test/fixtures/models/`: unit cube with two materials, a cylinder, and a small skinned arm with one clip (generated by a script using gltf-transform so fixtures are reproducible).
- [x] Determinism test: render the cube fixture twice in separate browser launches, assert byte-identical PNGs.
- [x] Cross-OS tolerance test: commit golden PNGs rendered on macOS; CI on Linux compares with pixelmatch `threshold 0.1` and asserts mismatch ratio below 0.5 percent (Q1, Q2). Record actual numbers in `docs/roadmaps/phase-1.md`.
- [x] Performance test: 64 samples at 128 px complete in under 3 seconds including launch on CI.
- [x] `doctor` extended: launches the browser, renders a 4 px scene, reports renderer string and timing.
- [x] Added during the phase: `W_FRAME_CLIPPED` and `W_BLANK_FRAME` warnings, `--td2d-run` process tagging, and a Docker run of the render suite on Linux arm64 and x86_64.
- [x] Vitest browser project for the harness (`@vitest/browser-playwright`, chromium, same flags) with one test that creates a scene and asserts non-zero alpha coverage.

#### Acceptance criteria
- `td2d render --glb fixtures/cube.glb --directions s,w,n,e --out /tmp/f --json` exits 0 and writes four PNGs with alpha channel, correct dimensions and non-blank content.
- Determinism test passes on macOS and on Linux CI.
- Cross-OS golden comparison stays under the 0.5 percent mismatch budget; the measured value is recorded.
- Cancelling with SIGINT during a render exits 130 within 2 seconds and leaves no browser process.
- `td2d doctor` reports a SwiftShader renderer string on both platforms.

#### Testing
- Unit: camera frustum maths (frame, ppu, supersample), yaw and pitch conversions, pixel snapping, PNG flip.
- Rendering: determinism, cross-OS tolerance, alpha transparency, output dimensions, skinned fixture at two times differs, cancellation.
- Browser: harness smoke test under Vitest browser mode.
- CI: Linux job installs `chromium-headless-shell` via `pnpm exec playwright install --with-deps chromium-headless-shell` and runs rendering tests without xvfb.

#### Deliverables
`@td2d/render-harness` package with built single-file harness, Playwright backend, backend registry, `td2d render --glb`, fixtures, golden images, phase notes with measured numbers.

#### Risks and mitigations
- Chrome drops `--enable-unsafe-swiftshader` (policy risk): pin Playwright; keep the headless-gl backend (Phase 11) as an escape hatch; a doctor check surfaces the problem early.
- Linux CI renders differ beyond tolerance: investigate shadow map and sRGB paths first; if irreducible, keep per-OS golden sets for render tests while post-quantisation tests remain exact.
- Large GLB transfer over `evaluate` is slow: measured per-call limits; switch to `page.route` serving the GLB over fetch if base64 exceeds 10 MB.

---

### Phase 2: Minimum end-to-end milestone

#### Objective
Deliver the complete pipeline for a single simple asset: definition to validated sprite sheet to viewer, with cache and history in their simplest working form, so every later phase extends a working system.

#### Scope
Included: `model` stage for `box`, `cylinder`, `sphere` parts with transforms and flat or toon colours; `plan`, `render` (from Phase 1), `pixel` (box downscale, alpha threshold, bleed), `sheet` (grid), `export` (Aseprite JSON, manifest, frames), `validate` (dimensions, alpha, blank, bounds), `record` (generation.json, history copy), stage runner with content-hash cache, `generate`, `inspect`, `preview`, `history list`, minimal viewer (library list, sheet view with cell overlay), CLI e2e test, CI.
Excluded: CSG, imports, palettes, outlines, rigs and clips beyond a single static frame, packed layouts, batch, compare.

#### Technical approach
- Model build in Node: for each part, construct a three geometry, apply TRS, `toNonIndexed`, merge per material, `mergeVertices`, compute normals; write with gltf-transform (`Document`, one mesh primitive per material, `COLOR_0` not yet needed), set `extras.td2d` per material; run `gltf-validator` and fail on errors.
- Stage runner: topological order over registered stages; each stage declares `inputs(resolved) -> hashable`, `run(ctx) -> outputs`; cache directory per stage keyed by sha256; outputs restored by copying files; `generation.json` records hits.
- Pixel stage pure functions over `{ width, height, data: Uint8Array }`: `boxDownscale(src, factor)` in premultiplied space (implemented in TS for exactness; sharp is used only for PNG encode and decode), `thresholdAlpha(img, 128)`, `bleedEdges(img, radius)`.
- Sheet: grid rows per `clip x direction` in plan order, columns per frame; `sharp.composite`.
- Export: Aseprite JSON Hash per section 4.5, `manifest.json` per section 8.8, individual frames when requested.
- Validation: dimensions equal expected, every alpha is 0 or 255, alpha coverage above 0.5 percent, opaque bounding box inside the frame with ground row within tolerance.
- Viewer v0: Hono server with `/api/index`, `/api/assets/:id`, static files; React SPA with asset list and sheet canvas with cell rectangles and zoom.

#### Dependencies
Phases 0 and 1.

#### Implementation tasks
- [x] Schema: finalise `ModelDefinition` for primitive parts (`box`, `cylinder`, `sphere`, `plane`) with `size`/`radius`/`height`, `position`, `rotation` (degrees), `scale`, `material`, `visible`; `AnimationDefinition` with `fps` and clips having `duration` only.
- [x] Core `model/parts/registry.ts` with a `PartBuilder` interface `{ type, schema, build(def, ctx) -> BufferGeometry }` and the four primitive builders.
- [x] Core `model/build.ts`: assembly compile, material grouping, GLB write, validator call, `model-report.json` (bounds, triangle count, materials).
- [x] Core `plan/`: frame plan from directions and clips (single frame at t = 0 when no keys).
- [x] Automatic ground margin (found in Phase 1): when `camera.groundMargin` is `"auto"` (the new default), compute the smallest margin that keeps the model's projected footprint at least one pixel above the bottom edge in every direction, and record it in the manifest.
- [x] Core `pixel/` passes above with exhaustive unit tests on tiny synthetic images.
- [x] Core `sheet/grid.ts` and `sheet/composite.ts`.
- [x] Core `export/aseprite.ts`, `export/manifest.ts`, `export/frames.ts`.
- [x] Core `validate/image-checks.ts` and report writer.
- [x] Core `pipeline/`: stage registry, DAG runner, cache (`.td2d/cache/<stage>/<hash>/`), progress events, `--from`, `--to` (replacing the ambiguous `--only`), `--force`, `--no-cache`, `--dry-run`.
- [x] Core `history/`: on success copy `sheets/` and reports into `history/<id>/<ISO timestamp>-<shortHash>/`.
- [x] CLI: `generate`, `inspect`, `preview` (upscale sheet with nearest via sharp, draw cell borders), `history list`, `model build`, `model inspect`; `render` now takes an asset id.
- [x] `examples/starter` with the crate asset and committed expected `manifest.json` and sheet.
- [x] `apps/viewer` v0 with server, SPA, `td2d viewer` command, Vite build wired into the CLI package so `td2d viewer` works from the published package.
- [x] E2E test: fresh `td2d init` in a temp dir, `generate props/crate --json`, assert envelope, files, manifest content, Aseprite JSON validity against a committed schema, validation pass, second run all cache hits, `--force` recomputes, `--dry-run` lists misses.
- [x] Viewer smoke test with Playwright: start server against the example build, load SPA, assert asset appears and sheet image renders.
- [x] `docs/roadmaps/phase-2.md` with timings and the Linux versus macOS mismatch figure for the crate sheet.
- [x] Added during the phase: render-time materials, automatic ground margin, `inspect --frame`, preview `--out`/`--overwrite`, partial-run materialisation that keeps still-valid outputs, and the `docs/guide/generating.md` guide.

#### Acceptance criteria
- All items in section 12 are demonstrated by automated tests.
- Cold `generate` under 10 s, warm under 2 s on the development machine; numbers recorded.
- `generation.json` shows cache hits for `resolve`, `model`, `plan` on a second run and a miss for `render` only after changing a material colour.
- Viewer displays the crate sheet with four cell rectangles.

#### Testing
- Unit: part builders (vertex counts, bounds), merge behaviour with mixed index state, pixel passes (box average exactness, threshold edge cases, bleed correctness), grid layout maths, Aseprite JSON shape, manifest shape, image checks, cache key stability (reordering JSON keys does not change the hash; changing a value does).
- Integration: definition to GLB, GLB to frames, frames to sheet, sheet to exports.
- Rendering: crate golden with tolerance.
- E2E and viewer smoke as above.

#### Deliverables
Working `td2d generate` for primitive props, cache and history v0, viewer v0, starter example with expected outputs, phase notes.

#### Risks and mitigations
- Box downscale in TS too slow for large frames: 512 px frames measured; if above 20 ms per frame, move to sharp `resize` with `kernel: 'linear'` after verifying equivalence on the golden set.
- gltf-validator "dev" versioning: pin exactly; wrap so a validator crash degrades to a warning with `W_VALIDATOR_UNAVAILABLE`.

---

### Phase 3: Model definition language and geometry

#### Objective
Give Claude Code an expressive, validated, declarative way to build real props and characters: more primitives, CSG, lathe and extrude, reusable components, transforms with pivots, external GLB import, and model validation.

#### Scope
Included: part types `lathe`, `extrude`, `torus`, `cone`, `capsule`, `wedge`, `csg` (union, subtract, intersect, hull), `group`, `component` (reference to a parts file with parameters), `import` (GLB file with node selection and material remap), mirroring and array repeat modifiers, per-part `pivot`, vertex colours, model validation rules, `model` commands, TypeScript SDK that emits definitions.
Excluded: voxels (future extension, see section 18), skinning (Phase 6), textures beyond small images (future).

#### Technical approach
- `csg` parts run through manifold-3d: convert three geometries to `Manifold.ofMesh` (throws `NotManifold`, mapped to `E_PART_NOT_MANIFOLD` with the offending part id), apply operations, read back with `getMesh`, carry `runOriginalID` to preserve per-source materials, compute flat normals.
- `component` resolves a JSON file exporting `{ params: {schema}, parts: [...] }` with `${param}` substitution validated by schema; recursion depth limited to 8.
- `import` loads a GLB with gltf-transform, optionally `select: ["nodeName"]`, applies material remap by name, bakes node transforms, re-centres to pivot rules, and validates size.
- Modifiers: `mirror: "x"` duplicates with negated axis and flipped winding; `repeat: { count, offset }` arrays parts; both are schema-defined and resolved before building.
- TypeScript SDK (`@td2d/core/sdk`): typed builders (`box()`, `cylinder()`, `subtract()`, `component()`) returning plain definition objects; `td2d asset emit <script.ts>` runs the script in a sandboxed child process (Phase 11 hardening; Phase 3 runs it with a timeout and documents the risk) and writes `asset.json`.
- Validation rules: non-zero sizes, bounds within `frame / pixelsPerUnit` frustum, triangle ceiling (default 50k, warn at 20k), degenerate triangles, duplicate part ids, unknown materials, manifold check for CSG inputs, origin below ground warning, validator errors.

#### Dependencies
Phase 2.

#### Implementation tasks
- [x] Schema: extend `PartDefinition` as a discriminated union on `type`; add `pivot`, `mirror`, `repeat`, `vertexColor`; add `ComponentFile` and `ImportDefinition` schemas; regenerate JSON Schema with examples per part type.
- [x] Part builders: `lathe` (profile points, segments), `extrude` (2D shape points with holes, depth, bevel off), `torus`, `cone`, `capsule`, `wedge`, `plane`.
- [x] `csg` builder using manifold-3d with a WASM module singleton and `gltf-io` bridge; material preservation; unit tests on known volumes (cube minus cylinder volume within 1 percent of analytic).
- [x] `group` and transform inheritance; `component` loader with parameter substitution and cycle detection.
- [x] `import` builder with gltf-transform: node selection, material remap, transform bake, unit scale option.
- [x] Modifiers `mirror` and `repeat`.
- [x] Vertex colours: per-part `color` overrides become render-time material variants (`<material>~<part id>`) instead of `COLOR_0`, so geometry stays colour-free; imported `COLOR_0` is kept and the harness honours it.
- [x] Model validation module with rule registry; `td2d validate --stage model`; warnings versus errors as defined above.
- [x] `td2d model inspect` extended: per-part triangle counts, materials, bounds, manifold status, validator summary.
- [x] TypeScript SDK with builders and `defineAsset()`; `td2d asset emit`.
- [x] Examples: `examples/props` (barrel via lathe, sword via extrude, crate with CSG notch, fence via repeat, imported teapot GLB, plus lamp, ramp and totem), each with committed expected manifests and sheets.
- [x] Docs: `docs/guide/models.md` covering every part type with a snippet and rendered preview image.
- [x] Added during the phase: `W_MODEL_OUT_OF_FRAME` computed by projecting the model in the plan stage, automatic removal of zero-area triangles, per-part closedness in `model inspect`, and a write-blocking script sandbox using Node's permission model (pulled forward from Phase 11).

#### Acceptance criteria
- Every part type has a schema example that builds, validates and renders in the example project.
- A CSG subtraction yields a GLB with validator zero errors and the expected material split.
- Non-manifold CSG input produces `E_PART_NOT_MANIFOLD` naming the part id and exits 3.
- Component recursion beyond the limit produces `E_COMPONENT_CYCLE`.
- An imported GLB larger than the frustum produces `W_MODEL_OUT_OF_FRAME` with measured bounds in the message.
- `td2d asset emit examples/props/scripts/barrel.ts` writes a definition identical to the committed JSON.

#### Testing
- Unit: each builder's vertex and bounds invariants; CSG volumes; component substitution; mirror winding; repeat counts; validation rules with positive and negative fixtures.
- Integration: build every example and validate GLBs.
- Rendering: golden sprites per example with tolerance.
- E2E: `generate` on the props example project.

#### Deliverables
Part type registry with eleven types, CSG, components, imports, modifiers, model validation, SDK, props examples, models guide.

#### Risks and mitigations
- manifold-3d WASM load time (hundreds of ms): load lazily on first CSG part; cache the instance per process.
- CSG output lacks normals and UVs: compute flat normals; document that CSG parts are flat-shaded.
- Extrude non-indexed merge problems: normalised in Phase 2 merge path; covered by tests.

---

### Phase 4: Camera, lighting and composition

#### Objective
Make framing, scale, ground alignment, direction sets and lighting fully configurable and stable across frames and directions, with presets that produce consistent assets across a whole project.

#### Scope
Included: camera presets and inline cameras, custom direction sets, mirrored directions, `pixelsPerUnit` and frame fitting helpers, auto-fit mode, ground alignment and shadow catcher, lighting presets and inline lights (directional, ambient, hemisphere, rim), camera-locked versus world-locked lights, shadow settings, render settings exposure (supersample, backend options), composition validation.
Excluded: perspective cameras, post-process effects.

#### Technical approach
- Resolved camera: `projection`, `pitch`, `yawOffset`, `pixelsPerUnit`, `frame`, `supersample`, `near`, `far`, `pivot`, `groundMargin`, computed frustum. `fit: 'auto'` computes `pixelsPerUnit` from the model bounds so the largest extent across all directions and clip poses fits the frame with margin; the computed value is written into the manifest so later runs can pin it.
- Pixel snapping as section 8.3, applied in camera space to the pivot each sample.
- Lighting resolved into a list of typed lights with `space: 'camera' | 'world'`; camera-locked lights are parented to the camera object in the harness.
- Shadow catcher plane: optional `groundShadow: { enabled, opacity }` using `ShadowMaterial`, which produces a soft dark ellipse that the pixel stage will threshold; documented as a stylistic option.
- Composition validation: the ground row of the sprite must equal `frame.height - groundMargin` within 1 px for the rest pose; per-direction bounding boxes must not touch the frame edge.

#### Dependencies
Phase 2 (Phase 3 recommended for richer examples).

#### Implementation tasks
- [x] Schema: `CameraDefinition` (inline or preset name plus overrides), `DirectionSet` (named list or `{ count, start }`), `LightingDefinition` with light union types, `RenderSettings`.
- [x] Core `plan/camera.ts`: resolve, fit, frustum, snapping; `plan/directions.ts` with built-in sets `d8`, `d4`, `d1-side`, `d16` and custom.
- [x] Harness: camera rig object (pitch, yaw, snapped pivot), light construction from resolved lighting, camera-locked parenting, shadow map configuration (`BasicShadowMap`, size, bias), shadow catcher.
- [x] Mirrored directions in `plan` (render source direction, flip in `pixel` stage; record `mirrored: true` in cells).
- [x] Composition validation rules and `W_COMPOSITION_*` warnings.
- [x] `td2d preview --directions all` layout showing the direction ring.
- [x] Examples: the same prop rendered with `dimetric`, `isometric`, `side`, `top` presets; a lighting comparison example.
- [x] Docs: `docs/guide/camera-and-lighting.md` with diagrams of pitch and yaw conventions and a table of presets.
- [x] Added during the phase: the toon ramp now spreads bands over the lit hemisphere and lighting presets are calibrated from measured three.js light scaling (intensity / pi), a `studio-rim` preset, counted direction sets `{ count, start }`, and `scripts/docs-images.ts` to regenerate every guide picture.

#### Acceptance criteria
- Changing only the camera preset reruns `plan` and later stages, not `model`.
- Rendering a sphere in all eight directions yields bounding boxes identical to within 1 px.
- Camera-locked lighting produces identical shading histograms for a sphere across all directions (test compares per-direction colour histograms within 2 percent).
- `fit: 'auto'` places the tallest clip pose within the frame with the configured margin and records `pixelsPerUnit` in the manifest.
- Ground alignment check passes for all examples; a deliberately floated model triggers `W_COMPOSITION_GROUND`.

#### Testing
- Unit: frustum and fit maths, snapping, direction angle generation, mirror mapping, light resolution.
- Rendering: sphere direction invariance, lighting histograms, shadow presence test (dark pixels under an elevated box).
- Integration: preset overrides resolution.

#### Deliverables
Camera and lighting subsystem, direction sets, fit mode, composition validation, examples, guide.

#### Risks and mitigations
- Snapping interacts with `fit: 'auto'` producing off-by-one ground rows: tests across sizes 16 to 128 px and ppu values 8 to 64.
- Shadow acne or peter-panning at low shadow map resolution: expose `shadow.bias` and `shadow.normalBias`, defaults tuned on the example set.

---

### Phase 5: Pixel-art processing and sprite validation

#### Objective
Turn supersampled renders into convincing, consistent pixel art with configurable palettes, dithering, outlines and cleanup, and validate the result automatically.

#### Scope
Included: pass pipeline with ordered configurable passes; palettes (fixed, automatic per asset or per clip); Oklab nearest mapping; ordered dither; posterise; outlines (outside, inside, colour, width); orphan cleanup; indexed PNG output; sprite validation (palette compliance, jitter, bounds consistency); experiments Q3, Q6, Q7, Q8.
Excluded: hand-retouch tooling, learned pixelisation.

#### Technical approach
- `PixelPass` interface `{ id, schema, version, apply(img, options, ctx) -> img }` with a registry and a default order: `downscale`, `alphaThreshold`, `posterize?`, `palette?`, `dither?`, `outline?`, `cleanup?`, `bleed`, `mirror?`. Order is fixed by default but overridable per asset via `pixel.passes` for experiments.
- Palette module: `Palette.fromHexList`, `Palette.fromImages(frames, n)` using WuQuant from `image-q` (vendored subset or dependency, MIT; implemented in-house instead, see the phase notes), Oklab conversion, nearest lookup with a cache keyed on RGB, Bayer matrices 2, 4, 8 with configurable strength.
- Automatic palette computed once per asset by default (over all frames), optionally per clip (Q7). Palette is written to the manifest.
- Outline: morphological dilate or erode of the binary alpha mask with 4- or 8-connectivity, fill ring with colour; runs after palette unless `outline.snapToPalette` is set.
- Orphan cleanup: remove opaque pixels with fewer than `minNeighbours` opaque 4-neighbours, or recolour to majority neighbour; counts reported.
- Indexed PNG via sharp `palette: true, colours: n, dither: 0` only for the final encode; the pipeline keeps RGBA until then. Q8 decides whether to encode indexed PNGs with sharp or write PLTE chunks directly with a small in-house encoder (pngjs based) to avoid the libimagequant question entirely; default plan is the in-house PLTE writer since the palette is already known.
- Validation: every opaque pixel in the palette when a palette is set; alpha binary; per-frame bounding boxes within `maxBoundsDrift` of the clip median; centroid drift between consecutive frames below `maxJitter` px unless the clip declares `motion: true`; blank frames; orphan count below threshold.
- Experiments recorded in `docs/roadmaps/phase-5.md`: Q3 (supersample 4 plus box versus 1x on a walking capsule fixture; metric: per-frame silhouette edge count variance), Q6 (threshold 100, 128, 160 on a thin sword), Q7, Q8.

#### Dependencies
Phase 4 (Phase 6 fixtures help the jitter tests but a procedurally moved rigid fixture suffices).

#### Implementation tasks
- [x] Schema: `PixelSettings` with pass options and `passes` override; `PaletteDefinition`; acceptance options `maxColors`, `maxJitter`, `maxBoundsDrift`.
- [x] Core `pixel/passes/*` implementing the passes above with exhaustive unit tests on synthetic images.
- [x] Core `pixel/palette/*`: Oklab, fixed palettes loader, automatic palette, nearest cache, dither matrices.
- [x] In-house indexed PNG writer (PLTE and tRNS) with a test that sharp and a browser decode it identically.
- [x] Validation rules above with reports listing affected frames.
- [x] CLI: `td2d process <id>` to rerun `pixel` from cached frames; `inspect --frame` prints colour count, bounds, centroid.
- [x] Experiments Q3, Q6, Q7, Q8 as scripted Vitest "bench" tests writing images and metrics to `docs/roadmaps/assets/`; set defaults accordingly and update section 8.7 defaults in the docs.
- [x] Examples: palette comparison sheet (`none`, `endesga-32`, `auto:16`), outline styles, dither strengths.
- [x] Docs: `docs/guide/pixel-art.md` with before and after images per pass.
- [x] Added during the phase: a `mode` downscale filter (now the default, from Q3), the top-left tie rule for half-covered pixels, an in-house Wu quantiser replacing `image-q`, room for outside outlines in the automatic ground margin and scale, `acceptance.maxOrphans`, clip `motion`, a `cleanup` entry in validation reports, `W_PALETTE_PER_CLIP`, `examples/pixel`, and `pnpm experiments`.

#### Acceptance criteria
- Fixed palette mode produces sprites whose opaque pixels all belong to the palette (validation passes) and whose indexed PNG opens correctly in the viewer and in a standard image tool.
- Automatic palette with `auto:16` yields at most 16 colours plus transparency.
- Outline pass adds exactly one ring pixel width around every opaque region in a synthetic test image.
- Pixel stage for a 32 x 48 frame from a 128 x 192 render runs under 5 ms per frame on the development machine.
- Jitter validation flags a fixture with injected 3 px centroid jumps and passes the walking fixture.
- Experiment results are recorded with images and the chosen defaults are justified in the phase notes.

#### Testing
- Unit: every pass with synthetic images, Oklab conversions against reference values, dither determinism, PNG writer round trip.
- Integration: full pixel pipeline on the Phase 2 crate frames with exact golden comparison (post-quantisation output is exact within a backend).
- Validation: positive and negative fixtures per rule.

#### Deliverables
Pass registry, palette module, indexed PNG writer, sprite validation rules, experiments with recorded outcomes, examples, guide.

#### Risks and mitigations
- Automatic palettes flicker across clips: per-asset default; `W_PALETTE_PER_CLIP` when per-clip mode is chosen.
- Dark halos despite bleed when engines use mipmaps: `sheet.extrude` option (Phase 7) and docs.
- Licence ambiguity of libimagequant inside libvips: avoided by the in-house PLTE writer.

---

### Phase 6: Rigging and animation

#### Objective
Enable animated characters: bone hierarchies, rigid part attachment, optional skinning, pose-keyframe clips, procedural clip generators, deterministic sampling, and multi-direction animated sheets.

#### Scope
Included: rig definition with bones and presets (`humanoid-basic`, `quadruped-basic`, `none`), part-to-bone attachment, optional per-part skinning weights (`rigid`, `nearest-bone`, `two-bone-blend`), clips with keys and easing, generators (`walk-cycle`, `idle-breathe`, `bob`, `spin`), clip sampling policy (frame count, time offsets, loop), glTF skin and animation writing, clip validation, `rig` commands, Q4 and Q5 experiments.
Excluded: IK (future), retargeting from Mixamo (future, VRM names make it possible), blend trees.

#### Technical approach
- Rig resolved to a bone tree with rest-pose TRS; glTF nodes created with gltf-transform; parts attached rigidly are parented to bone nodes (no skin). Skinned parts get `JOINTS_0` and `WEIGHTS_0` with a `Skin` and inverse bind matrices; joints with zero weight are indexed 0 to satisfy the validator.
- Clips: keys hold a sparse `pose` map of bone to `{ rotation: [x, y, z] degrees | quaternion, translation?, scale? }`; missing bones hold the rest pose; easing names from a fixed set (`linear`, `step`, `ease-in-out`, `ease-out`, ...); clips are baked at the asset fps into glTF samplers (LINEAR or STEP per Q4) so the harness samples with `AnimationMixer.setTime` without any easing logic in the renderer.
- Generators are pure functions producing keys from parameters, evaluated at `rig` stage, with their output visible via `td2d model inspect --clip walk --keys`.
- Frame plan: `frames = round(duration * fps)`; sample times `i / fps` for loops (last frame excluded when `loop: true` so the loop is seamless) or `i / (frames - 1) * duration` for one-shot clips; per-clip override `sampleTimes`.
- Clip validation: all referenced bones exist, duration divisible by frame period within tolerance (warning), rotations within declared limits, foot ground contact check for `walk-cycle` (lowest point of foot parts within 1 px of ground in contact frames).

#### Dependencies
Phases 3 and 4.

#### Implementation tasks
- [x] Schema: `RigDefinition`, `BoneDefinition`, `SkinningMode`, `ClipDefinition` with `keys` or `generator`, easing enum, sampling options; JSON Schema examples.
- [x] Core `rig/build.ts`: bone tree, rest pose, part attachment, skinning weight assignment, gltf-transform skin writing.
- [x] Core `rig/clips.ts`: key interpolation with easing, baking to samplers, loop handling, STEP or LINEAR.
- [x] Core `rig/generators/*`: `walk-cycle` (hip sway, leg swing with phase offset, arm counter-swing, bob), `idle-breathe`, `bob`, `spin`; registry with schemas.
- [x] Rig presets `humanoid-basic` (VRM names, 15 bones) and `quadruped-basic` as JSON under schema presets.
- [x] Harness: `AnimationMixer` per model, `setTime` per sample, skinned mesh support with `NearestFilter` irrelevant; verify `SkinnedMesh.frustumCulled = false`.
- [x] Plan: clip sampling policies; direction x clip x frame ordering; `--frames` filter syntax `clip/dir/range`.
- [x] Clip validation rules.
- [x] CLI: `td2d model inspect --clip`, `td2d render --clips`, `preview --clip` showing frames in a row.
- [x] Experiments Q4 (STEP versus LINEAR on walk at 10 fps; metric: reviewer rating plus silhouette variance), Q5 (rigid versus nearest-bone on an arm bend at 32 px; metric: pixel difference and visual review).
- [x] Example: `examples/characters/knight` with `idle`, `walk`, `attack` in 8 directions, committed expected manifest.
- [x] Docs: `docs/guide/rigging-and-animation.md` including the VRM bone table and generator parameters.
- [x] Added during the phase: a `rig` stage, CPU pose evaluation so framing and ground contact use every rendered pose, `td2d rig list|show`, rig-less prop animation through a root node, left-right bone swapping on mirrored parts, `heightSegments` for cylinders and capsules, rig presets in `td2d describe` and `td2d schema rig-preset`, and a fix so one-shot clips hold their last pose.

#### Acceptance criteria
- The knight example generates a 8-direction, 3-clip sheet with validation pass and jitter under threshold.
- Changing a clip key reruns `rig` and later stages while `model` stays cached.
- `walk-cycle` foot contact check passes for the example; forcing `stride` too large triggers `W_CLIP_FOOT_CONTACT`.
- `AnimationMixer` sampling of the same clip at the same time in two separate renders is byte-identical.
- Q4 and Q5 results recorded; defaults set.

#### Testing
- Unit: easing functions, key interpolation, baking, loop sample times, generator outputs at known parameters, weight assignment sums to 1, inverse bind matrices.
- Integration: rig to GLB with validator zero errors; clip count and durations read back with gltf-transform.
- Rendering: skinned arm fixture golden at three times; direction x clip plan ordering test.
- E2E: knight example generation.

#### Deliverables
Rig and clip subsystem, generators, presets, harness animation support, knight example, guide.

#### Risks and mitigations
- Skinning artifacts at low resolution: rigid default; skinning opt-in per part.
- Validator joint-weight rule: handled in the writer; test asserts zero validator errors.
- Clip edits invalidating cache for all directions: expected; `--frames` filter plus per-sample render cache (Phase 8) narrows reruns.

---

### Phase 7: Sprite sheets, export formats and metadata

#### Objective
Produce sheets and metadata that drop into common engines, with layouts beyond a simple grid, trimming, padding, extrusion, multi-sheet splitting and a stable, documented manifest.

#### Scope
Included: grid layout options (row and column ordering, per-direction sheets, per-clip strips), packed atlas via maxrects with trim and `spriteSourceSize`, padding and extrude, power-of-two and max-size constraints with splitting, exporters `aseprite-json` (hash and array), `manifest`, `frames`, `pixi`, `phaser-atlas`, `godot-spriteframes` (Q14), `gif-preview` (optional, for quick viewing), manifest finalisation with `schemaVersion` 1.0.0 and compatibility policy, export validation (JSON schema check, image and JSON consistency).
Excluded: Unity, Spine, Unreal formats (future via exporter registry).

#### Technical approach
- `SheetLayout` resolved into a cell placement list `{ key, sheet, x, y, w, h, trimmed, sourceRect }`. Grid layouts are computed in-house; packed layouts use `maxrects-packer` with `smart`, `pot`, `padding`, `border`; trimming computes the tight alpha bounds per cell and records offsets so pivots remain correct.
- Extrude duplicates edge pixels outward by `n` px after placement.
- Exporters are registered `{ id, schema, version, write(ctx) -> files[] }`. Aseprite exporter follows the shape in section 4.5 exactly, including `frameTags` with `direction` and `duration` from fps, `slices` carrying the pivot, and `meta.app` set to the tool name and URL.
- Godot exporter writes a `.tres` `SpriteFrames` resource plus `AtlasTexture` sub-resources; verified by importing into a Godot 4 project in a documented manual check and by a text golden in CI (Q14).
- Manifest compatibility policy: additive changes bump minor; renames or removals bump major with a migration note in `docs/reference/manifest.md`.

#### Dependencies
Phases 5 and 6.

#### Implementation tasks
- [x] Schema: `SheetLayout` union (`grid`, `strips`, `packed`), `ExportSettings` with per-format options, final `Manifest` schema with `cells`, `sheets`, `clips`, `palette`, `pivot`, `stages`.
- [x] Core `sheet/grid.ts` extended (ordering options, per-direction and per-clip sheets), `sheet/pack.ts` (maxrects, trim, split), `sheet/extrude.ts`.
- [x] Exporters: `aseprite-json` (hash and array variants), `pixi`, `phaser-atlas`, `godot-spriteframes`, `frames`, `gif-preview` (using a small GIF encoder with the known palette; optional dependency).
- [x] Export validation: every exporter's JSON validated against a committed JSON Schema for that format; cell rectangles within sheet bounds; frame count equals plan count.
- [x] CLI: `td2d sheet`, `td2d export --format`, `inspect --cells`.
- [x] Docs: `docs/reference/manifest.md`, `docs/reference/export-formats.md` with import instructions per engine; `docs/guide/sprite-sheets.md`.
- [x] Examples updated with `packed` layout variant and all exporters; a Phaser and a PixiJS minimal HTML page under `examples/engines/` that load the exported atlas and play a clip, used as a manual verification aid and a Playwright smoke test.
- [x] Added during the phase: Aseprite index frame names for Phaser, sequences kept whole on one sheet, a Phaser multi-atlas page mode, `cells-in-bounds` and `frame-count` checks, `td2d preview --sheet`, sheet tabs in the viewer, `scripts/godot/check.sh` loading the export in Godot 4.7.2, an in-house GIF encoder, and type checking for scripts.

#### Acceptance criteria
- Aseprite JSON produced for the knight loads in the Phaser example page and plays `walk_s` (Playwright test asserts the sprite frame changes).
- PixiJS spritesheet loads in the Pixi example page.
- Packed layout with trim keeps pivots correct: rendering trimmed cells back into a frame at `spriteSourceSize` offsets reproduces the untrimmed cells exactly (test).
- Sheets over `maxSize` split into numbered sheets with consistent manifest references.
- Godot `.tres` output matches the committed golden and the manual import check is documented.

#### Testing
- Unit: layout maths, packing determinism (same input, same placement), trim offsets, extrude correctness, each exporter's JSON against schema.
- Integration: sheet to exporters for all examples.
- Browser: Phaser and Pixi example pages.

#### Deliverables
Layout engine, exporter registry with six exporters, manifest 1.0.0, format references, engine example pages.

#### Risks and mitigations
- Engine format drift: formats are pinned to documented versions with links; schema tests catch our own regressions.
- Packed atlas nondeterminism: maxrects is deterministic for identical input order; cells are sorted by key before packing.

---

### Phase 8: Caching, selective regeneration, batch generation and parallelism

#### Objective
Make large-scale and iterative use efficient and robust: fine-grained caching down to individual rendered samples, dependency-aware selective regeneration, batch runs with partial-failure reporting, worker parallelism, cancellation, recovery and cleanup.

#### Scope
Included: per-sample render cache and per-cell pixel cache, stage input hashing that includes imported files, `--frames` and `--clips` filters that reuse cached samples for untouched frames, batch manifests and reports, worker pool for pixel and sheet stages, concurrent render batches across assets with a shared browser, cancellation, resumable batches, temp file handling, cache maintenance, comparison command.
Excluded: distributed execution.

#### Technical approach
- Render stage cache granularity becomes the sample: key `sha256(modelHash, cameraHash, lightingHash, renderSettingsHash, clip, time, yaw, harnessVersion, backendId, backendVersion)`. A rerun after a clip edit renders only samples whose key changed. Pixel stage keys per cell include the frame hash and pass config.
- Imported files (GLBs, palettes, components) are hashed by content and included in the resolved asset hash; a file watcher is not needed because hashing is cheap at this scale.
- Batch: `td2d batch` accepts a glob filter or a batch manifest JSON (`{ assets: [{ id, overrides? }], options }`), runs assets with a concurrency limit, shares one browser instance across assets (serialised render batches, parallel pixel work in piscina workers), writes `build/batch-report.json`, exits 0 when all ok, 6 when some failed with `--continue-on-error`, 4 otherwise. Each asset's failure is isolated with its error envelope in the report.
- Resumability: the batch report records per-asset status; `--resume <report>` skips `ok` assets.
- Cancellation: SIGINT and SIGTERM trigger an `AbortController`; stages check the signal between items; the browser is closed; workers are drained with `pool.close({ force: false })` then `destroy()` after a grace period; partial outputs stay in a `build/<id>/.partial/` directory and are discarded on the next run.
- Temp files live under `.td2d/tmp/<run id>/` and are removed on success or on the next start; `td2d cache clean` prunes by age and size with an LRU index file.
- `td2d compare` renders a diff image and stats (changed pixels, per-cell changes) between the current build and a history entry or arbitrary directory, using pixelmatch.
- Memory: frames stream from the backend to disk; the pixel stage processes one cell at a time per worker; peak memory target under 500 MB for a 512-sample asset at 4x supersample.

#### Dependencies
Phase 7.

#### Implementation tasks
- [x] Refactor `render` and `pixel` stages to per-item caches; stage runner supports item-level keys and partial restores.
- [x] Resolved asset hashing includes content hashes of referenced files; test that touching an unrelated file does not invalidate.
- [x] `plan` filters: `--frames clip/dir/0-3`, `--clips`, `--directions`; unfiltered cells are restored from cache; if a required cell is missing from cache and filtered out, the command fails with `E_PARTIAL_PLAN` and a hint to drop the filter.
- [x] Batch runner with concurrency, shared backend, isolation, report, `--continue-on-error`, `--resume`, `--fail-fast`.
- [x] piscina worker pool for pixel passes and sheet compositing, with `AbortSignal` propagation and progress messages.
- [x] Cancellation wiring and tests; partial output isolation.
- [x] Temp directory management and `cache stats|clean`.
- [x] `td2d compare` with diff image output and JSON stats.
- [x] Performance benchmark script (`pnpm bench`) generating 20 assets x 8 directions x 3 clips x 6 frames and recording wall time, peak RSS and cache hit ratios into `docs/roadmaps/phase-8.md`.
- [x] Docs: `docs/guide/caching-and-batch.md`, `docs/reference/batch-report.md`.
- [x] Added during the phase: render cache keys from posed geometry (so unchanged frames of an edited clip are reused), item metadata sidecars to skip PNG decoding, browser crash recovery with `W_BACKEND_RESTARTED`, `td2d cache stats`, item counts in `generate` results, a non-gating CI benchmark job, and fixes for two concurrency races the cancellation test exposed.

#### Acceptance criteria
- Editing one clip key in the knight example reruns only the affected samples (test asserts render item cache hits equal total minus affected count).
- `td2d batch --filter 'props/*' --continue-on-error` with one deliberately broken asset exits 6, reports the failure with its error code, and leaves the other outputs intact.
- SIGINT during a batch exits 130 within 3 seconds, leaves no browser or worker processes, and the next run completes without manual cleanup.
- Benchmark: 2880 samples complete in under 4 minutes on the development machine with peak RSS under 1 GB; numbers recorded.
- `cache clean --older-than 1d` removes only entries older than a day (test with faked mtimes).

#### Testing
- Unit: cache keys, LRU index, plan filters, batch report shape, compare stats.
- Integration: selective regeneration scenarios (material change, clip change, camera change, palette change) asserting which stages and items rerun.
- E2E: batch with failures, resume, cancellation (spawn, send SIGINT, assert exit code and process tree).
- Performance: benchmark as a non-gating CI job with trend output.

#### Deliverables
Item-level caches, batch system, worker pool, cancellation, temp management, compare command, benchmark, guides.

#### Risks and mitigations
- Shared browser crash mid-batch: backend restarts once per asset on crash (`E_BACKEND_CRASHED` recorded as a warning when the retry succeeds).
- Cache growth: size-based pruning with a default 5 GB cap configurable per project.

---

### Phase 9: Web viewer

#### Objective
Deliver the full human inspection experience listed in section 10 on top of the file tree and the small Hono server, with live reload and comparison tools.

#### Scope
Included: library, sprite view, sheet view, animation playback with direction selector, metadata, validation, history, compare, optional 3D preview, static mode, keyboard shortcuts, SSE live reload, viewer tests.
Excluded: editing of any kind, authentication, remote hosting features.

#### Technical approach
- Server: Hono routes as in section 10.1; `fs.watch({ recursive: true })` with chokidar 5 fallback when events are unreliable (Q11); index built by scanning for `manifest.json` under `build/` and cached in memory with invalidation on change.
- Client: Vite 8, React 19, plain CSS modules, a small state store (React context or zustand if needed), canvas rendering with `imageSmoothingEnabled = false`, integer zoom with wheel and keyboard, pan with drag, `requestAnimationFrame` playback with an accumulator for fps.
- Compare view: `react-compare-slider` for swipe, custom canvas for blink and heat map using pixelmatch in the browser (it is ESM and browser-safe).
- 3D preview: lazy-loaded route importing `@td2d/render-harness` scene builder and three `OrbitControls` to show `model.glb` with the same material mapping used for rendering.
- Static mode: SPA loads `index.json` when `/api/index` is absent.

#### Dependencies
Phases 7 and 8 (history and compare data).

#### Implementation tasks
- [x] Server endpoints and SSE, index builder, static mode support, `td2d viewer --port --open --no-watch`, `td2d index`.
- [x] Client routing: `/` library, `/asset/:id` with tabs sheet, animation, metadata, validation, history, compare, model.
- [x] Library grid with thumbnails (first cell of first clip), search, filter by status, sort.
- [x] Sprite and sheet canvas component: zoom 1x to 32x, pan, backgrounds (checker sizes, custom colour), pixel grid at zoom above 8x, cell overlay with tag colours, hover readout (x, y, hex, palette index), click to select cell.
- [x] Animation player: clip and direction selectors, play, pause, step, scrub, fps override, loop modes, onion skin, 8-direction simultaneous grid mode.
- [x] Metadata panel from manifest and generation record; palette swatches with usage counts computed client-side.
- [x] Validation panel with frame highlighting.
- [x] History list and compare view (side by side, swipe, blink, heat map, stats).
- [x] 3D model preview tab.
- [x] Keyboard shortcuts and a help overlay.
- [x] Vitest browser tests for canvas components; Playwright e2e for the viewer against the example build (navigation, playback advances frames, compare shows changed pixel count, live reload after a regeneration).
- [x] Docs: `docs/guide/viewer.md` with screenshots generated by the Playwright tests.
- [x] Added during the phase: `--watch-mode poll` and `td2d index --out` and `--no-history`, per-asset change events mapped through the build marker, reconnect reloads, history entries identical to the current build marked, compare counts cross-checked against `td2d compare`, `E_USAGE` for a busy port, a generated browser test fixture with known pixels, and the Q11 Docker experiment (`scripts/q11`).

#### Acceptance criteria
- Every feature in section 10.2 is present and covered by at least one automated test.
- Regenerating an asset while the viewer is open updates the library within 1 second.
- Playback at 10 fps advances exactly 10 frames per second within 5 percent over 5 seconds (test with fake timers).
- Static mode serves the same SPA from a plain file server with `index.json`.
- Viewer bundle under 600 KB gzipped excluding the lazy 3D route.

#### Testing
- Unit: index builder, SSE debounce, fps accumulator, zoom and pan maths.
- Browser: component tests.
- E2E: Playwright flows.

#### Deliverables
Complete viewer app, server, static mode, tests, guide with screenshots.

#### Risks and mitigations
- `fs.watch` recursive gaps on some Linux setups: chokidar fallback behind a server option.
- Large sheets slow canvas: draw only the visible region at high zoom; test with a 4096 px sheet.

---

### Phase 10: Claude Code operator experience, documentation and workflow tests

#### Objective
Make the tool discoverable and reliable for an AI agent: complete docs, machine-readable introspection, consistent errors, examples with expected outputs, and an automated agent-workflow test.

#### Scope
Included: `AGENTS.md` final, `describe` completeness, error catalogue, `--help` examples, docs site structure, CLI reference generation, troubleshooting, example gallery, agent workflow test, acceptance blocks per asset, `td2d explain <code>`.
Excluded: MCP server (optional future).

#### Technical approach
- CLI reference generated from commander metadata plus zod option schemas into `docs/reference/cli.md` by a script; a test fails when stale.
- Error catalogue generated from the `ErrorCode` enum with `message`, `hint` template and docs anchor; `td2d explain E_PART_NOT_MANIFOLD` prints the catalogue entry.
- `describe --json` includes for every registry entry: id, version, option JSON Schema, one minimal example, and the docs anchor.
- Agent workflow test (section 11.5) implemented as an e2e test driven by a script that only uses the documented surface: `AGENTS.md`, `--help`, `schema`, `describe`, envelopes, files.
- Documentation structure under `docs/guide/` and `docs/reference/` per section 16; each guide page includes a runnable example from `examples/` and its rendered preview image produced by the test suite, so images never drift from behaviour.

#### Dependencies
Phases 7, 8 and 9 (so docs cover the complete surface).

#### Implementation tasks
- [x] Finalise `AGENTS.md` (install, doctor, create, generate, inspect, preview, iterate, batch, where schemas and errors live, exit codes table, do and do not list).
- [x] CLI reference generator and staleness test.
- [x] Error catalogue generator, `td2d explain`, staleness test.
- [x] `describe` completeness test: every registry entry has schema, example and docs anchor; every example validates and builds.
- [x] Guides: setup, installation, CLI, configuration and schemas, models, materials and palettes, rigging and animation, camera and lighting, rendering and backends, pixel art, sprite sheets, export formats, metadata, validation, troubleshooting, viewer, extending (new part type, pass, exporter, backend), CI and release.
- [x] Example gallery page listing each example with its sheet image and command to regenerate.
- [x] Agent workflow e2e test as specified in section 11.5.
- [x] Review pass: run a fresh Claude Code session against `AGENTS.md` only (manual, documented in `docs/roadmaps/phase-10.md`) and record friction points as issues.
- [x] Added during the phase: `history show|prune`, `td2d completion`, `td2d explain`, `td2d describe <section>`, a generated schema reference and example gallery, a checked image pipeline for every guide, key and id suggestions in errors, `TD2D_JSON=1`, scale reporting in results and `compare`, and a second review session after the fixes.

#### Acceptance criteria
- Agent workflow test passes on CI.
- Every command has at least one example in `--help`; every error code has a catalogue entry and a hint.
- Docs build has no broken internal links (link checker in CI) and no stale generated pages.
- A fresh operator following `AGENTS.md` can produce a validated sprite sheet in under ten commands (documented transcript).

#### Testing
- Staleness tests for generated docs; link checker; agent workflow e2e; example regeneration test asserting committed expected manifests match (ignoring timestamps and durations).

#### Deliverables
Complete documentation set, generated references, error catalogue, `explain`, agent workflow test, example gallery.

#### Risks and mitigations
- Docs drift: generation plus tests; examples are regenerated in CI.

---

### Phase 11: Hardening, secondary backend, security, performance and release

#### Objective
Reach production readiness: sandboxed script execution, resource limits, robust failure handling, the optional headless-gl backend, performance tuning, packaging, release automation and a 1.0 checklist.

#### Scope
Included: sandboxed `asset emit` execution, path and input hardening, resource limits, malformed file handling, headless-gl backend behind the interface, backend parity tests, profiling and optimisation, npm packaging with the harness and viewer bundled, `npx td2d` smoke, changesets release flow, version policy, 1.0 readiness review.
Excluded: new features.

#### Technical approach
- `asset emit` runs the user script in a child process with `node --permission --allow-fs-read=<project>/** --allow-fs-read=<node_modules>/** --allow-fs-write=<out file> --max-old-space-size=512` and a 30 s timeout (Q12); output must be a JSON definition on stdout; nothing else from the script is trusted.
- Input hardening: all paths through `resolveInside`; GLB imports size-limited (default 50 MB) and validated before parsing; JSON parse depth and size limits; palette and preset names restricted to the id regex; zip-slip style checks for any future archive import.
- Resource limits: per-asset `--timeout`, per-stage memory sampling with `W_MEMORY_HIGH`, browser restart on OOM.
- headless-gl backend: `render/headless-gl/backend.ts` using the harness Node entry with `gl@9` as an optional peer dependency; identical `RenderJob` handling; parity test against Playwright within 0.5 percent mismatch (Q13); `td2d doctor` reports availability; Linux docs for xvfb.
- Packaging: `@td2d/cli` published with `dist/`, the harness HTML and the viewer build as package assets; `postinstall` does not download browsers (doctor `--fix` does, keeping installs side-effect free); `files` whitelist; `npx td2d doctor` smoke in CI from a packed tarball.
- Release: changesets, trusted publishing with provenance, release notes, semantic versioning with manifest `schemaVersion` policy.

#### Dependencies
Phase 10.

#### Implementation tasks
- [x] Sandboxed `asset emit` with permission flags, timeout, output validation, tests for file write attempts outside the allowed path and for infinite loops.
- [x] Input hardening tasks above with negative tests (traversal, symlink escape, oversized GLB, malformed GLB, deeply nested JSON).
- [x] Resource limit implementation and tests.
- [x] headless-gl backend, parity tests, docs.
- [x] Profiling pass on the Phase 8 benchmark: target 25 percent improvement or documented reasons; optimise PNG encode settings (compression level 6 for intermediates, 9 for final), batch sizes, worker counts. (The cold run is 34 percent faster measured the same way as Phase 8, and 10.7 s with the corrected bench sampler.)
- [x] Packaging: `files`, `bin`, bundled assets, pack-and-install smoke test in CI on all three OS runners. (Run here on macOS and Linux; the Windows job has not run yet.)
- [x] Release workflow with changesets and OIDC; `CHANGELOG.md`; version policy doc. (Dry run passed; not run on GitHub.)
- [x] 1.0 readiness review against section 21; open defects triaged; `docs/roadmaps/phase-11.md`.
- [x] Added during the phase: overlapped browser rendering and frame writing, copy-on-write file copies, build directories kept when they match the generation record, an asynchronous bench sampler and `BENCH_OUT`, a cores-based batch concurrency default, `npm install -g` and `asset emit` in the pack smoke test, the SDK import fallback for global installs, `pnpm run release:check`, a README and LICENSE in every package, a `DISPLAY` check before headless-gl touches its native module, a fix for a key-press race in the viewer browser tests that emulation exposed, and `gl` as an optional workspace dependency so a machine without a C++ toolchain can still install and test.

#### Acceptance criteria
- A user script that attempts to write outside the allowed path fails with `E_SCRIPT_PERMISSION` and no file is written.
- Malformed GLB and traversal fixtures all produce typed errors, never crashes or writes.
- headless-gl backend passes parity tests on macOS and Linux CI (with xvfb) or is documented as unsupported on a platform with a doctor message.
- `npm pack` plus `npm install -g` of the tarball yields a working `td2d doctor` and `td2d generate` on macOS, Linux and Windows runners.
- Release workflow publishes a prerelease to npm with provenance from CI.

#### Testing
- Security negative tests; parity tests; packaging smoke on three OS runners; release dry run.

#### Deliverables
Hardened CLI, optional headless-gl backend, packaged release, release automation, 1.0 readiness record.

#### Risks and mitigations
- Windows path and native module issues surface late: Windows runner added for packaging smoke; headless-gl marked optional.
- Permission model caveats (symlinks, worker threads): subprocess only, documented limits.

---

## 14. Testing and quality strategy

Testing is built into every phase. The suite is organised as Vitest projects plus Playwright e2e, all runnable with `pnpm test` locally and in CI.

### 14.1 Test layers

| Layer | Tooling | What it covers | Determinism rule |
|---|---|---|---|
| Unit | Vitest (node) | Schema parsing, presets, path safety, geometry builders, CSG volumes, rig and clip maths, camera maths, every pixel pass, palette mapping, layout, exporters, cache keys, envelopes, exit codes | Exact assertions |
| Integration | Vitest (node) | Stage-to-stage flows: definition to GLB, GLB to frames, frames to sheet, sheet to exports, viewer index building | Exact for pure stages; tolerance only where a render is involved |
| Rendering | Vitest (node) driving the real backend | Headless rendering, transparency, dimensions, camera and lighting invariants, animation sampling, repeatability, cancellation, backend parity | Byte-identical within a backend on one machine; pixelmatch tolerance across OS and backends |
| Harness browser | Vitest browser mode (Playwright chromium with SwiftShader flags) | Scene builder behaviour in a real browser | Tolerance |
| Viewer | Vitest browser mode and Playwright e2e | Components and full flows | n/a |
| CLI e2e | Vitest (node) spawning the built binary with `tinyexec` in temp dirs, `NO_COLOR=1`, non-TTY | Every command's envelope, exit code, files written, cache behaviour, batch, cancellation | Exact |
| Agent workflow | CLI e2e | Section 11.5 scripted operator | Exact |
| Visual regression | pixelmatch (and odiff for bulk) against committed goldens | Example sprites and sheets | Tolerance for raw renders; exact for post-quantisation sprites on the reference backend |
| Benchmarks | Vitest bench, non-gating CI job | Phase 8 scale test | Trend only |

### 14.2 Image and pixel validation (automated)

Implemented as validation rules in core and reused by tests: dimensions, binary alpha, blank frames, alpha coverage band, bounds within frame, ground row, bounds drift across a clip, centroid jitter, palette compliance, orphan count, sheet dimensions and splitting, cell rectangles within bounds, pixel scale (every sprite cell equals the configured frame size), export JSON validity. Checks that require judgement (silhouette readability, shading appeal, outline taste) are explicitly out of automated scope and are supported by `preview` and the viewer.

### 14.3 Visual regression policy

- Goldens are generated on the reference backend (`playwright-swiftshader`) on macOS and committed under `packages/core/test/fixtures/golden/`.
- Raw render comparisons use pixelmatch `threshold: 0.1`, `includeAA: false`, with `maxDiffPixelRatio` 0.005 across OS. Measured ratios are logged so drift is visible before it fails.
- Post-quantisation sprite comparisons on the same backend use `threshold: 0` and `maxDiffPixels: 0`; across backends they use the raw-render tolerance.
- Golden updates require an explicit `pnpm test:update-goldens` and a changeset note; the diff images are attached to the PR by CI.
- Any test that depends on time, randomness or hardware is forbidden by lint rules in the harness and by the determinism settings in jobs.

### 14.4 CI

- `ubuntu-24.04` (pinned): install, lint, typecheck, build, schema staleness, unit, integration, rendering (Playwright headless shell with SwiftShader, no xvfb), harness browser, viewer, CLI e2e, agent workflow, docs link check, pack smoke.
- `macos-15`: build, rendering determinism, CLI e2e, pack smoke.
- `windows-2025` (from Phase 11): build, CLI e2e, pack smoke.
- Optional job with `xvfb-run` and Mesa for the headless-gl backend parity tests.
- Benchmarks run nightly, not on PRs.
- No job depends on a GPU. If a renderer string other than SwiftShader is detected in CI, the rendering tests fail with a clear message.

---

## 15. Performance and reliability strategy

| Concern | Approach |
|---|---|
| Large batches | One shared browser per batch, render batches of 16 samples per evaluate, piscina workers for pixel and sheet work, concurrency default cores minus one |
| Memory | Frames stream to disk as produced; pixel stage works per cell; browser restarted after `N` assets (default 50) to bound leaks; peak RSS reported in generation records |
| Failed renders | Typed `E_BACKEND_*` errors; one automatic retry after backend restart; failure isolated per asset in batches |
| Temp files | `.td2d/tmp/<run>/`, removed on success and on next start; partial outputs under `.partial/` never overwrite previous good outputs |
| Caching | Content-addressed stage and item caches; LRU pruning; `--dry-run` shows planned work |
| Avoiding regeneration | Fine-grained hashes per stage and per sample; filters for frames, clips, directions |
| Parallel jobs | Bounded concurrency; deterministic output ordering regardless of completion order |
| Cancellation | `AbortSignal` through every stage; SIGINT and SIGTERM handled; exit 130; processes cleaned |
| Progress | NDJSON events on stderr with totals, per-item completion, stage durations, cache hits; TTY renderer for humans |
| Recovery | Batch `--resume`; item caches mean an interrupted asset resumes where it stopped |
| Determinism | Pinned renderer and dependencies; determinism settings enforced; version and backend recorded in every manifest; same-machine byte identity tested |
| Warnings vs failures | `validation.status` of `pass`, `warn`, `fail`; exit 0 with warnings unless `--strict`; batch report distinguishes `ok`, `warn`, `failed`, `skipped` |
| Debuggability | `--log-level debug` logs every cache key and stage input hash; `generation.json` records everything needed to reproduce; `td2d render --keep-browser` (debug flag) opens a headed browser with the harness for inspection |

---

## 16. Documentation strategy

Documentation is written in the phase that delivers the feature and generated where possible.

```
README.md                      # what, why, 60-second quickstart
AGENTS.md                      # operator guide for Claude Code
docs/
  guide/
    getting-started.md         # Phase 0
    installation.md            # Phase 0, updated Phase 11
    cli.md                     # Phase 2, generated reference linked
    configuration.md           # Phase 0 and 2: project, presets, schemas, overrides
    models.md                  # Phase 3
    materials-and-palettes.md  # Phase 3 and 5
    camera-and-lighting.md     # Phase 4
    rendering.md               # Phase 1 and 11: backends, determinism, doctor
    pixel-art.md               # Phase 5
    rigging-and-animation.md   # Phase 6
    sprite-sheets.md           # Phase 7
    export-formats.md          # Phase 7
    validation.md              # Phase 2 and 5
    caching-and-batch.md       # Phase 8
    viewer.md                  # Phase 9
    troubleshooting.md         # Phase 10
    extending.md               # Phase 10: part types, passes, exporters, backends
    ci-and-release.md          # Phase 11
  reference/
    cli.md                     # generated
    errors.md                  # generated
    manifest.md
    schemas.md                 # links to schemas/*.schema.json with descriptions
    batch-report.md
  roadmaps/
    phase-N.md                 # per-phase notes: decisions, measurements, deviations
examples/                      # real projects with committed expected outputs
```

Rules: every guide page has a runnable example and an image produced by the test suite; generated pages have staleness tests; `AGENTS.md` stays under 80 lines and links out; each error code links to a troubleshooting anchor.

---

## 17. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Chrome removes or restricts `--enable-unsafe-swiftshader` | low to medium | high | Pin Playwright; headless-gl secondary backend; doctor detects; backend interface allows a software rasteriser later |
| headless-gl 9 never reaches a stable release with WebGL2 | medium | low (secondary) | Treated as optional; parity tests gate its use |
| Cross-OS render drift exceeds tolerance | medium | medium | Measured in Phase 1; disable nondeterministic features; per-OS goldens for raw renders only; sprites compared post-quantisation |
| TypeScript 7 tooling gaps | medium | low | Fallback to TypeScript 6 is a one-line change |
| Pixel-art quality disappoints without hand retouch | medium | medium | Experiments in Phase 5 choose defaults; outlines, palettes and dither give control; viewer and preview make review fast; scope excludes manual retouch by design |
| LLM authoring of complex characters is tedious in JSON | medium | medium | Components, presets, generators, SDK that emits JSON; measured in the Phase 10 agent review |
| Browser download blocked in some environments | low | medium | `doctor` explains; headless-gl path; `PLAYWRIGHT_BROWSERS_PATH` documented |
| Licence contamination (GPL quantisers) | low | high | In-house palette mapping and PLTE writer; dependency licence check in CI (`license-checker` or Biome-adjacent script) |
| Performance regressions | medium | low | Nightly benchmark with trend |
| Scope creep in the viewer | medium | low | Viewer is read-only by rule; features listed in section 10 are the ceiling for 1.0 |

---

## 18. Future extensibility

The following are explicitly designed for but not built in the initial roadmap.

- **Part types**: `voxel` (inline grid or `.vox` via `vox-reader`, greedy meshed), `text`, `heightmap`, `spline-sweep`. Registered through `PartBuilder`.
- **Render backends**: headless-gl (Phase 11), Dawn WebGPU (`webgpu` npm with three `WebGPURenderer`), a pure TypeScript software rasteriser for bit-exact cross-platform output, perspective projection. Registered through `RenderBackend`.
- **Pixel passes**: normal-map and depth-edge outlines rendered as extra passes from the harness (requires multi-target support), selective anti-aliasing, cluster cleanup. Registered through `PixelPass`.
- **Animation**: IK via `CCDIKSolver`, Mixamo retargeting via VRM name maps, blend of clips, per-direction clip overrides.
- **Materials**: small UV textures, gradient maps per material, emissive glow pass.
- **Exporters**: Unity, Spine, Unreal Paper2D, TexturePacker XML, GIF and APNG previews. Registered through `Exporter`.
- **Sheet layouts**: directional ring layouts, per-frame files with naming templates.
- **Integrations**: optional MCP server wrapping the CLI envelope; editor extension that embeds the viewer; a `watch` command that regenerates on definition changes.
- **Model sources**: Blender headless import of `.blend` into GLB as an `import` provider.

Extension rule: a new registry entry must ship with a schema, an example, a docs page and tests, and must not change core interfaces.

---

## 19. Security and operational safeguards

- **Input validation**: every document validated against its schema before use; ids and names restricted to a safe regex; numeric bounds on sizes, counts and durations.
- **Path safety**: all paths resolved inside the project root with realpath checks; outputs confined to `build/`, `history/` and `.td2d/`; `--out` paths must be explicit and are created only if absent or already a td2d output directory (marker file `.td2d-output`).
- **Executable definitions**: the declarative JSON path executes nothing. The optional TypeScript SDK path runs scripts only through `td2d asset emit` in a restricted child process (Phase 11) with a timeout, memory cap and read-only project access; its output is validated like any other definition.
- **Imported content**: GLB imports size-limited, validated with gltf-validator before parsing, and rejected on errors; no texture decoding beyond PNG through sharp; no archive extraction.
- **Resource limits**: per-asset timeouts; browser process memory restart policy; worker pool bounds; cache size cap.
- **Temp files**: scoped to the project `.td2d/tmp/`, cleaned deterministically.
- **Dependencies**: exact pins for renderer-affecting packages (three, playwright, gl, sharp, manifold-3d, gltf-transform), lockfile committed, `pnpm audit` and a licence allowlist in CI, trusted publishing with provenance.
- **No network at generation time**: generation never fetches; only `doctor --fix` downloads the browser.
- **Unrelated files**: the tool never deletes outside `build/<id>`, `history/<id>`, `.td2d/`; `cache clean` and `history prune` require explicit flags and print what they will remove in `--dry-run`.

---

## 20. Definition of done

A task is done when:

1. The functionality is implemented behind the documented interface.
2. Unit tests exist for new logic, and integration, rendering, e2e or browser tests exist where the task touches those layers.
3. `pnpm lint`, `pnpm typecheck`, `pnpm build` and `pnpm test` pass locally and on CI for the affected projects.
4. Generated artefacts (JSON Schemas, CLI reference, error catalogue, example expected outputs) are regenerated and committed.
5. The relevant guide or reference page is updated.
6. A changeset describes the user-visible change.
7. No known critical or high defect remains in the task's area.

A phase is done when:

1. Every task in the phase is done.
2. Every acceptance criterion is demonstrated by an automated test or, where the roadmap says so explicitly, by a documented manual check in `docs/roadmaps/phase-N.md`.
3. Measurements the phase asked for are recorded in the phase notes with the environment used.
4. Open questions assigned to the phase are resolved and the decision recorded, or re-assigned with justification.
5. CI is green on all configured runners.
6. The phase notes list any deviation from this roadmap and the reason.

Claude Code determines completion by running `pnpm test` and reading the phase notes checklist; both must pass.

---

## 21. Final project completion criteria

The project is complete for a 1.0 release when all of the following hold:

- [x] Phases 0 to 11 are done per section 20. (CI passes on every configured runner.)
- [ ] `npx td2d init`, `doctor --fix`, `generate`, `batch`, `preview`, `compare`, `viewer` work from a published package on macOS, Linux and Windows. (They work from the packed tarballs, installed with npm locally and with `npm install -g`, and through `npx` with the tarballs as its packages, on macOS, Linux and Windows; not yet published.)
- [x] The complete pipeline runs through the CLI without the viewer, and the viewer presents everything in section 10.2 without the CLI running.
- [x] No MCP server or external 3D application is required.
- [x] All examples regenerate on CI and match their committed expected manifests; sprite goldens match within policy.
- [x] Same-machine regeneration is byte-identical; cross-OS drift of raw renders is within 0.5 percent and documented.
- [x] The agent workflow test passes and a recorded fresh-session operator transcript reaches a validated sheet in under ten commands.
- [x] All error codes have catalogue entries; all commands have examples; all registries are introspectable through `describe`.
- [x] Security negative tests pass; dependency licence allowlist passes.
- [ ] The Phase 8 benchmark meets its targets and is tracked nightly. (It meets them on macOS and Linux; the nightly workflow is written but has not run.)
- [x] Documentation set in section 16 is complete with no stale generated pages or broken links.
- [ ] `CHANGELOG.md` and version `1.0.0` published with provenance. (`CHANGELOG.md` is written; publishing is the owner's step.)

---

## 22. Technical references

### Rendering
- three.js Migration Guide (r163 removed WebGL 1): https://github.com/mrdoob/three.js/wiki/Migration-Guide
- three.js e2e test configuration (SwiftShader and lavapipe flags, pixelmatch thresholds): https://github.com/mrdoob/three.js/blob/dev/test/e2e/puppeteer.js
- Chromium SwiftShader documentation and flags: https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md
- Intent to Remove SwiftShader WebGL fallback (`--enable-unsafe-swiftshader`): https://groups.google.com/a/chromium.org/g/blink-dev/c/yhFguWS_3pM
- Playwright browsers (headless shell vs full Chromium): https://playwright.dev/docs/browsers
- Playwright screenshot `omitBackground`: https://playwright.dev/docs/api/class-page#page-screenshot
- headless-gl repository and WebGL2 pull request: https://github.com/stackgl/headless-gl and https://github.com/stackgl/headless-gl/pull/310
- headless-gl 9.0.0-rc.10 release assets: https://github.com/stackgl/headless-gl/releases/tag/v9.0.0-rc.10
- Dawn node-webgpu: https://github.com/dawn-gpu/node-webgpu
- Babylon.js server-side (NullEngine renders nothing): https://doc.babylonjs.com/setup/support/serverSide
- PlayCanvas running in Node: https://developer.playcanvas.com/user-manual/engine/running-in-node/
- Godot command line and headless semantics: https://docs.godotengine.org/en/stable/tutorials/editor/command_line_tutorial.html
- Mesa llvmpipe: https://docs.mesa3d.org/drivers/llvmpipe.html
- WebGL without a GPU (SwiftShader vs llvmpipe performance): https://microlink.io/blog/webgl-without-a-gpu

### Models, geometry and animation
- glTF Transform: https://gltf-transform.dev/ and Document API https://gltf-transform.dev/modules/core/classes/Document
- Khronos glTF Validator: https://github.com/KhronosGroup/glTF-Validator
- Manifold (CSG kernel) JS API: https://manifoldcad.org/docs/jsapi/ and npm https://www.npmjs.com/package/manifold-3d
- EXT_mesh_manifold: https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_mesh_manifold/README.md
- three-bvh-csg: https://github.com/gkjohnson/three-bvh-csg
- three.js GLTFExporter source (Blob and FileReader usage): https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/jsm/exporters/GLTFExporter.js
- node-three-gltf: https://github.com/Brakebein/node-three-gltf
- three.js AnimationMixer: https://threejs.org/docs/pages/AnimationMixer.html
- three.js SkeletonUtils retargeting: https://threejs.org/docs/pages/module-SkeletonUtils.html
- three.js CCDIKSolver: https://threejs.org/docs/pages/CCDIKSolver.html
- three.js MeshToonMaterial: https://threejs.org/docs/pages/MeshToonMaterial.html
- three.js RenderPixelatedPass: https://threejs.org/docs/pages/RenderPixelatedPass.html
- VRM 1.0 humanoid bones: https://vrm.dev/vrm1/humanoid/
- Nearest-bone skinning pattern: https://discourse.threejs.org/t/solved-skinnedmesh-bind-vertex-to-closest-bone/6611
- LL3M (LLM agents writing 3D code): https://arxiv.org/abs/2508.08228
- ShapeCraft (shape programs as LLM representation): https://arxiv.org/abs/2510.17603
- vox-reader: https://github.com/FlorianFe/vox-reader.js

### Pixel art, sheets and metadata
- sharp install, resize and output docs: https://sharp.pixelplumbing.com/install, https://sharp.pixelplumbing.com/api-resize, https://sharp.pixelplumbing.com/api-output
- sharp premultiplication in pipeline: https://raw.githubusercontent.com/lovell/sharp/main/src/pipeline.cc
- image-q: https://github.com/ibezkrovnyi/image-quantization
- libimagequant licensing: https://pngquant.org/licensing.html
- Texture filtering of alpha cutouts (Hargreaves): https://www.shawnhargreaves.com/blog/texture-filtering-alpha-cutouts.html
- Beware of transparent pixels (Courrèges): https://adriancourreges.com/blog/2017/05/09/beware-of-transparent-pixels
- TexturePacker reduce border artifacts: https://www.codeandweb.com/texturepacker/knowledgebase/reduce-border-artifacts
- Perceptual PICO-8 palette mapping: https://www.30fps.net/pages/perceptual-pico8-pixel-mapping
- Lospec palettes (Endesga 32): https://lospec.com/palette-list/endesga-32
- Aseprite JSON exporter source: https://raw.githubusercontent.com/aseprite/aseprite/main/src/app/doc_exporter.cpp
- Aseprite CLI: https://www.aseprite.org/docs/cli/
- Phaser loader (aseprite and atlas): https://docs.phaser.io/api-documentation/class/loader-loaderplugin
- PixiJS Spritesheet: https://pixijs.download/release/docs/assets.Spritesheet.html
- Godot SpriteFrames and AtlasTexture: https://docs.godotengine.org/en/stable/classes/class_spriteframes.html
- maxrects-packer: https://github.com/soimy/maxrects-packer
- free-tex-packer-core (exporter templates reference): https://github.com/odrick/free-tex-packer-core
- pixelmatch: https://github.com/mapbox/pixelmatch
- odiff: https://github.com/dmtrKovalenko/odiff
- GodotPixelRenderer (3D to pixel-art reference implementation): https://github.com/bukkbeek/GodotPixelRenderer
- UPixelator (pixel-grid camera snapping): https://github.com/Radivarig/UPixelator_Documentation
- Isometric projection conventions: https://en.wikipedia.org/wiki/Isometric_video_game_graphics
- 8-direction sheet ordering: https://retrostylegames.com/blog/isometric-sprite-sheet/

### CLI, build, testing and viewer
- Command Line Interface Guidelines: https://clig.dev/
- Engineering agent-friendly CLIs (Speakeasy): https://www.speakeasy.com/blog/engineering-agent-friendly-cli
- gh CLI output formatting: https://cli.github.com/manual/gh_help_formatting
- Node.js type stripping: https://nodejs.org/docs/latest-v24.x/api/typescript.html
- Node.js permission model: https://nodejs.org/docs/latest-v24.x/api/permissions.html
- TypeScript 7.0 announcement: https://devblogs.microsoft.com/typescript/?p=5246 and typescript-go status https://github.com/microsoft/typescript-go
- zod JSON Schema: https://zod.dev/json-schema and error formatting https://zod.dev/error-formatting
- tsdown: https://tsdown.dev/ (tsup deprecation notice: https://github.com/egoist/tsup)
- Vite 8: https://vite.dev/blog/announcing-vite8
- Vitest 5: https://vitest.dev/blog/vitest-5 and visual regression https://vitest.dev/guide/browser/visual-regression-testing
- Playwright component testing: https://playwright.dev/docs/test-components
- piscina: https://github.com/piscinajs/piscina
- chokidar 5: https://github.com/paulmillr/chokidar/releases
- GitHub Actions image migrations: https://github.blog/changelog/2026-09-17-ubuntu-26-generally-available-and-latest-migration
- npm trusted publishing with changesets: https://codenote.net/en/posts/npm-trusted-publishing-oidc-staged-hardened-release/
