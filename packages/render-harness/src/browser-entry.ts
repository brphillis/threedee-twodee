import {
  type EncodedFrame,
  type FrameSample,
  HARNESS_PROTOCOL_VERSION,
  type HarnessApi,
  type HarnessCapabilities,
  type RenderSceneSettings,
} from '@td2d/schema';
import { REVISION, WebGLRenderer } from 'three';
import { base64ToBytes, bytesToBase64 } from './base64.ts';
import { HarnessScene } from './scene.ts';

declare const __HARNESS_VERSION__: string;

function createRenderer(): { renderer: WebGLRenderer | undefined; error: string | undefined } {
  try {
    const canvas = document.createElement('canvas');
    const renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'default',
    });
    return { renderer, error: undefined };
  } catch (error) {
    return { renderer: undefined, error: error instanceof Error ? error.message : String(error) };
  }
}

const { renderer, error: rendererError } = createRenderer();
const scene = renderer ? new HarnessScene(renderer) : undefined;

function requireScene(): HarnessScene {
  if (!scene) throw new Error(`WebGL2 is not available: ${rendererError ?? 'unknown error'}`);
  return scene;
}

function capabilities(): HarnessCapabilities {
  if (!renderer) {
    return {
      harnessVersion: __HARNESS_VERSION__,
      threeRevision: REVISION,
      webgl2: false,
      renderer: rendererError ?? 'none',
      vendor: '',
      maxTextureSize: 0,
      maxRenderbufferSize: 0,
    };
  }
  const gl = renderer.getContext();
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    harnessVersion: __HARNESS_VERSION__,
    threeRevision: REVISION,
    webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
    renderer: String(debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
    vendor: String(debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)),
    maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
    maxRenderbufferSize: Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)),
  };
}

const api: HarnessApi & { protocol: number } = {
  ready: true,
  protocol: HARNESS_PROTOCOL_VERSION,
  capabilities,
  async loadModel(glbBase64: string) {
    const bytes = base64ToBytes(glbBase64);
    return requireScene().loadModel(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
  },
  configure(settings: RenderSceneSettings) {
    requireScene().configure(settings);
  },
  renderSamples(samples: readonly FrameSample[]): EncodedFrame[] {
    const s = requireScene();
    return samples.map((sample) => {
      const frame = s.render(sample);
      return { key: sample.key, width: frame.width, height: frame.height, rgbaBase64: bytesToBase64(frame.rgba) };
    });
  },
};

(globalThis as unknown as { __td2d: typeof api }).__td2d = api;
