import { Td2dError } from '@td2d/core';
import { CliEnvelope } from '@td2d/schema';
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { failureFor } from '../src/commands/validate.ts';
import { buildEnvelope, formatError } from '../src/output/envelope.ts';
import { commandPath } from '../src/run.ts';

describe('commandPath', () => {
  it('joins nested command names without the program name', () => {
    const program = new Command('td2d');
    const asset = program.command('asset');
    const create = asset.command('create');
    expect(commandPath(create)).toBe('asset create');
    expect(commandPath(program.command('validate'))).toBe('validate');
  });
});

describe('envelopes', () => {
  it('builds schema-valid success and failure envelopes', () => {
    const ok = buildEnvelope({ command: 'x', version: '0.0.0', durationMs: 1, data: { a: 1 }, warnings: [] });
    expect(CliEnvelope.parse(ok)).toMatchObject({ ok: true, data: { a: 1 } });
    const failed = buildEnvelope({
      command: 'x',
      version: '0.0.0',
      durationMs: 1,
      warnings: [],
      error: new Td2dError('E_ASSET_INVALID', 'bad', { issues: [{ path: 'a', message: 'm' }] }),
    });
    expect(CliEnvelope.parse(failed)).toMatchObject({
      ok: false,
      error: { code: 'E_ASSET_INVALID', docs: 'docs/reference/errors.md#e_asset_invalid' },
    });
  });

  it('formats errors with issues and a hint', () => {
    const text = formatError(
      new Td2dError('E_ASSET_INVALID', 'bad', {
        issues: [{ file: 'a.json', path: 'frame.width', message: 'Expected number' }],
      }).toDetail(),
    );
    expect(text).toMatch(/\[E_ASSET_INVALID\] bad/);
    expect(text).toMatch(/a\.json frame\.width: Expected number/);
    expect(text).toMatch(/hint Run `td2d schema asset`/);
  });
});

describe('failureFor', () => {
  const base = {
    stage: 'config' as const,
    library: { status: 'pass' as const, issues: [], invalid: { presets: false, palettes: false } },
    warnings: [],
  };

  it('returns nothing for a passing report', () => {
    expect(
      failureFor({ ...base, status: 'pass', assets: [], summary: { assets: 0, passed: 0, failed: 0 } }),
    ).toBeUndefined();
  });

  it('uses the failing asset error code and aggregates issues', () => {
    const error = failureFor({
      ...base,
      status: 'fail',
      summary: { assets: 2, passed: 0, failed: 2 },
      assets: [
        {
          id: 'a',
          file: 'a.json',
          status: 'fail',
          errorCode: 'E_PRESET_NOT_FOUND',
          issues: [{ path: 'camera', message: 'x' }],
          warnings: [],
        },
        {
          id: 'b',
          file: 'b.json',
          status: 'fail',
          errorCode: 'E_ASSET_INVALID',
          issues: [{ path: 'model', message: 'y' }],
          warnings: [],
        },
      ],
    });
    expect(error?.code).toBe('E_PRESET_NOT_FOUND');
    expect(error?.message).toBe('2 of 2 assets failed validation.');
    expect(error?.issues?.map((i) => i.path)).toEqual(['camera', 'model']);
  });

  it('names palette files as E_PALETTE_INVALID and preset files as E_PRESET_INVALID', () => {
    const library = (presets: boolean, palettes: boolean) => ({
      status: 'fail' as const,
      issues: [{ file: 'palettes/x.json', path: 'colors[0]', message: 'bad' }],
      invalid: { presets, palettes },
    });
    const report = (presets: boolean, palettes: boolean) => ({
      ...base,
      library: library(presets, palettes),
      status: 'fail' as const,
      assets: [],
      summary: { assets: 0, passed: 0, failed: 0 },
    });
    expect(failureFor(report(false, true))?.code).toBe('E_PALETTE_INVALID');
    expect(failureFor(report(false, true))?.message).toBe('Some palette files are invalid.');
    expect(failureFor(report(true, false))?.code).toBe('E_PRESET_INVALID');
    expect(failureFor(report(true, true))?.message).toBe('Some preset and palette files are invalid.');
  });
});
