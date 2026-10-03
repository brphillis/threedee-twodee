# @td2d/render-harness

The three.js scene code td2d renders frames with. `@td2d/core` loads the bundled browser build (`@td2d/render-harness/bundle`) into the headless Chromium shell, or runs the Node build on a headless-gl context, then sends it a GLB and the samples to render.

This is an internal part of [td2d](https://www.npmjs.com/package/@td2d/cli), published so `@td2d/core` can depend on it. Its protocol is versioned (`HARNESS_PROTOCOL_VERSION` in `@td2d/schema`) and may change in any release.

MIT licensed.
