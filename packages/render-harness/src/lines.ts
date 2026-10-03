import type { RenderLinesSettings } from '@td2d/schema';
import {
  Color,
  DepthTexture,
  FloatType,
  GLSL3,
  HalfFloatType,
  type Material,
  Mesh,
  NearestFilter,
  type Object3D,
  OrthographicCamera,
  PlaneGeometry,
  Scene as QuadScene,
  type Scene,
  ShaderMaterial,
  SRGBColorSpace,
  UnsignedIntType,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';

/**
 * Lines drawn in screen space from the depth image. After the scene is rendered, a pixel is an
 * edge where the depth steps down to it from a neighbour: its depth is below the mean of its two
 * neighbours along a row or a column by more than `depth` metres. A flat surface has none of
 * these however steeply it is tilted, so only real steps are lined, and always on the nearer
 * side: a line belongs to the part in front and never paints over it. Edges then grow inward by
 * the line width over the same surface. Line pixels are written with alpha 254 for the pixel
 * stage's downscale.
 */
export class LinePass {
  private colour: WebGLRenderTarget | undefined;
  private mask: WebGLRenderTarget | undefined;
  private edges: WebGLRenderTarget | undefined;
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly edgeQuad: QuadScene = new QuadScene();
  private readonly compositeQuad: QuadScene = new QuadScene();
  private readonly edgeMaterial: ShaderMaterial;
  private readonly compositeMaterial: ShaderMaterial;
  private readonly masks = new Map<string, ShaderMaterial>();
  private readonly renderer: WebGLRenderer;

  constructor(renderer: WebGLRenderer) {
    this.renderer = renderer;
    this.edgeMaterial = new ShaderMaterial({
      name: 'td2d-line-edges',
      glslVersion: GLSL3,
      uniforms: { tDepth: { value: null }, tMask: { value: null }, threshold: { value: 0 } },
      vertexShader: QUAD_VERTEX,
      fragmentShader: EDGE_FRAGMENT,
    });
    this.compositeMaterial = new ShaderMaterial({
      name: 'td2d-line-composite',
      glslVersion: GLSL3,
      uniforms: {
        tColour: { value: null },
        tMask: { value: null },
        tEdges: { value: null },
        radius: { value: 4 },
        threshold: { value: 0 },
        fixedColour: { value: false },
        lineColour: { value: new Color() },
        shade: { value: 0.4 },
      },
      vertexShader: QUAD_VERTEX,
      fragmentShader: COMPOSITE_FRAGMENT,
    });
    this.edgeQuad.add(new Mesh(new PlaneGeometry(2, 2), this.edgeMaterial));
    this.compositeQuad.add(new Mesh(new PlaneGeometry(2, 2), this.compositeMaterial));
  }

  /** Render the scene with lines into the canvas, ready for readPixels. */
  render(
    scene: Scene,
    camera: OrthographicCamera,
    root: Object3D | undefined,
    lines: RenderLinesSettings,
    width: number,
    height: number,
    supersample: number,
  ): void {
    const { colour, mask, edges } = this.targets(width, height);
    const renderer = this.renderer;
    renderer.setRenderTarget(colour);
    renderer.render(scene, camera);

    // Each part's base colour, and whether it takes lines, in place of its shading.
    if (root) {
      const skip = new Set(lines.skip);
      const swapped: [Mesh, Material | Material[]][] = [];
      root.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        swapped.push([object, object.material]);
        const source = (Array.isArray(object.material) ? object.material[0] : object.material) as Material & {
          color?: Color;
        };
        object.material = this.maskMaterial(source, skip);
      });
      renderer.setRenderTarget(mask);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(root, camera);
      for (const [object, material] of swapped) object.material = material;
    }

    const threshold = lines.depth / (camera.far - camera.near);
    this.edgeMaterial.uniforms.tDepth = { value: colour.depthTexture };
    this.edgeMaterial.uniforms.threshold = { value: threshold };
    this.edgeMaterial.uniforms.tMask = { value: mask.texture };
    renderer.setRenderTarget(edges);
    renderer.render(this.edgeQuad, this.camera);

    const u = this.compositeMaterial.uniforms;
    u.tColour = { value: colour.texture };
    u.tMask = { value: mask.texture };
    u.tEdges = { value: edges.texture };
    u.radius = { value: Math.max(1, Math.round(lines.width * supersample)) };
    u.threshold = { value: threshold };
    u.fixedColour = { value: lines.color !== null };
    u.lineColour = { value: srgbTriple(lines.color ?? '#000000') };
    u.shade = { value: lines.shade };
    renderer.setRenderTarget(null);
    renderer.render(this.compositeQuad, this.camera);
  }

  dispose(): void {
    for (const target of [this.colour, this.mask, this.edges]) target?.dispose();
    for (const material of this.masks.values()) material.dispose();
  }

  private targets(width: number, height: number) {
    if (!this.colour || this.colour.width !== width || this.colour.height !== height) {
      for (const target of [this.colour, this.mask, this.edges]) target?.dispose();
      const options = { minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: true };
      this.colour = new WebGLRenderTarget(width, height, {
        ...options,
        type: HalfFloatType,
        depthTexture: new DepthTexture(width, height, UnsignedIntType),
      });
      this.mask = new WebGLRenderTarget(width, height, { ...options, type: HalfFloatType });
      this.edges = new WebGLRenderTarget(width, height, { ...options, type: FloatType, depthBuffer: false });
    }
    return {
      colour: this.colour,
      mask: this.mask as WebGLRenderTarget,
      edges: this.edges as WebGLRenderTarget,
    };
  }

  private maskMaterial(source: Material & { color?: Color }, skip: Set<string>): ShaderMaterial {
    // A part with its own colour uses the material variant <material>~<part id>.
    const lined = !skip.has(source.name.split('~')[0] as string);
    const key = `${source.name}|${lined}`;
    const existing = this.masks.get(key);
    if (existing) return existing;
    const material = new ShaderMaterial({
      name: 'td2d-line-mask',
      uniforms: {
        baseColour: {
          value: source.color ? srgbTriple(`#${source.color.getHexString(SRGBColorSpace)}`) : new Color(1, 1, 1),
        },
        lined: { value: lined ? 1 : 0 },
      },
      vertexShader: MASK_VERTEX,
      fragmentShader: MASK_FRAGMENT,
    });
    this.masks.set(key, material);
    return material;
  }
}

