import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PhaserAtlas, type PhaserAtlasT, PixiSheet, type PixiSheetT } from '@td2d/schema';
import { CORE_VERSION } from '../version.ts';
import { type ExportContext, type Exporter, sequenceName, writeChecked } from './registry.ts';

const anchor = (ctx: ExportContext) => ({
  x: Number((ctx.pivot.x / ctx.layout.frame.width).toFixed(6)),
  y: Number((ctx.pivot.y / ctx.layout.frame.height).toFixed(6)),
});

/** Frame names for engines: the sprite key, clip/direction/nnn. */
const frameName = (key: string) => key;

export const pixiExporter: Exporter = {
  id: 'pixi',
  version: 1,
  description: 'PixiJS spritesheet JSON per sheet, with an animation per clip and direction and the pivot as anchor.',
  async write(ctx) {
    const files = ctx.images.map((image) => image.replace(/\.png$/, '.pixi.json'));
    return ctx.images.map((image, page) => {
      const cells = ctx.layout.cells.filter((c) => c.page === page);
      const frames: PixiSheetT['frames'] = {};
      const animations: PixiSheetT['animations'] = {};
      for (const c of cells) {
        frames[frameName(c.key)] = {
          frame: { x: c.x, y: c.y, w: c.w, h: c.h },
          rotated: false,
          trimmed: c.trimmed,
          spriteSourceSize: { x: c.offset.x, y: c.offset.y, w: c.w, h: c.h },
          sourceSize: { w: ctx.layout.frame.width, h: ctx.layout.frame.height },
          anchor: anchor(ctx),
        };
        const name = sequenceName(c.clip, c.direction);
        animations[name] = [...(animations[name] ?? []), frameName(c.key)];
      }
      const others = files.filter((_, i) => i !== page);
      const sheet: PixiSheetT = {
        frames,
        animations,
        meta: {
          app: 'td2d',
          version: CORE_VERSION,
          image,
          format: 'RGBA8888',
          size: {
            w: (ctx.layout.pages[page] as { width: number }).width,
            h: (ctx.layout.pages[page] as { height: number }).height,
          },
          scale: '1',
          ...(others.length > 0 ? { related_multi_packs: others } : {}),
        },
      };
      return writeChecked(ctx.dir, files[page] as string, sheet, PixiSheet, 'PixiJS');
    });
  },
};

export const phaserExporter: Exporter = {
  id: 'phaser-atlas',
  version: 1,
  description: 'One Phaser multi-atlas JSON for all sheets, with animation configs for this.anims.create.',
  async write(ctx) {
    const atlas: PhaserAtlasT = {
      textures: ctx.images.map((image, page) => ({
        image,
        format: 'RGBA8888',
        size: {
          w: (ctx.layout.pages[page] as { width: number }).width,
          h: (ctx.layout.pages[page] as { height: number }).height,
        },
        scale: 1,
        frames: ctx.layout.cells
          .filter((c) => c.page === page)
          .map((c) => ({
            filename: frameName(c.key),
            rotated: false,
            trimmed: c.trimmed,
            sourceSize: { w: ctx.layout.frame.width, h: ctx.layout.frame.height },
            spriteSourceSize: { x: c.offset.x, y: c.offset.y, w: c.w, h: c.h },
            frame: { x: c.x, y: c.y, w: c.w, h: c.h },
            anchor: anchor(ctx),
          })),
      })),
      animations: [],
      meta: { app: 'td2d', version: CORE_VERSION },
    };
    const sequences = new Map<string, string[]>();
    for (const c of ctx.layout.cells)
      sequences.set(sequenceName(c.clip, c.direction), [
        ...(sequences.get(sequenceName(c.clip, c.direction)) ?? []),
        frameName(c.key),
      ]);
    for (const [key, frames] of sequences) {
      const clip = ctx.asset.animation.clips[key.slice(0, key.lastIndexOf('_'))] as { fps: number; loop: boolean };
      atlas.animations.push({ key, frameRate: clip.fps, repeat: clip.loop ? -1 : 0, frames });
    }
    return [writeChecked(ctx.dir, `${ctx.name}.phaser.json`, atlas, PhaserAtlas, 'Phaser')];
  },
};

