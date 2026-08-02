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

/** Ordinal scale for the five difficulty levels — same hue, but the step
 *  nearest the surface still clears 2:1, so a thin stacked segment never
 *  dissolves into the background (a continuous ramp may fade to nothing,
 *  an ordinal one may not). Level 1 → index 0. */
const LEVELS_LIGHT = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#0d366b'];
const LEVELS_DARK = ['#184f95', '#1c5cab', '#2a78d6', '#5598e7', '#86b6ef'];

export const LEVEL_COLORS = prefersDark ? LEVELS_DARK : LEVELS_LIGHT;

export function levelColor(level: number): string {
  return LEVEL_COLORS[Math.min(LEVEL_COLORS.length - 1, Math.max(0, level - 1))];
}
