import { describe, expect, it } from 'vitest';

import { levelColor, levelColors } from './ramp';

describe('levelColor', () => {
  for (const dark of [false, true]) {
    describe(dark ? 'dark theme' : 'light theme', () => {
      it('maps level 1 to the first ordinal color', () => {
        expect(levelColor(1, dark)).toBe(levelColors(dark)[0]);
      });

      it('maps level 5 to the last ordinal color', () => {
        const colors = levelColors(dark);
        expect(levelColor(5, dark)).toBe(colors[colors.length - 1]);
      });

      it('clamps levels outside 1..5 instead of throwing', () => {
        const colors = levelColors(dark);
        expect(levelColor(0, dark)).toBe(colors[0]);
        expect(levelColor(99, dark)).toBe(colors[colors.length - 1]);
      });
    });
  }
});
