# Installation

td2d runs on macOS, Linux and Windows with Node.js 24 or newer. It renders in Playwright's headless Chromium with the SwiftShader software rasteriser, so it needs no GPU and gives the same pixels on every machine.

## From this repository

```sh
git clone <this repository> td2d && cd td2d
pnpm install                 # or: npx pnpm@12.8.1 install
pnpm build
alias td2d="node $PWD/packages/cli/dist/main.js"
td2d --version
```

`pnpm build` compiles every package with `tsc -b` and bundles the render harness and the web viewer with Vite. `pnpm td2d <command>` runs the CLI from its TypeScript sources instead, without building.

## The headless browser

```sh
td2d doctor --fix
```

`doctor` checks Node.js, the project, write access, the native modules (sharp and manifold) and the browser, then renders a small probe to confirm WebGL2 works. `--fix` downloads the Chromium headless shell that matches td2d's Playwright version, into Playwright's usual cache. It never removes browsers installed for other projects. Set `PLAYWRIGHT_BROWSERS_PATH` to keep browsers somewhere else.

On Linux the browser needs system libraries as well:

```sh
npx playwright install-deps chromium
```

In the Playwright Docker image (`mcr.microsoft.com/playwright:v1.63.0-noble`) everything is already installed; td2d's own tests run there on arm64 and x86_64 and produce byte-identical renders.

## Optional: the headless-gl backend

td2d can also render without a browser, on a headless-gl WebGL2 context. It is optional and not needed for anything else; see [Backends](rendering.md#backends).

```sh
npm install gl@9.0.0-rc.10
td2d doctor        # reports whether it can run here
```

## Check it works

```sh
td2d init my-sprites && cd my-sprites
td2d generate props/crate
td2d preview props/crate --scale 4
```

`preview` writes `build/props/crate/preview.png`, the crate from four directions with cell borders:

![The starter crate](images/getting-started/crate-preview.png)

If a step fails, `td2d doctor` explains what is missing, and every error carries a hint. [Troubleshooting](troubleshooting.md#environment-and-installation) covers the environment errors, and `td2d explain <code>` prints any error's entry.

## What gets installed where

| Location | Contents |
|---|---|
| `node_modules/` | td2d's packages and dependencies: three.js, Playwright, sharp, manifold, zod, Hono, React |
| Playwright's browser cache | The Chromium headless shell, about 100 MB |
| `<project>/.td2d/cache` | Cached stage outputs and rendered frames, pruned to `cache.maxSize` (5 GB by default) |
| `<project>/build`, `<project>/history` | Generated outputs and earlier generations |

Nothing is written outside the project except the browser download.
