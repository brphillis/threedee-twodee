# Phase 0 notes: repository foundation, schema package and CLI skeleton

Status: complete locally on 2026-10-02. CI is configured but has not run, because the repository has no remote yet.

Environment: macOS 26.7.1 on Apple Silicon, Node.js 24.3.0, pnpm 12.8.1 (run through `npx`), TypeScript 7.0.2.

## Acceptance criteria

| Criterion | Evidence |
|---|---|
| install, build, test, lint and typecheck succeed | `pnpm build && pnpm test && pnpm lint` pass locally: 170 tests in 16 files. Linux CI not yet run. |
| `init` then `validate --stage config --json` exits 0 with `ok: true` | e2e test "creates a project and validates it" |
| A string `frame.width` exits 3 with `issues[0].path === "frame.width"` and a hint | e2e test "reports a wrongly typed field with its path, a hint and exit code 3" |
| `td2d schema asset` validates the starter asset with an independent validator | e2e test using ajv 2020 against the printed schema |
| `doctor --json` reports every check; a missing browser gives exit 7 and a hint naming the fix | e2e test with an empty `PLAYWRIGHT_BROWSERS_PATH` |
| Non-TTY output without `--json` has no ANSI codes | e2e test over `validate`, `describe`, `asset list` and an unknown command |

## Measurements

| Measurement | Value |
|---|---|
| Clean `tsc -b` of all three packages and test projects | 0.36 s |
| `td2d validate --json` on the starter project | 0.08 s |
| `td2d describe --json` | 0.07 s |
| `td2d doctor --json`, including a Chromium launch | 0.37 s |
| Full test suite including e2e | about 4.5 s |

## Decisions

- **Q9 resolved.** TypeScript 7.0.2 `tsc -b` works with project references across pnpm workspace packages, and `rewriteRelativeImportExtensions` turns `.ts` imports into `.js` in both JavaScript and declarations. Workspace packages export their sources under a custom `td2d-source` condition, used by TypeScript (`customConditions`), Vitest and `node --conditions=td2d-source`. The CLI runs from source with Node 24 type stripping.
- **Q10 resolved: no tsdown.** Isolated declarations would need explicit type annotations on every exported zod schema, which defeats inferred types. `tsc -b` already emits JavaScript, declarations and source maps in 0.36 s, so packages build with `tsc` alone. Bundling can be revisited in Phase 11 if install size or startup time needs it.
- **pnpm 12.8.1, not 11.** The roadmap named pnpm 11 after a misread of the local toolchain: pnpm was not installed and the version seen was npm's. pnpm 12.8.1 is current. Corepack 0.33 cannot launch it, so the documented fallback is `npx pnpm@12.8.1`.
- **Plain JSON with closed objects.** Every input object rejects unknown keys, so a typo is an error at its exact path. Union errors are narrowed to the branch that matches the input's shape, so `camera: { "pitchh": 3 }` reports `camera.pitchh` rather than a generic union failure.
- **Layering.** Settings resolve from built-in defaults, built-in type defaults, project `defaults`, project `typeDefaults.<type>`, then the asset. A preset reference expands at the layer that names it; objects merge and arrays replace.
- **Width-aware JSON writer.** Files td2d writes keep short leaf values such as `[0, 0.5, 0]` on one line, so definitions stay short and easy to edit with exact-match tools.
- **Built-in palettes** were downloaded from Lospec on 2026-10-02 rather than typed from memory. `db32` is Lospec's `dawnbringer-32`.
- **Error docs anchors** use the lowercase code (`#e_asset_invalid`) to match GitHub heading anchors. `docs/reference/errors.md` is generated with the JSON Schemas by `pnpm generate`, and tests fail when either is stale.

## Deviations from the roadmap

- Built-in presets, palettes and templates live in `@td2d/core` (`presets/`, `palettes/`, `templates/`), not in `@td2d/schema`, because core loads them from disk and the schema package must stay browser-safe.
- The envelope carries command results under `data` instead of top-level keys such as `results`. The roadmap's section 9.3 example is updated.
- `asset list`, `asset show` and `asset create` were added. The roadmap's command reference listed them but no phase owned them, and they only need the project loader.
- Global flags that do nothing yet (`--no-cache`, `--force`, `--dry-run`, `--concurrency`, `--timeout`) are deferred to the phases that implement them, so no flag is accepted and ignored.
- `examples/starter` is not created yet. The starter template lives at `packages/core/templates/projects/starter`; Phase 2 adds `examples/` with committed expected outputs.
- `doctor` checks Node.js, the project, write access, sharp, manifold-3d and the headless browser. It does not check pnpm, because users of the published CLI do not need it. The browser check launches Chromium with the SwiftShader flags Phase 1 will use.
- `doctor --fix` passes `--no-remove` to the Playwright installer so it never deletes browsers installed for other projects.

## Open items

- CI has not run. The first push should confirm the `ubuntu-24.04` and `macos-15` jobs, including `playwright install --with-deps --only-shell chromium` on Linux.
- `changeset status` needs at least one commit on `main`; the release workflow is a stub until Phase 11.
- Node 24.3.0 is older than the 24.12 release where type stripping became stable. Running from source works, but contributors should prefer a current Node 24.
