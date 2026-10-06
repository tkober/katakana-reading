import { Component, Input, computed, signal } from '@angular/core';

import { KanaStat } from './models';
import { RAMP, rampStep } from './ramp';

const GRID: (string | null)[][] = [
  ['ア', 'イ', 'ウ', 'エ', 'オ'],
  ['カ', 'キ', 'ク', 'ケ', 'コ'],
  ['サ', 'シ', 'ス', 'セ', 'ソ'],
  ['タ', 'チ', 'ツ', 'テ', 'ト'],
  ['ナ', 'ニ', 'ヌ', 'ネ', 'ノ'],
  ['ハ', 'ヒ', 'フ', 'ヘ', 'ホ'],
  ['マ', 'ミ', 'ム', 'メ', 'モ'],
  ['ヤ', null, 'ユ', null, 'ヨ'],
  ['ラ', 'リ', 'ル', 'レ', 'ロ'],
  ['ワ', null, null, null, 'ヲ'],
  ['ン', null, null, null, null],
  ['ガ', 'ギ', 'グ', 'ゲ', 'ゴ'],
  ['ザ', 'ジ', 'ズ', 'ゼ', 'ゾ'],
  ['ダ', 'ヂ', 'ヅ', 'デ', 'ド'],
  ['バ', 'ビ', 'ブ', 'ベ', 'ボ'],
  ['パ', 'ピ', 'プ', 'ペ', 'ポ'],
];

const GRID_KANA = new Set(GRID.flat().filter((k): k is string => k !== null));

interface Cell {
  kana: string | null;
  stat: KanaStat | null;
  bg: string;
  fg: string;
}

@Component({
  selector: 'app-heatmap',
  template: `
    <div class="wrap">
      <div class="grid kana-font">
        @for (row of cells(); track $index) {
          @for (cell of row; track $index) {
            @if (cell.kana) {
              <div
                class="cell"
                [class.empty]="!cell.stat"
                [style.background]="cell.bg"
                [style.color]="cell.fg"
                (mouseenter)="hover.set(cell)"
                (mouseleave)="hover.set(null)"
              >
                {{ cell.kana }}
              </div>
            } @else {
              <div class="gap"></div>
            }
          }
        }
      </div>

      @if (combos().length > 0) {
        <h3>Combinations &amp; special marks</h3>
        <div class="combos kana-font">
          @for (cell of combos(); track cell.kana) {
            <div
              class="cell combo"
              [style.background]="cell.bg"
              [style.color]="cell.fg"
              (mouseenter)="hover.set(cell)"
              (mouseleave)="hover.set(null)"
            >
              {{ cell.kana === 'ー' ? 'ー' : cell.kana }}
            </div>
          }
        </div>
      }

      <div class="legend">
        <span>shaky</span>
        @for (c of ramp; track $index) {
          <span class="swatch" [style.background]="c"></span>
        }
        <span>confident</span>
        <span class="legend-note">gray = not practiced yet</span>
      </div>

      @if (hover(); as h) {
        <div class="tooltip">
          <strong class="kana-font">{{ h.kana }}</strong>
          @if (h.stat; as s) {
            <span>{{ s.correct }}/{{ s.attempts }} correct</span>
            <span>confidence {{ pct(s.ewma) }}</span>
          } @else {
            <span>not practiced yet</span>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      .wrap {
        position: relative;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(5, minmax(38px, 52px));
        gap: 4px;
        justify-content: start;
      }
      .cell {
        aspect-ratio: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        font-size: 19px;
        font-weight: 600;
        cursor: default;
      }
      .cell.empty {
        background: transparent;
        border: 1px solid var(--grid);
        color: var(--muted);
        font-weight: 400;
      }
      .gap {
        aspect-ratio: 1;
      }
      h3 {
        font-size: 14px;
        color: var(--ink-2);
        margin: 18px 0 8px;
        font-weight: 600;
      }
      .combos {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      .cell.combo {
        aspect-ratio: auto;
        min-width: 44px;
        height: 44px;
        padding: 0 10px;
      }
      .legend {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-top: 16px;
        font-size: 12px;
        color: var(--muted);
      }
      .legend .swatch {
        width: 18px;
        height: 10px;
        border-radius: 2px;
      }
      .legend span:first-child {
        margin-right: 4px;
      }
      .legend span:nth-last-child(2) {
        margin-left: 4px;
      }
      .legend-note {
        margin-left: 14px;
      }
      .tooltip {
        position: absolute;
        top: -8px;
        right: 0;
        display: flex;
        gap: 10px;
        align-items: baseline;
        background: var(--surface);
        border: 1px solid var(--grid);
        border-radius: 8px;
        padding: 6px 12px;
        font-size: 13px;
        color: var(--ink-2);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
      }
      .tooltip strong {
        color: var(--ink);
        font-size: 16px;
      }
    `,
  ],
})
export class HeatmapComponent {
  private statsSig = signal<KanaStat[]>([]);

  @Input({ required: true }) set stats(value: KanaStat[]) {
    this.statsSig.set(value);
  }

  readonly hover = signal<Cell | null>(null);
  readonly ramp = RAMP;

  readonly cells = computed<Cell[][]>(() => {
    const byKana = new Map(this.statsSig().map((s) => [s.kana, s]));
    return GRID.map((row) =>
      row.map((kana) => this.toCell(kana, kana ? (byKana.get(kana) ?? null) : null)),
    );
  });

  /** Digraphs, extended kana, ッ and ー — everything outside the base grid. */
  readonly combos = computed<Cell[]>(() =>
    this.statsSig()
      .filter((s) => !GRID_KANA.has(s.kana))
      .sort((a, b) => b.attempts - a.attempts)
      .map((s) => this.toCell(s.kana, s)),
  );

  pct(v: number): string {
    return `${Math.round(v * 100)} %`;
  }

  private toCell(kana: string | null, stat: KanaStat | null): Cell {
    if (!kana || !stat) {
      return { kana, stat: null, bg: 'transparent', fg: 'var(--muted)' };
    }
    const step = rampStep(stat.ewma);
    return { kana, stat, bg: step.bg, fg: step.fg };
  }
}
