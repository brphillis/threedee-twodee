# Props example

Eight props, each showing a different way to build a model: a lathe written by a TypeScript script
(`barrel`), CSG (`crate-notched`), a component repeated along a row (`fence`), a mirrored group
(`lamp`), a wedge (`ramp`), an extrusion (`sword`), an imported GLB (`teapot`) and per-part palette
colours with repeats (`totem`).

```sh
td2d generate                         # every prop
td2d preview props/lamp --layout ring # one frame per direction
td2d asset emit scripts/barrel.ts     # rewrite assets/props/barrel/asset.json from the script
```

`components/fence-post.json` is the component the fence uses; `scripts/make-teapot.ts` made the
imported teapot GLB. `expected/` holds the committed outputs the test suite regenerates and
compares byte for byte. [Building models](../../docs/guide/models.md) explains every part type.
