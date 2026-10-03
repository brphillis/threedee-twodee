# Export formats

`export.formats` lists the data written beside the sheet images in `build/<id>/sheets/`. The manifest is always written. The [manifest's](manifest.md) `files` lists what each format wrote.

```json
{ "export": { "formats": ["aseprite-json", "pixi", "phaser-atlas", "godot-spriteframes"], "aseprite": { "variant": "array" } } }
```

The `everything` preset writes every format. Each JSON format has a JSON Schema, printed by `td2d schema <name>` and committed under `schemas/`.

| Format | Files | Schema |
|---|---|---|
| `manifest` | `manifest.json` | `manifest` |
| `aseprite-json` | `<sheet>.json` for each sheet | `aseprite-sheet`, `aseprite-sheet-array` |
| `pixi` | `<sheet>.pixi.json` for each sheet | `pixi-sheet` |
| `phaser-atlas` | `<asset>.phaser.json` | `phaser-atlas` |
| `godot-spriteframes` | `<asset>.tres` | Godot text resource |
| `frames` | `frames/<asset>_<clip>_<direction>_<nnn>.png` | |
| `gif-preview` | `<asset>-<clip>.gif` | |

Sequence names are `<clip>_<direction>`, such as `walk_s`, in every format. Frame names in the engine formats are sprite keys, such as `walk/s/000`.

## aseprite-json

Aseprite's own sprite sheet JSON, in the shape `doc_exporter.cpp` writes: `frames` with `frame`, `trimmed`, `spriteSourceSize`, `sourceSize` and `duration` in milliseconds (from the clip's fps); `meta.frameTags` with one forward tag per clip and direction; and a `pivot` slice holding the pivot. One file per sheet, with tags for the frames on that sheet.

| Option | Default | Meaning |
|---|---|---|
| `aseprite.variant` | `hash` | `hash` keys frames by name; `array` lists them, each with a `filename`. |
| `aseprite.frameNames` | `index` | `index` names frames 0, 1, 2 like Aseprite's `{frame}` item filename. `descriptive` names them `<asset> (<clip>_<direction>) <n>.png`. |

**Phaser** (3 and 4) loads it directly, and needs index frame names:

```js
// preload
this.load.aseprite('knight', 'sheets/knight.png', 'sheets/knight.json');
// create
this.anims.createFromAseprite('knight');
const knight = this.add.sprite(160, 240, 'knight').setOrigin(pivot.normalized.x, pivot.normalized.y);
knight.play({ key: 'walk_s', repeat: -1 });
```

`examples/engines/phaser.html` does this, and a browser test plays `walk_s` from the knight's grid and packed sheets.

## pixi

A PixiJS spritesheet (TexturePacker JSON hash) per sheet, with `animations` (one per clip and direction) and each frame's `anchor` set to the pivot. Sheets of a split atlas list each other in `meta.related_multi_packs`.

```js
const sheet = await PIXI.Assets.load('sheets/knight.pixi.json');
const knight = new PIXI.AnimatedSprite(sheet.animations.walk_s);
knight.animationSpeed = 10 / 60; // the clip's fps over the ticker's 60
knight.play();
```

`examples/engines/pixi.html` does this; the browser test plays `walk_s` from both knight sheets.

## phaser-atlas

One Phaser multi-atlas for every sheet (`textures`, one entry per image, with trimmed frames and the pivot as `anchor`), plus `animations`: configs ready for `this.anims.create`.

```js
// preload
this.load.multiatlas('knight', 'sheets/knight.phaser.json', 'sheets/');
this.load.json('knight-anims', 'sheets/knight.phaser.json');
// create
for (const a of this.cache.json.get('knight-anims').animations) {
  this.anims.create({ key: a.key, frameRate: a.frameRate, repeat: a.repeat, frames: a.frames.map((frame) => ({ key: 'knight', frame })) });
}
```

## godot-spriteframes

A Godot 4 `SpriteFrames` resource in text form (`format=3`, without `load_steps`, as Godot 4.6 and later write it). Each sheet is an `ext_resource` texture at `export.godot.directory` (default `res://`) plus the image name; each frame is an `AtlasTexture` whose `region` is its cell and whose `margin` restores the trimmed frame; each clip and direction is an animation at the clip's fps, looping as the clip does.

1. Copy the sheet PNGs and `<asset>.tres` into the Godot project, in the folder `export.godot.directory` names (for example `"res://sprites/"`).
2. Add an `AnimatedSprite2D`, set its Sprite Frames to the `.tres` file and pick an animation such as `walk_s`.
3. Set `centered` off and `offset` to `(-pivot.x, -pivot.y)` from the manifest, so the node's position is the character's feet.

`scripts/godot/check.sh <sheets directory> <asset name>` downloads Godot 4.7.2 for Linux, imports the sheets and loads the resource with Godot's own loader. For the packed knight it reports all 24 animations with their frame counts, speeds and loop flags, and every trimmed frame restored to 32 x 48. A text golden in the tests guards the format.

## frames

Every sprite as its own untrimmed PNG, mirrored ones included: `frames/<asset>_<clip>_<direction>_<nnn>.png`. Use them for tools that build their own atlases.

## gif-preview

One looping GIF per clip with every direction side by side, at `export.gif.scale` (default 2) on `export.gif.background` (default transparent). GIFs hold at most 256 colours: sprites with more are quantised for the preview only.

## Not supported

Unity, Spine and Unreal formats are not written. Their importers can usually read the Aseprite JSON or the individual frames.
