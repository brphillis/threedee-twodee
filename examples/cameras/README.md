# Cameras example

One cottage component rendered with every camera preset, every lighting preset, and the framing
options: an automatic scale, counted directions and mirrored directions.

```sh
td2d generate                              # every configuration
td2d preview camera/isometric --layout ring
td2d inspect composition/auto-fit          # the scale "auto" chose
```

`expected/` holds the committed outputs the test suite regenerates and compares byte for byte.
[Camera, lighting and composition](../../docs/guide/camera-and-lighting.md) explains each setting.
