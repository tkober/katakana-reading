import { describe, expect, it } from 'vitest';

import { levelColor, levelColors, rampStep, rampSteps } from './ramp';

describe('rampStep', () => {
  for (const dark of [false, true]) {
    describe(dark ? 'dark theme' : 'light theme', () => {
      it('maps the weakest magnitude to the first ramp step', () => {
        expect(rampStep(0, dark).bg).toBe(rampSteps(dark)[0].bg);
      });

      it('maps the strongest magnitude to the last ramp step', () => {
        const steps = rampSteps(dark);
        expect(rampStep(1, dark).bg).toBe(steps[steps.length - 1].bg);
      });

      it('clamps out-of-range magnitudes instead of throwing', () => {
        const steps = rampSteps(dark);
        expect(rampStep(-5, dark).bg).toBe(steps[0].bg);
        expect(rampStep(5, dark).bg).toBe(steps[steps.length - 1].bg);
      });

      it('is monotonically non-decreasing in ramp index as the magnitude grows', () => {
        const steps = rampSteps(dark);
        const indices = [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1].map((v) =>
          steps.findIndex((s) => s.bg === rampStep(v, dark).bg),
        );
        for (let i = 1; i < indices.length; i++) {
          expect(indices[i]).toBeGreaterThanOrEqual(indices[i - 1]);
        }
      });
    });
  }

  it('reverses the ramp between light and dark so "more" always moves away from the background', () => {
    expect(rampStep(1, false).bg).toBe(rampSteps(true)[0].bg);
    expect(rampStep(0, false).bg).toBe(rampSteps(true)[rampSteps(true).length - 1].bg);
  });
});

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
