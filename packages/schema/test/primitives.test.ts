import { describe, expect, it } from 'vitest';
import { AssetId, ClipName, HexColor, Name, SchemaVersion } from '../src/index.ts';

describe('primitives', () => {
  it.each(['steel', 'endesga-32', 'a', '9-lives'])('accepts name %s', (v) => {
    expect(Name.safeParse(v).success).toBe(true);
  });
  it.each(['Steel', '-steel', 'steel_plate', '', 'a b', 'x'.repeat(65)])('rejects name %j', (v) => {
    expect(Name.safeParse(v).success).toBe(false);
  });
  it.each(['props/crate', 'crate', 'a/b/c-d'])('accepts asset id %s', (v) => {
    expect(AssetId.safeParse(v).success).toBe(true);
  });
  it.each(['props/', '/crate', 'props//crate', '../crate', 'props/Crate', 'props\\crate'])(
    'rejects asset id %j',
    (v) => {
      expect(AssetId.safeParse(v).success).toBe(false);
    },
  );
  it.each(['idle', 'attack_heavy', 'walk2'])('accepts clip name %s', (v) => {
    expect(ClipName.safeParse(v).success).toBe(true);
  });
  it.each(['Idle', '2walk', 'walk-left'])('rejects clip name %j', (v) => {
    expect(ClipName.safeParse(v).success).toBe(false);
  });
  it.each(['#a0693a', '#FFFFFF'])('accepts colour %s', (v) => {
    expect(HexColor.safeParse(v).success).toBe(true);
  });
  it.each(['a0693a', '#fff', '#a0693aff', 'red'])('rejects colour %j', (v) => {
    expect(HexColor.safeParse(v).success).toBe(false);
  });
  it('accepts any 1.x.y schema version and rejects others', () => {
    expect(SchemaVersion.safeParse('1.0.0').success).toBe(true);
    expect(SchemaVersion.safeParse('1.12.3').success).toBe(true);
    expect(SchemaVersion.safeParse('2.0.0').success).toBe(false);
    expect(SchemaVersion.safeParse('1.0').success).toBe(false);
  });
});
