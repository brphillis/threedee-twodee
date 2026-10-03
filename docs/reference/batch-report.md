# The batch report

`td2d batch` writes `build/batch-report.json` (or `--report <file>`) at the end of every batch, including a failed or cancelled one. Its JSON Schema is `td2d schema batch-report`.

| Field | Meaning |
|---|---|
| `schemaVersion`, `generator` | Format version (1.0.0) and the td2d that wrote it. |
| `startedAt`, `finishedAt`, `durationMs` | When the batch ran. |
| `status` | `ok` or `warn`: every asset succeeded. `partial`: some failed with `--continue-on-error` and the rest ran. `failed`: the batch stopped at a failure. `cancelled`: interrupted. |
| `options` | The `filter`, `manifest`, `concurrency`, `continueOnError`, `failFast` and `resumedFrom` the batch ran with. |
| `totals` | Assets that were `ok`, `warn`, `failed` and `skipped`. |
| `cache` | Stage cache hits and misses over the batch. |
| `items` | Samples rendered, and samples restored from the render cache, over the batch. |
| `assets` | One entry per asset, in batch order. |

Each asset entry:

| Field | Meaning |
|---|---|
| `assetId` | The asset. |
| `status` | `ok`, `warn`, `failed` or `skipped`. |
| `skipped` | Why a skipped asset did not run: `resumed` (it succeeded in the report given to `--resume`), `stopped` (the batch stopped at a failure) or `cancelled`. |
| `durationMs` | Time spent on the asset. |
| `error` | For a failed asset: its error envelope (`code`, `message`, `hint`, `issues`, `details`), as `td2d generate` would print it. |
| `warnings` | Warnings the asset raised. |
| `outputs` | Paths of its build directory, sheet, data, manifest, validation report and generation record. |
| `cache`, `items` | The asset's stage cache hits and misses, and its samples rendered and reused and sprites processed and reused. |

## Exit codes

| Code | When |
|---|---|
| 0 | Every asset succeeded (warnings allowed). |
| 4 | An asset failed and the batch stopped (`E_BATCH_FAILED`). |
| 6 | Some assets failed with `--continue-on-error` (`E_BATCH_PARTIAL`). |
| 130 | Cancelled (`E_CANCELLED`). |

## Resuming

`td2d batch --resume build/batch-report.json` reads the report, skips every asset that was `ok` or `warn`, and runs the rest. The new report records `options.resumedFrom`. Fix the failed assets first; their entries carry the error codes and issue paths to start from.
