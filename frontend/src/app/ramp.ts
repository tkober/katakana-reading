/** Shared sequential scale for "how well do I know this" magnitudes
 *  (kana confidence, word success rate) so every heat surface in the app
 *  reads as one system.
 *
 *  One hue, light→dark = more. On the dark surface the ramp is reversed so
 *  that "more" always moves away from the background. Each step carries the
 *  ink that keeps a label on top of it readable (≥ 5:1 against the fill);
 *  the flip sits where the fill crosses mid-luminance.
 *  Colors come from the validated reference palette of the dataviz skill —
 *  validate there before changing them. */

const INK_DARK = '#0b0b0b';
const INK_LIGHT = '#ffffff';

export interface RampStep {
  /** Fill color for the cell. */
  bg: string;
  /** Label color that stays legible on that fill. */
  fg: string;
}

/** Light→dark. Index 0 = weakest. */
const STEPS_LIGHT: RampStep[] = [
  { bg: '#cde2fb', fg: INK_DARK },
  { bg: '#9ec5f4', fg: INK_DARK },
  { bg: '#6da7ec', fg: INK_DARK },
  { bg: '#3987e5', fg: INK_DARK },
  { bg: '#256abf', fg: INK_LIGHT },
  { bg: '#184f95', fg: INK_LIGHT },
  { bg: '#0d366b', fg: INK_LIGHT },
];

const STEPS_DARK: RampStep[] = [...STEPS_LIGHT].reverse();

export const prefersDark =
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches;

const STEPS = prefersDark ? STEPS_DARK : STEPS_LIGHT;

/** Ramp colors in reading order (weak → strong) — for legends. */
export const RAMP: string[] = STEPS.map((s) => s.bg);

/** Maps a 0…1 magnitude onto the active ramp. */
export function rampStep(value: number): RampStep {
  const idx = Math.min(
    STEPS.length - 1,
    Math.max(0, Math.floor(value * STEPS.length)),
  );
  return STEPS[idx];
}
