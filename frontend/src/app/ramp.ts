/** Ordinal 5-step scale for the difficulty levels 1-5 (dictionaries.component.ts,
 *  until #9 moves that tab onto Sumi UI too). Kana confidence and other
 *  continuous magnitudes now use sumi-matrix-heatmap's own `--sumi-seq-*`
 *  ramp directly (#8) — this file only keeps the ordinal scale, which has
 *  no library equivalent: each step still needs to clear ≥2:1 against the
 *  surface on its own, so a thin stacked segment never dissolves into the
 *  background (a continuous ramp may fade to nothing, an ordinal one may
 *  not). Level 1 → index 0. Colors come from the validated reference
 *  palette of the dataviz skill — validate there before changing them. */

const LEVELS_LIGHT = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#0d366b'];
const LEVELS_DARK = ['#184f95', '#1c5cab', '#2a78d6', '#5598e7', '#86b6ef'];

export function levelColors(dark: boolean): string[] {
  return dark ? LEVELS_DARK : LEVELS_LIGHT;
}

export function levelColor(level: number, dark: boolean): string {
  const colors = levelColors(dark);
  return colors[Math.min(colors.length - 1, Math.max(0, level - 1))];
}
