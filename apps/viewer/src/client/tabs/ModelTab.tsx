// The 3D preview. Loaded only when the tab opens, so three.js stays out of the main bundle.
import { lightDirection, materialFromSpec, td2dMaterial } from '@td2d/render-harness';
import { useEffect, useRef, useState } from 'react';
import {
  AmbientLight,
  AnimationMixer,
  Box3,
  Clock,
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  LoopRepeat,
  type Material,
  Mesh,
  type Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { AssetDetail } from '../data.ts';

interface Loaded {
  readonly meshes: number;
  readonly triangles: number;
  readonly clips: readonly string[];
  readonly materials: readonly string[];
}

/** Orbit view of the asset's model.glb with the materials and lights the renderer uses. */
export default function ModelTab({ detail }: { readonly detail: AssetDetail }) {
  const host = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clip, setClip] = useState<string>('');
  const play = useRef<(name: string) => void>(() => {});
  const url = detail.model;

  useEffect(() => {
    const el = host.current;
    if (!el || !url) return;
    let disposed = false;
    const renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(el.clientWidth, el.clientHeight, false);
    renderer.domElement.setAttribute('aria-label', `${detail.id} 3D model`);
    renderer.domElement.setAttribute('role', 'img');
    el.appendChild(renderer.domElement);
    const scene = new Scene();
    const camera = new PerspectiveCamera(35, el.clientWidth / Math.max(1, el.clientHeight), 0.01, 200);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    const lighting = detail.resolved?.lighting;
    const directional: { light: DirectionalLight; azimuth: number; elevation: number }[] = [];
    for (const def of lighting?.lights ?? [{ type: 'ambient' as const, intensity: 1, color: '#ffffff' }]) {
      if (def.type === 'ambient') scene.add(new AmbientLight(new Color(def.color ?? '#ffffff'), def.intensity));
      else if (def.type === 'hemisphere')
        scene.add(new HemisphereLight(new Color(def.skyColor), new Color(def.groundColor), def.intensity));
      else {
        const light = new DirectionalLight(new Color(def.color ?? '#ffffff'), def.intensity);
        scene.add(light, light.target);
        directional.push({ light, azimuth: def.azimuth, elevation: def.elevation });
      }
    }
    const space = lighting?.space ?? 'camera';
    let mixer: AnimationMixer | null = null;
    const clock = new Clock();
    let frame = 0;
    const tick = () => {
      if (disposed) return;
      frame = requestAnimationFrame(tick);
      mixer?.update(clock.getDelta());
      controls.update();
      // Camera-space lights turn with the view, as they turn with each rendered direction.
      const azimuth = (controls.getAzimuthalAngle() * 180) / Math.PI;
      for (const d of directional) {
        const dir = lightDirection(d, space, azimuth);
        d.light.position.set(dir[0] * 10, dir[1] * 10, dir[2] * 10);
      }
      renderer.render(scene, camera);
    };
    const resize = new ResizeObserver(() => {
      renderer.setSize(el.clientWidth, el.clientHeight, false);
      camera.aspect = el.clientWidth / Math.max(1, el.clientHeight);
      camera.updateProjectionMatrix();
    });
    resize.observe(el);

    fetch(url, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`${url} returned ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buffer) => new GLTFLoader().parseAsync(buffer, ''))
      .then((gltf) => {
        if (disposed) return;
        const root: Object3D = gltf.scene;
        const specs = detail.resolved?.materials ?? {};
        let meshes = 0;
        let triangles = 0;
        const names = new Set<string>();
        root.traverse((object) => {
          if (!(object instanceof Mesh)) return;
          meshes++;
          const g = object.geometry;
          triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
          const colours = g.getAttribute('color') !== undefined;
          const swap = (m: Material) => {
            const spec = specs[m.name];
            const material = spec
              ? materialFromSpec(
                  m.name,
                  { color: spec.color, shading: spec.shading, bands: spec.bands, emissive: spec.emissive },
                  colours,
                )
              : td2dMaterial(m as unknown as Parameters<typeof td2dMaterial>[0]);
            names.add(material.name);
            return material;
          };
          object.material = Array.isArray(object.material) ? object.material.map(swap) : swap(object.material);
          if ((object as { isSkinnedMesh?: boolean }).isSkinnedMesh) object.frustumCulled = false;
        });
        scene.add(root);
        const box = new Box3().setFromObject(root, true);
        const size = box.getSize(new Vector3());
        const centre = box.getCenter(new Vector3());
        const radius = Math.max(size.x, size.y, size.z, 0.1);
        const grid = new GridHelper(Math.ceil(radius * 4), Math.ceil(radius * 4) * 2, 0x666c78, 0x3a3f4a);
        scene.add(grid);
        controls.target.copy(centre);
        camera.position.set(centre.x + radius * 1.6, centre.y + radius * 0.9, centre.z + radius * 2.2);
        camera.near = radius / 100;
        camera.far = radius * 100;
        camera.updateProjectionMatrix();
        mixer = new AnimationMixer(root);
        const clips = gltf.animations;
        play.current = (name: string) => {
          mixer?.stopAllAction();
          const c = clips.find((x) => x.name === name);
          if (c && mixer) mixer.clipAction(c).setLoop(LoopRepeat, Number.POSITIVE_INFINITY).play();
        };
        setInfo({
          meshes,
          triangles: Math.round(triangles),
          clips: clips.map((c) => c.name),
          materials: [...names].sort(),
        });
        tick();
      })
      .catch((e: unknown) => !disposed && setError(e instanceof Error ? e.message : String(e)));

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [url, detail.id, detail.resolved]);

  useEffect(() => {
    play.current(clip);
  }, [clip]);

  if (!url) return <p className="muted pad">This build has no model.glb.</p>;
  return (
    <div className="model-tab" data-model-loaded={info ? 'true' : 'false'} data-meshes={info?.meshes ?? ''}>
      <div className="toolbar" role="toolbar" aria-label="Model">
        <label>
          clip{' '}
          <select
            value={clip}
            onChange={(e) => setClip(e.target.value)}
            aria-label="Model clip"
            disabled={!info?.clips.length}
          >
            <option value="">rest pose</option>
            {info?.clips.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <span className="muted small">
          {info
            ? `${info.meshes} meshes, ${info.triangles} triangles, materials ${info.materials.join(', ')}. Drag to orbit, wheel to zoom.`
            : 'Loading model.'}
        </span>
      </div>
      {error && <p className="error pad">{error}</p>}
      <div ref={host} className="model-host" />
    </div>
  );
}
