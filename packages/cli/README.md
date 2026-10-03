# @td2d/cli

The `td2d` command: turn declarative 3D asset definitions into pixel-art sprites and sprite sheets. It is built to be driven by Claude Code or any other automation: every command takes `--json` and prints exactly one JSON envelope, with typed error codes and fix hints.

Requires Node.js 24 or newer.

```sh
npm install -g @td2d/cli
td2d doctor --fix            # checks the machine and installs the headless browser td2d renders with
td2d init my-sprites
cd my-sprites
td2d generate props/crate    # build, render, pixelate, lay out, validate and export
td2d preview props/crate     # an enlarged PNG of the sheet, for checking by eye
td2d viewer --open           # the web viewer for build/
```

Installing downloads no browser: `td2d doctor --fix` does that, once.

Everything the tool can do is described by the tool itself:

| Command | Prints |
|---|---|
| `td2d --help`, `td2d <command> --help` | Options and examples |
| `td2d describe [section]` | Part types, presets, palettes, passes, exporters, backends and templates, with JSON Schemas and examples |
| `td2d schema [name]` | The JSON Schema of any document td2d reads or writes |
| `td2d explain <code>` | What an error or warning code means and how to fix it |

Outputs land in `build/<asset id>/`: the sprite sheets, a manifest, the validation report and the formats you ask for (Aseprite JSON, PixiJS, Phaser, Godot, GIF previews and single frames).

MIT licensed.
