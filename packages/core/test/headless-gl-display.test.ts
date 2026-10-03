import { describe, expect, it } from 'vitest';
import { missingDisplay } from '../src/index.ts';

describe('headless-gl display check', () => {
  it('needs DISPLAY on Linux only, and names xvfb-run when it is missing', () => {
    expect(missingDisplay({}, 'linux')).toMatch(/DISPLAY is not set.*xvfb-run/);
    expect(missingDisplay({ DISPLAY: ':99' }, 'linux')).toBeNull();
    expect(missingDisplay({}, 'darwin')).toBeNull();
    expect(missingDisplay({}, 'win32')).toBeNull();
  });
});
