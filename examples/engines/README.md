# Engine examples

Minimal pages that load td2d output in a game engine and play a clip. They are a manual check
and the subject of a browser test (`packages/cli/e2e/engines.test.ts`).

| Page | Loads | With |
|---|---|---|
| `phaser.html` | `<sheet>.png` and its Aseprite JSON | `this.load.aseprite` and `this.anims.createFromAseprite` |
| `pixi.html` | `<sheet>.pixi.json` | `PIXI.Assets.load` and `AnimatedSprite` |

```sh
td2d generate characters/knight                        # in examples/characters
td2d export characters/knight --format aseprite-json,pixi,phaser-atlas
node examples/engines/serve.ts examples/characters/build/characters/knight/sheets 8080
# open http://127.0.0.1:8080/phaser.html?clip=walk_s and http://127.0.0.1:8080/pixi.html?clip=walk_s
```

`serve.ts` serves these pages, the Phaser and PixiJS browser builds from `node_modules`, and the
sheets folder under `/sheets/`. Each page sets the sprite's origin or anchor from the manifest
pivot, so the character stands on the same point in every direction. `docs/reference/export-formats.md`
explains each format.
