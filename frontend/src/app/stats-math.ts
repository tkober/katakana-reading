// Pure builders for the Stats page's three kana-confidence matrices
// (#8), kept out of the component so they can be unit-tested without a
// TestBed — the same split as jp-conjugation's stats-math.ts.
import type { SumiMatrixCellInput } from 'sumi-ui/charts';

import { KanaStat } from './models';

/** Basic gojūon grid: row header = the a-column kana, `null` = a slot that
 *  does not exist (ヤ/i, ヤ/e, ワ/i, ワ/u, ワ/e — `blank: true` cells).
 *  ヲ sits in ワ/o, same place the kana itself is read. */
const BASIC_COLUMNS = ['a', 'i', 'u', 'e', 'o'];
const BASIC_ROWS: { header: string; kana: (string | null)[] }[] = [
  { header: 'ア', kana: ['ア', 'イ', 'ウ', 'エ', 'オ'] },
  { header: 'カ', kana: ['カ', 'キ', 'ク', 'ケ', 'コ'] },
  { header: 'サ', kana: ['サ', 'シ', 'ス', 'セ', 'ソ'] },
  { header: 'タ', kana: ['タ', 'チ', 'ツ', 'テ', 'ト'] },
  { header: 'ナ', kana: ['ナ', 'ニ', 'ヌ', 'ネ', 'ノ'] },
  { header: 'ハ', kana: ['ハ', 'ヒ', 'フ', 'ヘ', 'ホ'] },
  { header: 'マ', kana: ['マ', 'ミ', 'ム', 'メ', 'モ'] },
  { header: 'ヤ', kana: ['ヤ', null, 'ユ', null, 'ヨ'] },
  { header: 'ラ', kana: ['ラ', 'リ', 'ル', 'レ', 'ロ'] },
  { header: 'ワ', kana: ['ワ', null, null, null, 'ヲ'] },
  { header: 'ガ', kana: ['ガ', 'ギ', 'グ', 'ゲ', 'ゴ'] },
  { header: 'ザ', kana: ['ザ', 'ジ', 'ズ', 'ゼ', 'ゾ'] },
  { header: 'ダ', kana: ['ダ', 'ヂ', 'ヅ', 'デ', 'ド'] },
  { header: 'バ', kana: ['バ', 'ビ', 'ブ', 'ベ', 'ボ'] },
  { header: 'パ', kana: ['パ', 'ピ', 'プ', 'ペ', 'ポ'] },
];

/** Digraph grid: row = base consonant kana, column = small ya/yu/yo kana —
 *  every (row, column) pair is a real digraph, no blanks. */
const COMBO_ROWS = ['キ', 'シ', 'チ', 'ニ', 'ヒ', 'ミ', 'リ', 'ギ', 'ジ', 'ビ', 'ピ'];
const COMBO_COLUMNS = ['ya', 'yu', 'yo'];
const COMBO_SUFFIX: Record<string, string> = { ya: 'ャ', yu: 'ュ', yo: 'ョ' };

/** Extended kana & marks: always shown even if never practised, then every
 *  other practised token outside the two grids above — same "only what was
 *  practised" rule today's combo chips used. */
const ALWAYS_EXTENDED = ['ッ', 'ン', 'ー'];

const BASIC_KANA = new Set(
  BASIC_ROWS.flatMap((row) => row.kana).filter((k): k is string => k !== null),
);
const COMBO_KANA = new Set(
  COMBO_ROWS.flatMap((row) => COMBO_COLUMNS.map((column) => row + COMBO_SUFFIX[column])),
);

export type MatrixId = 'basic' | 'combinations' | 'extended';

/** One kana-confidence matrix, plus a `kanaOf` so a `cellSelect` (whose row
 *  may be a consonant, not a full kana — see the combinations grid) can be
 *  turned back into the actual kana for the shared readout line. */
export interface Matrix {
  id: MatrixId;
  title: string;
  ariaLabel: string;
  rows: string[];
  columns: string[];
  cells: SumiMatrixCellInput[];
  kanaOf: (row: string, column: string) => string;
}

function statCell(row: string, column: string, stat: KanaStat | null): SumiMatrixCellInput {
  if (!stat) {
    return { row, column, value: null, detail: 'not practised yet' };
  }
  return { row, column, value: stat.ewma, detail: `${stat.correct}/${stat.attempts} correct` };
}

export function basicMatrix(byKana: Map<string, KanaStat>): Matrix {
  const cells: SumiMatrixCellInput[] = [];
  for (const row of BASIC_ROWS) {
    row.kana.forEach((kana, i) => {
      const column = BASIC_COLUMNS[i];
      if (kana === null) {
        cells.push({ row: row.header, column, value: null, blank: true });
        return;
      }
      cells.push(statCell(row.header, column, byKana.get(kana) ?? null));
    });
  }
  return {
    id: 'basic',
    title: 'Basic kana',
    ariaLabel: 'Basic katakana reading confidence, by consonant row and vowel column',
    rows: BASIC_ROWS.map((row) => row.header),
    columns: BASIC_COLUMNS,
    cells,
    kanaOf: (row, column) => {
      const def = BASIC_ROWS.find((r) => r.header === row);
      const i = BASIC_COLUMNS.indexOf(column);
      return (def && def.kana[i]) || row;
    },
  };
}

export function combinationsMatrix(byKana: Map<string, KanaStat>): Matrix {
  const cells: SumiMatrixCellInput[] = [];
  for (const row of COMBO_ROWS) {
    for (const column of COMBO_COLUMNS) {
      const kana = row + COMBO_SUFFIX[column];
      cells.push(statCell(row, column, byKana.get(kana) ?? null));
    }
  }
  return {
    id: 'combinations',
    title: 'Combinations',
    ariaLabel: 'Katakana digraph reading confidence, by consonant row and small-kana column',
    rows: COMBO_ROWS,
    columns: COMBO_COLUMNS,
    cells,
    kanaOf: (row, column) => row + COMBO_SUFFIX[column],
  };
}

export function extendedMatrix(allKana: KanaStat[], byKana: Map<string, KanaStat>): Matrix {
  const others = allKana
    .filter(
      (k) =>
        !BASIC_KANA.has(k.kana) && !COMBO_KANA.has(k.kana) && !ALWAYS_EXTENDED.includes(k.kana),
    )
    .sort((a, b) => b.attempts - a.attempts)
    .map((k) => k.kana);
  const rows = [...ALWAYS_EXTENDED, ...others];
  return {
    id: 'extended',
    title: 'Extended kana & marks',
    ariaLabel: 'Extended katakana and marks reading confidence',
    rows,
    columns: ['Confidence'],
    cells: rows.map((kana) => statCell(kana, 'Confidence', byKana.get(kana) ?? null)),
    kanaOf: (row) => row,
  };
}
