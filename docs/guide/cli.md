# Using the CLI

Everything td2d does is a `td2d` command. People read its human output; agents and scripts add `--json`. The [CLI reference](../reference/cli.md) lists every command and option and is generated from the commands themselves.

## A typical session

```sh
td2d init my-sprites && cd my-sprites
td2d validate                          # every definition, no rendering
td2d generate props/crate              # the full pipeline
td2d preview props/crate --layout ring # one frame per direction, placed at its angle
td2d inspect props/crate               # sheet, cells, pivot, validation and stages
```

![The crate with each direction at its angle](images/getting-started/crate-ring.png)

## Global options

| Option | Effect |
|---|---|
| `--json` | stdout carries exactly one JSON envelope; stderr carries NDJSON logs and progress |
| `--project <dir>` | Use this project instead of the nearest `td2d.project.json` above the current directory |
| `--log-level <level>` | `silent`, `error`, `warn`, `info` (default), `debug` or `trace` |
| `--no-color` | Plain text, also with `NO_COLOR` set or when output is not a terminal |

Pipeline commands add their own: `--force` recomputes every stage, `--no-cache` neither reads nor writes the cache, `--dry-run` shows what would run, and `--strict` turns validation warnings into failures.

## The JSON envelope

```json
{ "ok": true, "command": "generate", "version": "0.0.0", "durationMs": 812,
  "data": { "results": [ { "assetId": "props/crate", "status": "ok", "outputs": { "sheet": "build/props/crate/sheets/crate.png" } } ] },
  "warnings": [] }
```

On failure `ok` is false and `error` holds `code`, `message`, `issues` (each with a `file` and a `path` such as `model.parts[1].size`), `hint` and `docs`. The exit code says what kind of failure it was; the [error reference](../reference/errors.md) lists them. `td2d explain E_ASSET_INVALID` prints an error's entry, and `td2d explain --list` lists every code.

Progress on stderr is one JSON object per line:

```text
{"t":"2026-10-02T10:00:01Z","event":"stage:start","assetId":"props/crate","stage":"render","total":4}
{"t":"2026-10-02T10:00:02Z","event":"stage:done","assetId":"props/crate","stage":"render","durationMs":640,"cached":false}
```

Read stdout and stderr separately: stdout is one document, stderr is a stream.

## Discovering what td2d supports

```sh
td2d describe --json        # commands, part types with examples, presets, palettes, passes, exporters, error codes
td2d schema --list          # document types
td2d schema asset           # the JSON Schema for asset.json
td2d <command> --help       # options and examples for one command
```

## Shell completion

```sh
eval "$(td2d completion bash)"                               # in ~/.bashrc
eval "$(td2d completion zsh)"                                # in ~/.zshrc
td2d completion fish > ~/.config/fish/completions/td2d.fish
```

Completion covers commands, options, option values such as `--layout ring`, and the asset ids of the project you are in (from `td2d asset list --ids`).

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success, perhaps with warnings |
| 1 | Internal error: a bug |
| 2 | Usage: unknown command, option, id or name |
| 3 | An input document is invalid |
| 4 | Generation failed |
| 5 | Output failed validation; the outputs were still written |
| 6 | A batch partly failed |
| 7 | The environment needs attention: run `td2d doctor` |
| 130 | Cancelled |
