import { KanaStat } from './models';
import { basicMatrix, combinationsMatrix, extendedMatrix } from './stats-math';

function stat(kana: string, attempts: number, correct: number, ewma: number): KanaStat {
  return { kana, attempts, correct, accuracy: attempts ? correct / attempts : null, ewma };
}

function byKana(stats: KanaStat[]): Map<string, KanaStat> {
  return new Map(stats.map((s) => [s.kana, s]));
}

describe('basicMatrix', () => {
  it('is the 15 × 5 gojūon grid with blank slots only where no kana exists', () => {
    const m = basicMatrix(byKana([]));
    expect(m.rows.length).toBe(15);
    expect(m.columns).toEqual(['a', 'i', 'u', 'e', 'o']);
    expect(m.cells.length).toBe(75);
    const blanks = m.cells.filter((c) => c.blank).map((c) => `${c.row}/${c.column}`);
    expect(blanks).toEqual(['ヤ/i', 'ヤ/e', 'ワ/i', 'ワ/u', 'ワ/e']);
  });

  it('maps a cell back to its kana, with ヲ in ワ/o', () => {
    const m = basicMatrix(byKana([]));
    expect(m.kanaOf('カ', 'i')).toBe('キ');
    expect(m.kanaOf('パ', 'o')).toBe('ポ');
    expect(m.kanaOf('ワ', 'o')).toBe('ヲ');
  });

  it('carries the confidence and answer count, and "not practised yet" otherwise', () => {
    const m = basicMatrix(byKana([stat('キ', 10, 7, 0.82)]));
    const ki = m.cells.find((c) => c.row === 'カ' && c.column === 'i');
    const ka = m.cells.find((c) => c.row === 'カ' && c.column === 'a');
    expect(ki).toMatchObject({ value: 0.82, detail: '7/10 correct' });
    expect(ka).toMatchObject({ value: null, detail: 'not practised yet' });
    expect(ka?.blank).toBeFalsy();
  });
});

describe('combinationsMatrix', () => {
  it('pairs every yōon row with ya/yu/yo', () => {
    const m = combinationsMatrix(byKana([stat('ショ', 4, 1, 0.3)]));
    expect(m.cells.length).toBe(33);
    expect(m.kanaOf('シ', 'yo')).toBe('ショ');
    expect(m.cells.find((c) => c.row === 'シ' && c.column === 'yo')?.value).toBe(0.3);
  });
});

describe('extendedMatrix', () => {
  it('always lists ッ ン ー, then other practised kana outside both grids by attempts', () => {
    const all = [
      stat('キ', 50, 40, 0.9), // basic grid
      stat('キャ', 30, 20, 0.7), // combinations grid
      stat('ティ', 2, 1, 0.4),
      stat('ファ', 9, 5, 0.6),
      stat('ー', 12, 12, 1),
    ];
    const m = extendedMatrix(all, byKana(all));
    expect(m.rows).toEqual(['ッ', 'ン', 'ー', 'ファ', 'ティ']);
    expect(m.cells.find((c) => c.row === 'ッ')?.value).toBeNull();
    expect(m.kanaOf('ファ', 'Confidence')).toBe('ファ');
  });
});
