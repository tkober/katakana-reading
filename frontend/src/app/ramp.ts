/** Shared sequential scale for "how well do I know this" magnitudes
 *  (kana confidence, word success rate) so every heat surface in the app
 *  reads as one system.
 *
 *  One hue, light→dark = more. On the dark surface the ramp is reversed so
 *  that "more" always moves away from the background. Each step carries the
 *  ink that keeps a label on top of it readable (≥ 5:1 against the fill);
 *  the flip sits where the fill crosses mid-luminance.
 *  Colors come from the validated reference palette of the dataviz skill —
 *  validate there before changing them.
 *
 *  Theme-aware by parameter, not by reading `prefers-color-scheme` once at
 *  module load: the viewer can switch Light/Dark at runtime via Sumi UI's
 *  theme toggle (`SumiTheme`), and a module-level constant would never
 *  notice. Callers inject `SumiTheme` (`sumi-ui/core`) and pass
 *  `theme.isDark()` — reading it from a template or a `computed()` keeps the
 *  ramp reactive to a toggle. */

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

/** Ramp steps in reading order (weak → strong) for the active theme — for legends. */
export function rampSteps(dark: boolean): RampStep[] {
  return dark ? STEPS_DARK : STEPS_LIGHT;
}

/** Maps a 0…1 magnitude onto the active theme's ramp. */
export function rampStep(value: number, dark: boolean): RampStep {
  const steps = rampSteps(dark);
  const idx = Math.min(steps.length - 1, Math.max(0, Math.floor(value * steps.length)));
  return steps[idx];
}

/** Ordinal scale for the five difficulty levels — same hue, but the step
 *  nearest the surface still clears 2:1, so a thin stacked segment never
 *  dissolves into the background (a continuous ramp may fade to nothing,
 *  an ordinal one may not). Level 1 → index 0. */
const LEVELS_LIGHT = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#0d366b'];
const LEVELS_DARK = ['#184f95', '#1c5cab', '#2a78d6', '#5598e7', '#86b6ef'];

export function levelColors(dark: boolean): string[] {
  return dark ? LEVELS_DARK : LEVELS_LIGHT;
}

export function levelColor(level: number, dark: boolean): string {
  const colors = levelColors(dark);
  return colors[Math.min(colors.length - 1, Math.max(0, level - 1))];
}