const float = (n: number) => (Number.isInteger(n) ? `${n}.0` : String(n));
const godotId = (text: string) => text.replace(/[^A-Za-z0-9_]/g, '_');

/**
 * A Godot 4 SpriteFrames resource in text form (format=3, as Godot 4.6 writes it, without
 * load_steps). Each sheet is an ext_resource Texture2D; each cell is an AtlasTexture whose
 * margin restores the trimmed frame; each clip and direction is an animation named
 * <clip>_<direction> at the clip's fps.
 */
export function buildGodotSpriteFrames(ctx: Pick<ExportContext, 'asset' | 'layout' | 'images'>): string {
  const dirPath = ctx.asset.export.godot.directory;
  const lines: string[] = ['[gd_resource type="SpriteFrames" format=3]', ''];
  ctx.images.forEach((image, page) => {
    lines.push(
      `[ext_resource type="Texture2D" path="${dirPath}${image}" id="${page + 1}_${godotId(image.replace(/\.png$/, ''))}"]`,
    );
  });
  lines.push('');
  const subId = (key: string) => `AtlasTexture_${godotId(key)}`;
  for (const c of ctx.layout.cells) {
    const image = ctx.images[c.page] as string;
    lines.push(`[sub_resource type="AtlasTexture" id="${subId(c.key)}"]`);
    lines.push(`atlas = ExtResource("${c.page + 1}_${godotId(image.replace(/\.png$/, ''))}")`);
    lines.push(`region = Rect2(${c.x}, ${c.y}, ${c.w}, ${c.h})`);
    if (c.trimmed)
      lines.push(
        `margin = Rect2(${c.offset.x}, ${c.offset.y}, ${ctx.layout.frame.width - c.w}, ${ctx.layout.frame.height - c.h})`,
      );
    lines.push('');
  }
  const sequences = new Map<string, typeof ctx.layout.cells>();
  for (const c of ctx.layout.cells)
    sequences.set(sequenceName(c.clip, c.direction), [...(sequences.get(sequenceName(c.clip, c.direction)) ?? []), c]);
  const animations = [...sequences].map(([name, cells]) => {
    const clip = ctx.asset.animation.clips[(cells[0] as { clip: string }).clip] as { fps: number; loop: boolean };
    const frames = cells.map((c) => `{\n"duration": 1.0,\n"texture": SubResource("${subId(c.key)}")\n}`).join(', ');
    return `{\n"frames": [${frames}],\n"loop": ${clip.loop},\n"name": &"${name}",\n"speed": ${float(clip.fps)}\n}`;
  });
  lines.push('[resource]', `animations = [${animations.join(', ')}]`, '');
  return lines.join('\n');
}

export const godotExporter: Exporter = {
  id: 'godot-spriteframes',
  version: 1,
  description:
    'A Godot 4 SpriteFrames .tres resource with an AtlasTexture per frame and an animation per clip and direction.',
  async write(ctx) {
    const file = `${ctx.name}.tres`;
    writeFileSync(join(ctx.dir, file), buildGodotSpriteFrames(ctx));
    return [file];
  },
};

export const framesExporter: Exporter = {
  id: 'frames',
  version: 1,
  description: 'Every sprite as its own untrimmed PNG: frames/<name>_<clip>_<direction>_<nnn>.png.',
  async write(ctx) {
    const files: string[] = [];
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(ctx.dir, 'frames'), { recursive: true });
    for (const c of ctx.layout.cells) {
      const source = ctx.spriteFiles.get(c.key);
      if (!source) continue;
      const file = `frames/${ctx.name}_${c.clip}_${c.direction}_${String(c.index).padStart(3, '0')}.png`;
      await ctx.writeImage(source, file);
      files.push(file);
    }
    return files;
  },
};
