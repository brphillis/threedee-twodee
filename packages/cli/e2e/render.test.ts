import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { probeModelGlb } from '@td2d/core';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { CLI, runJson, tempDir } from './helpers.ts';

async function withProbe(): Promise<string> {
  const dir = tempDir();
  writeFileSync(join(dir, 'probe.glb'), await probeModelGlb());
  return dir;
}

function browserProcesses(tag: string): string[] {
  const out = execFileSync('ps', ['-A', '-o', 'pid=,command='], { encoding: 'utf8' });
  return out.split('\n').filter((line) => line.includes(`--td2d-run=${tag}`));
}

describe('td2d render --glb', () => {
  it('writes one transparent PNG per direction and reports them', async () => {
    const cwd = await withProbe();
    const { exitCode, envelope } = await runJson(
      ['render', '--glb', 'probe.glb', '--out', 'frames', '--directions', 'd8', '--ground-margin', '4'],
      { cwd },
    );
    expect(exitCode).toBe(0);
    const data = envelope.data as {
      frames: { key: string; file: string; width: number; coverage: number }[];
      backend: { software: boolean; renderer: string };
      out: string;
    };
    expect(data.out).toBe('frames');
    expect(data.backend.software).toBe(true);
    expect(data.frames.map((f) => f.key)).toEqual(
      ['s', 'sw', 'w', 'nw', 'n', 'ne', 'e', 'se'].map((d) => `static/${d}/000`),
    );
    expect(envelope.warnings).toEqual([]);
    for (const frame of data.frames) {
      const meta = await sharp(join(cwd, 'frames', frame.file)).metadata();
      expect([meta.width, meta.height, meta.channels, meta.hasAlpha]).toEqual([128, 128, 4, true]);
      expect(frame.coverage).toBeGreaterThan(0.05);
    }
    expect(existsSync(join(cwd, 'frames', '.td2d-output'))).toBe(true);
  });

  it('samples clips at the requested times', async () => {
    const cwd = await withProbe();
    const { exitCode, envelope } = await runJson(
      ['render', '--glb', 'probe.glb', '--out', 'f', '--directions', 's', '--clip', 'idle', '--times', '0,0.5'],
      { cwd },
    );
    // The probe has no clips, so naming one is a render failure with a clear message.
    expect(exitCode).toBe(4);
    expect(envelope.error?.code).toBe('E_RENDER_FAILED');
    expect(envelope.error?.message).toMatch(/idle/);
  });

  it('warns when the model is cut off by the frame', async () => {
    const cwd = await withProbe();
    const { exitCode, envelope } = await runJson(
      ['render', '--glb', 'probe.glb', '--out', 'f', '--directions', 's', '--ground-margin', '0'],
      { cwd },
    );
    expect(exitCode).toBe(0);
    expect(envelope.warnings.map((w) => w.code)).toEqual(['W_FRAME_CLIPPED']);
  });

  it('rejects bad options, missing models and foreign output directories', async () => {
    const cwd = await withProbe();
    const badFrame = await runJson(['render', '--glb', 'probe.glb', '--out', 'f', '--frame', '32'], { cwd });
    expect([badFrame.exitCode, badFrame.envelope.error?.code]).toEqual([2, 'E_USAGE']);
    const timesWithoutClip = await runJson(['render', '--glb', 'probe.glb', '--out', 'f', '--times', '0,1'], { cwd });
    expect([timesWithoutClip.exitCode, timesWithoutClip.envelope.error?.code]).toEqual([2, 'E_USAGE']);
    const missing = await runJson(['render', '--glb', 'nope.glb', '--out', 'f'], { cwd });
    expect([missing.exitCode, missing.envelope.error?.code]).toEqual([3, 'E_MODEL_INVALID']);
    writeFileSync(join(cwd, 'notes.txt'), 'mine');
    const foreign = await runJson(['render', '--glb', 'probe.glb', '--out', '.'], { cwd });
    expect([foreign.exitCode, foreign.envelope.error?.code]).toEqual([2, 'E_OUTPUT_DIR_NOT_EMPTY']);
    const unknownPreset = await runJson(['render', '--glb', 'probe.glb', '--out', 'f', '--camera', 'fisheye'], { cwd });
    expect([unknownPreset.exitCode, unknownPreset.envelope.error?.code]).toEqual([3, 'E_PRESET_NOT_FOUND']);
  });

  it('stops within 2 seconds on SIGINT, exits 130 and leaves no browser running', async () => {
    const cwd = await withProbe();
    const tag = randomUUID();
    const child = spawn(
      process.execPath,
      [
        CLI,
        'render',
        '--glb',
        'probe.glb',
        '--out',
        'f',
        '--directions',
        'd16',
        '--frame',
        '256x256',
        '--supersample',
        '4',
        '--json',
      ],
      {
        cwd,
        env: { ...process.env, TD2D_RUN_TAG: tag },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    let signalledAt = 0;
    const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
    child.stderr.on('data', (d: Buffer) => {
      if (signalledAt === 0 && d.toString().includes('"item:done"')) {
        signalledAt = performance.now();
        child.kill('SIGINT');
      }
    });
    const code = await exited;
    expect(signalledAt).toBeGreaterThan(0);
    expect(performance.now() - signalledAt).toBeLessThan(2000);
    expect(code).toBe(130);
    expect(JSON.parse(stdout).error.code).toBe('E_CANCELLED');
    expect(browserProcesses(tag)).toEqual([]);
  });
});
