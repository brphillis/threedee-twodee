import type { LightingSettingsT, ModelInfo, RenderSceneSettings } from '@td2d/schema';
import { lightLevels } from '@td2d/schema/camera';
import {
  AmbientLight,
  type AnimationClip,
  AnimationMixer,
  BasicShadowMap,
  Box3,
  Color,
  DirectionalLight,
  HemisphereLight,
  type Light,
  LoopOnce,
  type Material,
  Mesh,
  MeshNormalMaterial,
  NoToneMapping,
  type Object3D,
  OrthographicCamera,
  PlaneGeometry,
  type Quaternion,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  type Vector3,
  type WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { type CameraRig, cameraRig, lightDirection } from './camera.ts';
import { LinePass } from './lines.ts';
import { materialFromSpec, td2dMaterial } from './materials.ts';

interface RestPose {
  readonly object: Object3D;
  readonly position: Vector3;
  readonly quaternion: Quaternion;
  readonly scale: Vector3;
}

interface LightEntry {
  readonly light: Light;
  readonly azimuth: number;
  readonly elevation: number;
}

/** Everything that makes a render reproducible. Applied once to the renderer. */
export function configureRenderer(renderer: WebGLRenderer): void {
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = BasicShadowMap;
  renderer.shadowMap.autoUpdate = true;
  renderer.setClearColor(0x000000, 0);
}

/**
 * One loaded model plus camera and lights. No DOM access, so the same code runs in the
 * browser harness and, later, in Node on a headless-gl context.
 */
export class HarnessScene {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene = new Scene();
  readonly camera: OrthographicCamera = new OrthographicCamera();
  private root: Object3D | undefined;
  private mixer: AnimationMixer | undefined;
  private clips: AnimationClip[] = [];
  private rest: RestPose[] = [];
  private lights: LightEntry[] = [];
  private lightSpace: LightingSettingsT['space'] = 'camera';
  private settings: RenderSceneSettings | undefined;
  private radius = 1;
  private ground: Mesh | undefined;
  private readonly linePass: LinePass;
  private readonly normalMaterial = new MeshNormalMaterial();

  constructor(renderer: WebGLRenderer) {
    this.renderer = renderer;
    configureRenderer(renderer);
    this.linePass = new LinePass(renderer);
    this.scene.background = null;
  }

  async loadModel(glb: ArrayBuffer): Promise<ModelInfo> {
    const gltf = await new GLTFLoader().parseAsync(glb, '');
    if (this.root) this.scene.remove(this.root);
    const root = gltf.scene;
    let meshes = 0;
    let triangles = 0;
    let skinned = false;
    const materials = new Set<string>();
    root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      meshes++;
      const geometry = object.geometry;
      triangles += (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
      const replace = (m: Material) => {
        const material = td2dMaterial(m as unknown as Parameters<typeof td2dMaterial>[0]);
        materials.add(material.name);
        return material;
      };
      object.material = Array.isArray(object.material) ? object.material.map(replace) : replace(object.material);
      object.castShadow = true;
      object.receiveShadow = true;
      if ((object as { isSkinnedMesh?: boolean }).isSkinnedMesh) {
        skinned = true;
        object.frustumCulled = false;
      }
    });

    this.rest = [];
    root.traverse((object) => {
      this.rest.push({
        object,
        position: object.position.clone(),
        quaternion: object.quaternion.clone(),
        scale: object.scale.clone(),
      });
    });
    this.scene.add(root);
    this.root = root;
    this.clips = gltf.animations;
    this.mixer = new AnimationMixer(root);

    root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(root, true);
    const min: [number, number, number] = box.isEmpty() ? [0, 0, 0] : [box.min.x, box.min.y, box.min.z];
    const max: [number, number, number] = box.isEmpty() ? [0, 0, 0] : [box.max.x, box.max.y, box.max.z];
    let radius = 0;
    for (const x of [min[0], max[0]])
      for (const y of [min[1], max[1]])
        for (const z of [min[2], max[2]]) radius = Math.max(radius, Math.hypot(x, y, z));
    this.radius = radius;
    return {
      bounds: { min, max },
      radius,
      meshes,
      triangles: Math.round(triangles),
      skinned,
      materials: [...materials].sort(),
      clips: this.clips.map((c) => ({ name: c.name, duration: c.duration })),
    };
  }

  /** Replace materials by name. Called by configure() when the job carries materials. */
  private applyMaterials(
    materials: NonNullable<RenderSceneSettings['materials']>,
    lighting: RenderSceneSettings['lighting'],
  ): void {
    const levels = lightLevels(lighting);
    this.root?.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const hasColours = object.geometry.getAttribute('color') !== undefined;
      const swap = (m: Material) => {
        const spec = materials[m.name];
        return spec ? materialFromSpec(m.name, spec, hasColours, levels) : m;
      };
      object.material = Array.isArray(object.material) ? object.material.map(swap) : swap(object.material);
    });
  }

  configure(settings: RenderSceneSettings): void {
    this.settings = settings;
    if (settings.materials) this.applyMaterials(settings.materials, settings.lighting);
    this.renderer.setSize(
      settings.frame.width * settings.supersample,
      settings.frame.height * settings.supersample,
      false,
    );
    for (const { light } of this.lights) {
      this.scene.remove(light);
      if (light instanceof DirectionalLight) this.scene.remove(light.target);
      light.dispose();
    }
    this.lights = [];
    this.lightSpace = settings.lighting.space;
    const { shadows } = settings.lighting;
    for (const def of settings.lighting.lights) {
      const color = new Color(def.type === 'hemisphere' ? def.skyColor : (def.color ?? '#ffffff'));
      if (def.type === 'ambient') {
        this.lights.push({ light: new AmbientLight(color, def.intensity), azimuth: 0, elevation: 0 });
      } else if (def.type === 'hemisphere') {
        this.lights.push({
          light: new HemisphereLight(color, new Color(def.groundColor), def.intensity),
          azimuth: 0,
          elevation: 90,
        });
      } else {
        const light = new DirectionalLight(color, def.intensity);
        light.castShadow = shadows.enabled && (def.castShadow ?? false);
        light.shadow.mapSize.set(shadows.mapSize, shadows.mapSize);
        light.shadow.bias = shadows.bias;
        light.shadow.normalBias = shadows.normalBias;
        this.scene.add(light.target);
        this.lights.push({ light, azimuth: def.azimuth, elevation: def.elevation });
      }
    }
    for (const { light } of this.lights) this.scene.add(light);
    this.renderer.shadowMap.enabled = shadows.enabled;
    if (this.ground) {
      this.scene.remove(this.ground);
      this.ground.geometry.dispose();
      (this.ground.material as Material).dispose();
      this.ground = undefined;
    }
    const groundShadow = settings.lighting.groundShadow;
    if (groundShadow?.enabled && shadows.enabled) {
      // A ground plane that is invisible except where shadow falls on it.
      const size = Math.max(this.radius, 0.5) * 8;
      const ground = new Mesh(
        new PlaneGeometry(size, size).rotateX(-Math.PI / 2),
        new ShadowMaterial({ color: new Color(groundShadow.color), opacity: 1 }),
      );
      ground.position.y = -0.0005;
      ground.receiveShadow = true;
      ground.name = 'td2d-ground-shadow';
      this.scene.add(ground);
      this.ground = ground;
    }
  }

  private restoreRestPose(): void {
    for (const r of this.rest) {
      r.object.position.copy(r.position);
      r.object.quaternion.copy(r.quaternion);
      r.object.scale.copy(r.scale);
    }
  }

  private pose(clipName: string | null, time: number): void {
    const mixer = this.mixer;
    if (!mixer) return;
    mixer.stopAllAction();
    this.restoreRestPose();
    if (clipName === null) return;
    const clip = this.clips.find((c) => c.name === clipName);
    if (!clip)
      throw new Error(
        `Clip "${clipName}" is not in the model. Clips: ${this.clips.map((c) => c.name).join(', ') || 'none'}`,
      );
    // Play once and hold the end, so a time equal to the clip's duration shows its last pose
    // instead of wrapping back to the first. Sample times always lie within the clip.
    const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    mixer.setTime(time);
  }

  private aim(rig: CameraRig): void {
    const { frustum } = rig;
    this.camera.left = frustum.left;
    this.camera.right = frustum.right;
    this.camera.top = frustum.top;
    this.camera.bottom = frustum.bottom;
    this.camera.near = frustum.near;
    this.camera.far = frustum.far;
    this.camera.position.set(...rig.position);
    this.camera.up.set(...rig.up);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);

    const distance = Math.hypot(...rig.position);
    const extent = Math.max(this.radius, 0.5) * (this.ground ? 3 : 1.5);
    for (const entry of this.lights) {
      if (!(entry.light instanceof DirectionalLight)) continue;
      const dir = lightDirection(entry, this.lightSpace, rig.azimuth);
      entry.light.position.set(dir[0] * distance, dir[1] * distance, dir[2] * distance);
      entry.light.target.position.set(0, 0, 0);
      entry.light.target.updateMatrixWorld(true);
      const cam = entry.light.shadow.camera;
      cam.left = -extent;
      cam.right = extent;
      cam.top = extent;
      cam.bottom = -extent;
      cam.near = Math.max(0.01, distance - extent * 2);
      cam.far = distance + extent * 2;
      cam.updateProjectionMatrix();
    }
  }

  /**
   * Render one sample and return RGBA rows bottom-up, exactly as WebGL reads them. With
   * `normals` in the settings, the frame's view-space normals come too, drawn with the same
   * camera: x to the right, y up and z towards the viewer, each mapped from -1..1 to 0..255,
   * opaque wherever there is geometry.
   */
  render(sample: { clip: string | null; time: number; yaw: number }): {
    width: number;
    height: number;
    rgba: Uint8Array;
    normals?: Uint8Array;
  } {
    const settings = this.settings;
    if (!settings) throw new Error('configure() must be called before render().');
    this.pose(sample.clip, sample.time);
    this.root?.updateMatrixWorld(true);
    const rig = cameraRig(settings, sample.yaw, this.radius);
    this.aim(rig);
    if (settings.lines)
      this.linePass.render(
        this.scene,
        this.camera,
        this.root,
        settings.lines,
        rig.renderWidth,
        rig.renderHeight,
        settings.supersample,
      );
    else this.renderer.render(this.scene, this.camera);
    const gl = this.renderer.getContext();
    const rgba = new Uint8Array(rig.renderWidth * rig.renderHeight * 4);
    gl.readPixels(0, 0, rig.renderWidth, rig.renderHeight, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    if (!settings.normals) return { width: rig.renderWidth, height: rig.renderHeight, rgba };
    const normals = new Uint8Array(rig.renderWidth * rig.renderHeight * 4);
    this.renderNormals();
    gl.readPixels(0, 0, rig.renderWidth, rig.renderHeight, gl.RGBA, gl.UNSIGNED_BYTE, normals);
    return { width: rig.renderWidth, height: rig.renderHeight, rgba, normals };
  }

  /** Draw the posed model again with every part's view-space normal as its colour, without the ground shadow. */
  private renderNormals(): void {
    const swapped: [Mesh, Material | Material[]][] = [];
    this.root?.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      swapped.push([object, object.material]);
      object.material = this.normalMaterial;
    });
    const ground = this.ground;
    if (ground) ground.visible = false;
    const shadows = this.renderer.shadowMap.enabled;
    this.renderer.shadowMap.enabled = false;
    this.renderer.setRenderTarget(null);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.shadowMap.enabled = shadows;
    if (ground) ground.visible = true;
    for (const [object, material] of swapped) object.material = material;
  }
}
