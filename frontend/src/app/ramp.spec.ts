import { describe, expect, it } from 'vitest';

import { LEVEL_COLORS, RAMP, levelColor, rampStep } from './ramp';

describe('rampStep', () => {
  it('maps the weakest magnitude to the first ramp step', () => {
    expect(rampStep(0).bg).toBe(RAMP[0]);
  });

  it('maps the strongest magnitude to the last ramp step', () => {
    expect(rampStep(1).bg).toBe(RAMP[RAMP.length - 1]);
  });

  it('clamps out-of-range magnitudes instead of throwing', () => {
    expect(rampStep(-5).bg).toBe(RAMP[0]);
    expect(rampStep(5).bg).toBe(RAMP[RAMP.length - 1]);
  });

  it('is monotonically non-decreasing in ramp index as the magnitude grows', () => {
    const indices = [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1].map((v) => RAMP.indexOf(rampStep(v).bg));
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThanOrEqual(indices[i - 1]);
    }
  });
});

describe('levelColor', () => {
  it('maps level 1 to the first ordinal color', () => {
    expect(levelColor(1)).toBe(LEVEL_COLORS[0]);
  });

  it('maps level 5 to the last ordinal color', () => {
    expect(levelColor(5)).toBe(LEVEL_COLORS[LEVEL_COLORS.length - 1]);
  });

  it('clamps levels outside 1..5 instead of throwing', () => {
    expect(levelColor(0)).toBe(LEVEL_COLORS[0]);
    expect(levelColor(99)).toBe(LEVEL_COLORS[LEVEL_COLORS.length - 1]);
  });
});
