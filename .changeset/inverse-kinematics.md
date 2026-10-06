---
"@td2d/schema": minor
"@td2d/core": minor
"@td2d/cli": minor
---

Two-bone inverse kinematics. A bone's pose in a key can give `ik` with a `target` in model space: the two bones above it turn so its joint lands there, bending towards `pole` (by default the side the middle bone's limits allow, so knees go forwards and elbows back), and `keepOrientation` holds the bone flat while the chain bends. Between two keys that target the same bone the target moves and is solved at every frame, so a planted foot never slides; towards a key without a target the solved pose eases into that key's rotations. The `walk-cycle` generator takes `ik: true` to plant the feet: each foot stands still through its stance and lifts in an arc through its swing, the legs are solved to reach it, a given `bob` shortens the step to the legs' reach, and `lift` sets the swing height. The knight in `examples/characters` walks this way.
