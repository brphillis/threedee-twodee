// The benchmark's characters, shared by scripts/bench.ts and scripts/profile-stages.ts.

/** A different hue for each character, so no two share renders through the cache. */
function hue(i: number, count: number): string {
  const h = (i * 360) / count;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (0.55 - 0.35 * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
/** One of the benchmark's animated characters: three clips, eight directions, its own colour. */
export function character(i: number, count: number) {
  const tint = hue(i, count);
  const height = 0.85 + i * 0.01;
  return {
    schemaVersion: '1.0.0',
    type: 'character',
    frame: { width: 32, height: 48 },
    pixelsPerUnit: 16,
    camera: { preset: 'dimetric', groundMargin: 6 },
    directions: 'd8',
    rig: { preset: 'humanoid-basic', scale: height },
    pixel: { cleanup: { orphans: 'remove', minNeighbours: 1 } },
    materials: {
      cloth: { color: tint, shading: 'toon' },
      skin: { color: '#e8b796', shading: 'toon', bands: 2 },
      boots: { color: '#5d275d', shading: 'toon', bands: 2 },
    },
    model: {
      parts: [
        {
          type: 'box',
          id: 'pelvis',
          bone: 'hips',
          material: 'cloth',
          size: [0.3, 0.15, 0.2],
          position: [0, 0.92 * height, 0],
        },
        {
          type: 'box',
          id: 'torso',
          bone: 'chest',
          material: 'cloth',
          size: [0.36, 0.4, 0.22],
          position: [0, 1.3 * height, 0],
        },
        { type: 'sphere', id: 'head', bone: 'head', material: 'skin', radius: 0.12, position: [0, 1.66 * height, 0] },
        {
          type: 'capsule',
          id: 'arm',
          bone: 'leftUpperArm',
          material: 'cloth',
          radius: 0.05,
          length: 0.2 * height,
          position: [0.2 * height, 1.3 * height, 0],
          mirror: 'x',
        },
        {
          type: 'capsule',
          id: 'forearm',
          bone: 'leftLowerArm',
          material: 'skin',
          radius: 0.045,
          length: 0.18 * height,
          position: [0.2 * height, 1.03 * height, 0],
          mirror: 'x',
        },
        {
          type: 'capsule',
          id: 'thigh',
          bone: 'leftUpperLeg',
          material: 'cloth',
          radius: 0.065,
          length: 0.28 * height,
          position: [0.1 * height, 0.69 * height, 0],
          mirror: 'x',
        },
        {
          type: 'capsule',
          id: 'shin',
          bone: 'leftLowerLeg',
          material: 'boots',
          radius: 0.055,
          length: 0.28 * height,
          position: [0.1 * height, 0.28 * height, 0],
          mirror: 'x',
        },
        {
          type: 'box',
          id: 'boot',
          bone: 'leftFoot',
          material: 'boots',
          size: [0.1, 0.07, 0.2],
          position: [0.1 * height, 0.035, 0.03],
          mirror: 'x',
        },
      ],
    },
    animation: {
      fps: 10,
      clips: {
        idle: { duration: 0.6, generator: { type: 'idle-breathe' } },
        walk: { duration: 0.6, generator: { type: 'walk-cycle', stride: 22, bob: 0.05 } },
        wave: {
          duration: 0.5,
          loop: false,
          keys: [
            { t: 0, pose: {} },
            {
              t: 0.25,
              pose: { rightUpperArm: { rotation: [0, 0, -150] }, rightLowerArm: { rotation: [-20, 0, 0] } },
              easing: 'ease-in-out',
            },
            { t: 0.5, pose: {} },
          ],
        },
      },
    },
  };
}
