# Phase 3 notes: model definition language and geometry

Status: complete locally on 2026-10-02. Linux was tested in Docker containers; native GitHub Actions runs are still pending because the repository has no remote.

## Acceptance criteria

| Criterion | Evidence |
|---|---|
| Every part type has a schema example that builds, validates and renders | render test "part type examples" renders all 12 geometric types to validated sprites; component and import are covered by `examples/props` (fence, teapot) |
| A CSG subtraction gives zero validator errors and the expected material split | unit test "subtracts within 1% of the analytic volume and keeps each operand material"; the notched crate example |
| A non-manifold CSG operand gives `E_PART_NOT_MANIFOLD` naming the part, exit 3 | unit test and e2e "rejects a non-manifold CSG operand by id with exit code 3" |
| Component recursion beyond the limit gives `E_COMPONENT_CYCLE` | unit tests for a two-file loop and for nesting deeper than 8; e2e for exit code 3 |
| An imported GLB larger than the frustum gives `W_MODEL_OUT_OF_FRAME` with measured bounds | e2e "warns with measured bounds when an imported model is larger than the frame" |
| `td2d asset emit examples/props/scripts/barrel.ts` matches the committed JSON | e2e compares the printed output byte for byte with the committed file |

## Measurements

| Measurement | Value |
|---|---|
| Cold `td2d generate` of `examples/props` (8 assets, one shared browser) | 1.11 s |
| Warm rerun, all stages cached | 0.31 s |
| Model stage for the CSG crate, including the first manifold-3d WASM load | 14 ms |
| Model stage for the imported teapot (2,336 triangles) | 9 ms |
| CSG subtraction accuracy: box minus a 64-segment cylinder against the analytic volume | under 0.1 percent |
| Tests | 344 across unit, render, harness and e2e projects |

## Decisions

- **Expansion at resolve time.** Components (with parameter checks and arithmetic placeholders), `repeat` and `mirror` become explicit groups during resolution. The model stage builds from that tree, so its cache key covers component files automatically. Imported files are hashed into `model.imports`, so editing an import rebuilds the model.
- **Copies get derived ids.** Component parts get `<instance>-<part>`, repeats get `-0`, `-1` and so on, and mirrors get `-mx`, `-my` and `-mz`. Duplicate ids are reported after expansion with the path where each was written.
- **Per-part colour as material variants, not vertex colours.** The roadmap planned `COLOR_0`. Baking colours into the GLB would make geometry depend on colour and break the Phase 2 rule that recolouring reuses the model. Instead a part with `color` renders with a variant material `<material>~<part id>` that the render stage colours. Vertex colours in imported GLBs are kept, merged with white padding, and honoured by the harness.
- **CSG operands are nested, not referenced.** `csg.parts` holds the operands. The roadmap sketched `a`/`b` references to other parts, which would have made a part both rendered and consumed. Groups and other CSG parts can be operands. Results keep each operand's material and get creased normals (35 degrees), so boxes stay sharp and cylinders stay smooth.
- **Negative scale is allowed**, so mirrors are ordinary groups. Winding is corrected for any transform with a negative determinant.
- **Zero-area triangles are removed** while building. Lathe poles produce them, and validators flag them.
- **Frame fit is checked by projection.** The plan stage projects every vertex in every direction and reports `W_MODEL_OUT_OF_FRAME` with the measured span. This replaces the bounds-versus-frustum heuristic, which cannot see which corner points at the camera.
- **The script sandbox arrived early.** `td2d asset emit` runs scripts under `node --permission --allow-fs-read=*`, so scripts can read but cannot write files or start processes. This was planned for Phase 11. Network access is not restricted by Node 24's permission model; that stays in Phase 11.
- **The props example project** has eight assets with committed expected sheets, Aseprite data, manifests and validation reports. The regeneration test covers every project under `examples/`.

## Deviations from the roadmap

- `vertexColor` as a part field became `color`, implemented as material variants (see above).
- `examples/props` has eight assets instead of five, adding lamp (mirror), ramp (wedge and a part colour) and totem (capsule, torus, cone and palette colours).
- The extrude picture in the models guide uses the sword example, because the schema example blade is edge-on in the default view.

## Linux

| Platform | Result |
|---|---|
| Linux arm64 | 36 of 36 render, pipeline and example tests pass; every sheet in both example projects is byte-identical to the macOS-recorded expected output |
| Linux x86_64 (emulated) | the same 36 of 36, byte-identical, including the CSG crate built through manifold-3d's WASM and the imported teapot |

## Known limits

- Lighting is still untuned, so spheres and lathes show few bands. Phase 4 owns lighting and will regenerate both examples' expected outputs.
- `select` on imports matches glTF node names only.
