# td2d documentation

Agents start with [AGENTS.md](../AGENTS.md); people start with [Getting started](guide/getting-started.md).

## Guides

| Guide | Covers |
|---|---|
| [Getting started](guide/getting-started.md) | From an empty directory to a validated sprite sheet |
| [Installation](guide/installation.md) | Node.js, the headless browser, Linux libraries, Docker |
| [Using the CLI](guide/cli.md) | Global options, the JSON envelope, discovery, completion, exit codes |
| [Configuration and schemas](guide/configuration.md) | The project file, setting layers, presets, schemas |
| [Building models](guide/models.md) | Part types, groups, CSG, components, imports, the TypeScript SDK |
| [Materials and palettes](guide/materials-and-palettes.md) | Shading, colours, fixed and automatic palettes |
| [Camera, lighting and composition](guide/camera-and-lighting.md) | Camera presets, directions, scale and framing, lights, shadows |
| [Rendering](guide/rendering.md) | The headless renderer, rendering a GLB, reproducibility |
| [Pixel art processing](guide/pixel-art.md) | Downscaling, palettes, dithering, outlines, cleanup, presets |
| [Rigging and animation](guide/rigging-and-animation.md) | Rigs, attaching parts, skinning, clips, generators |
| [Generating sprites](guide/generating.md) | Stages, options, outputs, validation |
| [Sprite sheets](guide/sprite-sheets.md) | Grid, strip and packed layouts, splitting, trimming |
| [Getting sprites into an engine](guide/export-formats.md) | Aseprite, Phaser, PixiJS, Godot, frames and GIFs |
| [Reading generated metadata](guide/metadata.md) | The manifest, validation report, generation record and batch report |
| [Validation](guide/validation.md) | Every check, acceptance blocks, `--strict` |
| [Caching and batch generation](guide/caching-and-batch.md) | What an edit reruns, frame filters, batches, cancellation, the cache |
| [The web viewer](guide/viewer.md) | Library, sheet, animation, metadata, compare, 3D view, static mode |
| [Troubleshooting](guide/troubleshooting.md) | Every error and warning by topic, with fixes |
| [Extending td2d](guide/extending.md) | New part types, pixel passes, exporters and render backends |
| [CI and release](guide/ci-and-release.md) | Generating sprites in CI, td2d's own CI, releases |
| [Example gallery](guide/examples.md) | Every example project and asset, with previews |

## Reference

| Reference | Contents |
|---|---|
| [CLI](reference/cli.md) | Every command, argument and option (generated) |
| [Errors and warnings](reference/errors.md) | Every code with its exit code, cause and fix (generated) |
| [Schemas](reference/schemas.md) | Every document type and its fields (generated) |
| [Manifest](reference/manifest.md) | `sheets/manifest.json` field by field |
| [Export formats](reference/export-formats.md) | The data each export format writes |
| [Batch report](reference/batch-report.md) | `build/batch-report.json` |

## Project history

[ROADMAP.md](../ROADMAP.md) is the plan; [roadmaps/](roadmaps/) holds the notes of each phase: what was built, decisions, deviations and measurements.

```sh
pnpm generate        # regenerate schemas/, the generated references and the gallery
pnpm docs:images     # regenerate the pictures in docs/guide/images
pnpm docs:check      # check every link and anchor
```
