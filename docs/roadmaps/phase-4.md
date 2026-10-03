# Phase 4 notes: camera, lighting and composition

Status: complete locally on 2026-10-02.

## Acceptance criteria

| Criterion | Evidence |
|---|---|
| Changing only the camera preset reruns plan and later stages, not model | unit test "replan without rebuilding geometry when the camera changes" |
| A sphere in eight directions keeps its bounding box within 1 px | render test "keeps a sphere's bounding box within 1 px across all eight directions" |
| Camera-locked lighting gives per-direction colour histograms within 2 percent | render test "shades a sphere the same in every direction" (bleed off, so only visible pixels count) |
| `pixelsPerUnit: "auto"` fits the model and records the value | render test "fits pixelsPerUnit automatically"; unit test proves the chosen value fits and the next does not |
| Ground alignment passes for all examples; a floated model gives `W_COMPOSITION_GROUND` | every example regenerates with status ok and no warnings; render test for the floated sphere |

## Decisions

- **Toon ramp.** three.js samples a toon ramp at `dot(N, L) * 0.5 + 0.5`, so every lit face used only the top half of the ramp, and with three bands the top and side of a box shared a band. The ramp now has a dark left half and spreads the bands over the lit side. A dimetric box shows three bands, as the presets intend.
- **Measured light scale.** Rendering a white surface showed that three.js r186 delivers intensity / pi for ambient and directional light alike. The presets are set from that: studio-toon is 0.45 pi ambient plus 0.55 pi key, so the brightest band is the material colour. The old `flat` preset rendered at 32 percent brightness and now uses pi.
- **Key light** moved to elevation 55 degrees so the top, left and right faces of a dimetric box land in different bands with margin (0.82, 0.57 and 0.10 against thresholds of 1/3 and 2/3).
- **Pixel snapping** holds by construction: the camera always aims at the pivot, and the frustum puts it on a pixel corner, so no per-sample correction is needed until root motion arrives in Phase 6.
- **Mirrored directions** are not rendered. The pixel stage flips the source sprite, the manifest marks the cell, and the cache treats mirroring as part of the plan.
- **Ground shadow** uses a `ShadowMaterial` plane drawn at full opacity in one colour, because sprite alpha is binary. The shadow camera widens when it is on.
- **Content-addressed reuse across assets.** Two assets with identical geometry, camera and lighting share render, pixel and sheet results in the cache. In `examples/cameras` the studio-toon and dimetric cottages render once.
- **Camera-parented lights.** The roadmap suggested parenting camera-space lights to the camera; the harness instead positions them from the camera azimuth, which is equivalent and keeps the light list independent of the camera object.

## Measurements

| Measurement | Value |
|---|---|
| Light reaching a surface | intensity / pi (ambient and directional, measured) |
| Fitted scale for a 1 m box in a 32 x 32 dimetric frame | 18 px/m (19 would leave the frame) |
| Tests | 365 across unit, render, harness and e2e projects |

## Examples

`examples/cameras` renders a cottage component under six camera presets, four lighting presets plus the ground shadow, and three composition cases (auto fit, mirrored, counted), with committed expected outputs. Every lighting change in this phase regenerated the goldens and the expected outputs of all three example projects.

## Linux

The render, pipeline and example suites (45 tests) pass in the Playwright Linux image on arm64 and on x86_64 under emulation. All three example projects regenerate byte for byte against the expected outputs recorded on macOS.
