import { describe, expect, it } from 'vitest';
import { applyFilter, checkFilter, filterKey, parseFrameSelector, type Td2dError } from '../src/index.ts';

const samples = ['walk/s/000', 'walk/s/001', 'walk/s/002', 'walk/w/000', 'walk/w/001', 'idle/s/000', 'idle/w/000'].map(
  (key) => ({
    key,
    clip: key.split('/')[0] as string,
    time: 0,
    yaw: 0,
  }),
);
const keys = (filter: Parameters<typeof applyFilter>[1]) => applyFilter(samples, filter).map((s) => s.key);

describe('frame selectors', () => {
  it('parses clip/direction/range with wildcards', () => {
    expect(parseFrameSelector('walk/s/0-2')).toEqual({ clip: 'walk', direction: 's', from: 0, to: 2 });
    expect(parseFrameSelector('walk/*/3')).toEqual({ clip: 'walk', direction: '*', from: 3, to: 3 });
    expect(parseFrameSelector('*/*/*')).toEqual({ clip: '*', direction: '*', from: 0, to: Number.POSITIVE_INFINITY });
  });

  it('rejects malformed selectors and backwards ranges with hints', () => {
    for (const bad of ['walk', 'walk/s', 'Walk/s/0', 'walk/s/a', 'walk/s/0-']) {
      const error = (() => {
        try {
          parseFrameSelector(bad);
        } catch (e) {
          return e as Td2dError;
        }
        throw new Error(`accepted ${bad}`);
      })();
      expect(error.code).toBe('E_USAGE');
      expect(error.hint).toMatch(/walk\/s\/0-2/);
    }
    expect(() => parseFrameSelector('walk/s/3-1')).toThrow(/backwards/);
  });
});

describe('sample filters', () => {
  it('narrows by clip, direction and frame selectors', () => {
    expect(keys(undefined)).toHaveLength(7);
    expect(keys({ clips: ['idle'] })).toEqual(['idle/s/000', 'idle/w/000']);
    expect(keys({ directions: ['w'] })).toEqual(['walk/w/000', 'walk/w/001', 'idle/w/000']);
    expect(keys({ frames: [parseFrameSelector('walk/s/1-2'), parseFrameSelector('idle/*/0')] })).toEqual([
      'walk/s/001',
      'walk/s/002',
      'idle/s/000',
      'idle/w/000',
    ]);
    expect(keys({ clips: ['walk'], directions: ['s'], frames: [parseFrameSelector('*/*/0')] })).toEqual(['walk/s/000']);
  });

  it('has a stable cache key, null when it allows everything', () => {
    expect(filterKey(undefined)).toBeNull();
    expect(filterKey({})).toBeNull();
    expect(filterKey({ clips: ['b', 'a'] })).toEqual(filterKey({ clips: ['a', 'b'] }));
    expect(filterKey({ clips: ['a'] })).not.toEqual(filterKey({ clips: ['b'] }));
  });

  it('rejects clips and directions the asset does not have', () => {
    const asset = {
      id: 'characters/knight',
      animation: { clips: { walk: {}, idle: {} } },
      directions: [{ name: 's' }, { name: 'w' }],
    } as never;
    expect(() => checkFilter({ clips: ['run'] }, asset)).toThrow(/no clip "run"/);
    expect(() => checkFilter({ frames: [parseFrameSelector('walk/n/0')] }, asset)).toThrow(/no direction "n"/);
    expect(() => checkFilter({ frames: [parseFrameSelector('*/*/0')] }, asset)).not.toThrow();
  });
});
