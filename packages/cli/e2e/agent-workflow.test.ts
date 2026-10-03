// Section 11.5 of the roadmap: an agent's session, using only what AGENTS.md documents:
// the commands it lists, --help, schema, describe, explain, JSON envelopes and the files written.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run, runJson, tempDir } from './helpers.ts';

const REPO = join(import.meta.dirname, '..', '..', '..');
const AGENTS = readFileSync(join(REPO, 'AGENTS.md'), 'utf8');

type Data = Record<string, unknown>;
const data = (r: { envelope: { data?: unknown } }) => r.envelope.data as Data;

describe('agent workflow', () => {
  it('goes from AGENTS.md to a validated sheet, recovers from a schema error and iterates from the cache', async () => {
    // 1. The commands AGENTS.md tells an agent to run all exist.
    const listed = [...AGENTS.matchAll(/`td2d ([a-z]+(?: [a-z]+)?)[^`]*`/g)].map((m) => m[1] as string);
    const root = tempDir();
    const described = await runJson(['describe'], { cwd: root });
    const commands = new Set((data(described).cli as { commands: { name: string }[] }).commands.map((c) => c.name));
    const known = (name: string) =>
      commands.has(name) ||
      commands.has(name.split(' ')[0] as string) ||
      [...commands].some((c) => c.startsWith(`${name} `));
    expect(new Set(listed).size).toBeGreaterThan(10);
    expect(listed.filter((name) => !known(name))).toEqual([]);

    // 2. Its iterate block, in order.
    const init = await runJson(['init', 'my-sprites'], { cwd: root });
    expect([init.exitCode, init.envelope.ok]).toEqual([0, true]);
    const cwd = join(root, 'my-sprites');

    // 3. Write an asset from the schema's own example.
    const schema = await runJson(['schema', 'asset'], { cwd });
    const example = (data(schema).schema as { examples: Data[] }).examples[0] as Data;
    expect(example).toBeDefined();
    const file = join(cwd, 'assets', 'props', 'sample', 'asset.json');
    const created = await runJson(['asset', 'create', 'props/sample', '--template', 'box'], { cwd });
    expect(created.exitCode).toBe(0);
    writeFileSync(file, JSON.stringify({ ...example, acceptance: { minAlphaCoverage: 0.1 } }, null, 2));

    const validated = await runJson(['validate', 'props/sample'], { cwd });
    expect([validated.exitCode, validated.envelope.ok]).toEqual([0, true]);
    const generated = await runJson(['generate', 'props/sample'], { cwd });
    expect(generated.exitCode, generated.stderr).toBe(0);
    const result = (data(generated).results as Data[])[0] as {
      outputs: Record<string, string>;
      validation: { status: string };
    };
    for (const key of ['sheet', 'manifest', 'validation', 'generation'])
      expect(existsSync(join(cwd, result.outputs[key] as string)), key).toBe(true);
    expect(result.validation.status).toBe('pass');
    const preview = await runJson(['preview', 'props/sample'], { cwd });
    expect(existsSync(join(cwd, data(preview).file as string))).toBe(true);

    // 4. A schema mistake is reported at its path with a hint, and explain says more.
    const broken = JSON.parse(readFileSync(file, 'utf8')) as { model: { parts: { size: number[] }[] } };
    (broken.model.parts[0] as { size: number[] }).size = [1, 1];
    writeFileSync(file, JSON.stringify(broken, null, 2));
    const invalid = await runJson(['validate', 'props/sample'], { cwd });
    expect(invalid.exitCode).toBe(3);
    expect(invalid.envelope.error?.code).toBe('E_ASSET_INVALID');
    expect(invalid.envelope.error?.issues?.map((i) => i.path)).toContain('model.parts[0].size');
    expect(invalid.envelope.error?.hint).toMatch(/td2d schema asset/);
    const explained = await runJson(['explain', invalid.envelope.error?.code as string], { cwd });
    expect(data(explained)).toMatchObject({ code: 'E_ASSET_INVALID', exit: 3 });

    // 5. Fix it and regenerate one frame: everything comes from the cache.
    writeFileSync(file, JSON.stringify({ ...example, acceptance: { minAlphaCoverage: 0.1 } }, null, 2));
    const again = await runJson(['generate', 'props/sample', '--frames', 'idle/s/0'], { cwd });
    expect(again.exitCode, again.stderr).toBe(0);
    const rerun = (data(again).results as Data[])[0] as {
      stages: { name: string; status: string }[];
      items: { render: { rendered: number; reused: number } | null };
    };
    expect(
      rerun.stages.every((s) => s.status === 'cached'),
      JSON.stringify(rerun.stages),
    ).toBe(true);

    // 6. A real change rerenders, and compare quantifies it.
    const recoloured = { ...example, materials: { wood: { color: '#3e8948', shading: 'toon' } } };
    writeFileSync(file, JSON.stringify(recoloured, null, 2));
    const changed = await runJson(['generate', 'props/sample'], { cwd });
    expect(changed.exitCode, changed.stderr).toBe(0);
    const stages = Object.fromEntries(
      ((data(changed).results as Data[])[0] as { stages: { name: string; status: string }[] }).stages.map((s) => [
        s.name,
        s.status,
      ]),
    );
    expect(stages).toMatchObject({ model: 'cached', render: 'ran' });
    const compared = await runJson(['compare', 'props/sample'], { cwd });
    expect(compared.exitCode).toBe(0);
    expect(data(compared).changedPixels).toBeGreaterThan(0);

    // 7. The --help of every leaf command AGENTS.md names shows an example.
    for (const name of new Set(listed.filter((n) => commands.has(n)))) {
      const help = await run([...name.split(' '), '--help'], { cwd });
      expect(help.exitCode, name).toBe(0);
      expect(help.stdout, `${name} --help`).toMatch(/Examples:\n\s+\$ /);
    }
  }, 180_000);
});
