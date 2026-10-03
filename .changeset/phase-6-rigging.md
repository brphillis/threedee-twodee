---
"@td2d/schema": minor
"@td2d/core": minor
"@td2d/cli": minor
"@td2d/render-harness": patch
---

Phase 6 rigging and animation: rigs from the `humanoid-basic` (VRM bone names) and `quadruped-basic` presets or your own bones, parts that follow bones (`bone`, inherited by groups and swapped left to right by `"mirror": "x"`), optional `nearest-bone` and `two-bone-blend` skinning, and clips made of pose keys with easing or of the `walk-cycle`, `idle-breathe`, `bob` and `spin` generators, with `linear` or `step` interpolation and explicit `sampleTimes`. A new `rig` stage bakes clips into glTF animations, and the frame is fitted to every rendered pose. New checks `W_CLIP_FOOT_CONTACT`, `W_CLIP_BONE_LIMIT` and `W_CLIP_FRAME_PERIOD`; new commands `td2d rig list|show`, `td2d model inspect --clip --keys`, `td2d render --clips --directions --frames` and `td2d preview --clip`. One-shot clips now hold their last pose at their end.
