# td2d

td2d turns declarative 3D asset definitions into pixel-art sprites and sprite sheets. It is a command-line tool first, designed to be driven by Claude Code or any other automation, with a separate web viewer for people.

> **Status: every phase of the [roadmap](ROADMAP.md) is implemented and tested; the packages are not yet published to npm.** Asset definitions built from 14 part types (shapes, groups, CSG, parameterised components and GLB imports, with repeat and mirror) generate validated pixel-art sprite sheets with Aseprite JSON and a manifest, with stage caching, history and a web viewer. Camera and lighting presets, mirrored and counted directions, automatic framing and ground shadows are in. Pixel processing has fixed and automatic palettes, ordered dithering, outlines, cleanup and indexed PNG output. Characters animate on humanoid or custom rigs, with keyed clips and walk, breathe, bob and spin generators. Sheets can be grids, strips or trimmed packed atlases, exported for Aseprite, PixiJS, Phaser and Godot. Every rendered frame is cached on its own, so an edit rerenders only what changed, and `td2d batch` generates many assets in parallel with a report you can resume. The web viewer shows sheets at exact pixel zoom, plays animations in every direction, compares generations with a swipe or heat map, previews the model in 3D and reloads live; `td2d index` writes it as a static site. Every error has a catalogue entry and `td2d explain`; asset scripts run sandboxed; inputs, time and memory are limited; an optional headless-gl backend renders without a browser.

## Quick start

Requirements: Node.js 24 or newer.

```sh
pnpm install
pnpm build
node packages/cli/dist/main.js init my-sprites
cd my-sprites
node ../packages/cli/dist/main.js doctor --fix   # installs the headless browser used for rendering
node ../packages/cli/dist/main.js validate
```

Once published, the same commands run as `td2d <command>`.

## What works now

| Command | Purpose |
|---|---|
| `td2d init [dir]` | Create a project from a template. Never overwrites files. |
| `td2d doctor [--fix]` | Check Node.js, native modules, the headless browser and the project. |
| `td2d schema [name]` | Print the JSON Schema for any document. |
| `td2d describe` | List commands, part types, presets, palettes, templates and error codes. |
| `td2d validate [ids...]` | Validate definitions, presets and palettes. |
| `td2d asset list / show / create` | Manage asset definitions. |
| `td2d generate [ids...]` | Build, render, pixelate, lay out, validate and export. Unchanged stages are reused. |
| `td2d inspect <id>` / `td2d preview <id>` | Summarise a build, or write an enlarged preview PNG. |
| `td2d model build / inspect <id>` | Build and report the geometry only. |
| `td2d process [ids...]` | Rerun pixel processing and later stages from cached renders. |
| `td2d rig list` / `td2d rig show <id>` | Rig presets, and an asset's bones with their attached parts. |
| `td2d sheet [ids...]` / `td2d export [ids...] --format <list>` | Lay out sheets again, or write export formats, from cached sprites. |
| `td2d asset emit <script.ts>` | Write an asset definition from a TypeScript SDK script. |
| `td2d render <id>` or `--glb <file> --out <dir>` | Render an asset or a GLB to transparent PNG frames. |
| `td2d history list / show / prune` / `td2d compare <id>` | Earlier generations, and a cell-by-cell diff against one. |
| `td2d batch` | Generate many assets with a concurrency limit, `--continue-on-error` and `--resume`. |
| `td2d cache stats` / `td2d cache clean` | Cache size, and pruning by age or size. |
| `td2d viewer [--open] [--no-watch]` / `td2d index` | Read-only web viewer for the build directory, live or as a static site. |
| `td2d explain <code>` / `td2d completion <shell>` | What an error or warning code means, and shell completion for bash, zsh and fish. |

Every command accepts `--json` and then prints exactly one JSON envelope on stdout. See [AGENTS.md](AGENTS.md) for the operator guide, [docs/guide/getting-started.md](docs/guide/getting-started.md) for a walkthrough, and [docs/](docs/README.md) for every guide and reference.

## Repository layout

| Path | Contents |
|---|---|
| `packages/schema` | zod schemas, types, error codes. Source of the JSON Schemas in `schemas/`. |
| `packages/core` | The pipeline: project loading and resolution, model building, rigs, rendering, pixel processing, sheets, validation, export, caching and batches. |
| `packages/render-harness` | The three.js scene code that runs inside the headless browser. |
| `apps/viewer` | The web viewer: a small Hono server and a React page. |
| `examples/` | Example projects with committed expected outputs (see the [gallery](docs/guide/examples.md)), and engine pages under `examples/engines`. |
| `packages/cli` | The `td2d` command. |
| `schemas/` | Generated JSON Schemas, committed. |
| `docs/` | Guides, references and per-phase notes ([index](docs/README.md)). |
| `scripts/` | Benchmarks, documentation images, the gallery and link checker, and the Q11 watch experiment. |
| `test/` | Repository-wide checks: links, guides, snippets and AGENTS.md. |

## Development

```sh
pnpm build        # tsc -b for every package
pnpm test         # build, then every test project
pnpm test:unit    # unit tests only, against TypeScript sources
pnpm test:render  # rendering and in-browser harness tests
pnpm test:update-goldens   # rewrite golden render images after an intended change
pnpm lint         # Biome
pnpm generate     # regenerate schemas/, docs/reference/ and the example gallery
pnpm docs:images  # regenerate the guide images (checked by the render tests)
pnpm docs:check   # check every Markdown link and anchor
pnpm td2d --help  # run the CLI from source
```

pnpm is pinned in `package.json`. Without a global pnpm, `npx pnpm@12.8.1 <command>` works.

## License

MIT
