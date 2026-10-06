---
"@td2d/schema": minor
"@td2d/core": minor
"@td2d/cli": minor
"@td2d/render-harness": minor
---

`render.normals` writes a normal map for every sprite: the renderer draws each frame's view-space normals as well, the pixel stage brings them to sprite resolution following the sprite's own alpha (outline pixels take the normal beside them, mirrored directions turn x around), and each sheet gets a `<sheet>-normals.png` in the same layout, listed in the manifest's `sheets[].normals` and `files.normals`. Engines that light sprites, such as Phaser with Light2D, Godot through a `CanvasTexture` or PixiJS with a lighting plugin, can then light td2d's sprites. The packed knight in `examples/characters` ships one.