/** An sRGB colour as raw 0 to 1 channels, without conversion to linear. */
function srgbTriple(hex: string): Color {
  const n = Number.parseInt(hex.slice(1), 16);
  return new Color(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const QUAD_VERTEX = /* glsl */ `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const MASK_VERTEX = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>
  void main() {
    #include <skinbase_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    #include <project_vertex>
  }
`;

const MASK_FRAGMENT = /* glsl */ `
  uniform vec3 baseColour;
  uniform float lined;
  void main() {
    gl_FragColor = vec4(baseColour, lined);
  }
`;

const EDGE_FRAGMENT = /* glsl */ `
  precision highp float;
  layout(location = 0) out highp vec4 outColour;
  uniform sampler2D tDepth;
  uniform sampler2D tMask;
  uniform float threshold;
  ivec2 clampToImage(ivec2 p) {
    return clamp(p, ivec2(0), textureSize(tDepth, 0) - 1);
  }
  float depthAt(ivec2 p) {
    return texelFetch(tDepth, clampToImage(p), 0).r;
  }
  // Where this pixel's material meets another lined material and this pixel is not the farther
  // of the two: parts that touch with no step in depth still get a line between them. Materials
  // without lines (fine detail, dark gaps) never start one.
  bool meets(ivec2 p, ivec2 q, float d) {
    vec3 here = texelFetch(tMask, p, 0).rgb;
    vec4 there = texelFetch(tMask, clampToImage(q), 0);
    float dq = depthAt(q);
    return dq < 1.0 && there.a > 0.5 && any(greaterThan(abs(here - there.rgb), vec3(0.004))) && dq >= d;
  }
  void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    float d = depthAt(p);
    float across = depthAt(p + ivec2(1, 0)) + depthAt(p - ivec2(1, 0)) - 2.0 * d;
    float down = depthAt(p + ivec2(0, 1)) + depthAt(p - ivec2(0, 1)) - 2.0 * d;
    bool step = across > threshold || down > threshold;
    bool boundary = meets(p, p + ivec2(1, 0), d) || meets(p, p - ivec2(1, 0), d) ||
      meets(p, p + ivec2(0, 1), d) || meets(p, p - ivec2(0, 1), d);
    float edge = d < 1.0 && (step || boundary) ? 1.0 : 0.0;
    outColour = vec4(edge, d, 0.0, 1.0);
  }
`;

const COMPOSITE_FRAGMENT = /* glsl */ `
  precision highp float;
  layout(location = 0) out highp vec4 outColour;
  uniform sampler2D tColour;
  uniform sampler2D tMask;
  uniform sampler2D tEdges;
  uniform int radius;
  uniform float threshold;
  uniform bool fixedColour;
  uniform vec3 lineColour;
  uniform float shade;
  vec3 toSrgb(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
  }
  void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    ivec2 size = textureSize(tEdges, 0);
    vec4 colour = texelFetch(tColour, p, 0);
    vec4 mask = texelFetch(tMask, p, 0);
    float d = texelFetch(tEdges, p, 0).g;
    if (colour.a > 0.0 && mask.a > 0.5) {
      // An edge within the line width lines this pixel, unless this pixel lies on the farther
      // surface across the step; on the nearer surface it may be nearer or, on a slope, a little
      // farther than the edge.
      for (int dy = -radius + 1; dy < radius; dy++) {
        for (int dx = -radius + 1; dx < radius; dx++) {
          vec4 e = texelFetch(tEdges, clamp(p + ivec2(dx, dy), ivec2(0), size - 1), 0);
          if (e.r > 0.5 && d - e.g < threshold) {
            vec3 c = fixedColour ? lineColour : mask.rgb * shade;
            outColour = vec4(c, 254.0 / 255.0);
            return;
          }
        }
      }
    }
    outColour = vec4(toSrgb(colour.rgb), colour.a);
  }
`;
