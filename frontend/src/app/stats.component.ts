import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import {
  SUMI_CHARTS,
  type SumiMatrixCellSelection,
  type SumiSegment,
  type SumiTableColumn,
  type SumiTableRow,
} from 'sumi-ui/charts';
import { SumiCard, SumiEmptyState, SumiErrorState, SumiPage } from 'sumi-ui/layout';
import { SumiButtonDirective } from 'sumi-ui/forms';

import { ApiService } from './api.service';
import { CoverageRow, KanaStat, Stats } from './models';
import { Matrix, MatrixId, basicMatrix, combinationsMatrix, extendedMatrix } from './stats-math';

/** Compact percent for library charts (matrix cells, nothing else) — no
 *  space before `%`, matches the pilot's own `toPercent` convention since
 *  these render inside tight cells. */
function toPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Percent for the app's own KPI/table text — space before `%`, the
 *  convention this page already used before the Sumi migration. */
function percent(value: number): string {
  return `${Math.round(value * 100)} %`;
}

/** The cell currently selected across all three matrices — shared so only
 *  one ever shows a selection ring, and the readout below them can name
 *  the cell unambiguously (pattern from jp-conjugation's miss-rate card). */
interface Selection {
  matrix: MatrixId;
  row: string;
  column: string;
  kana: string;
  value: number | null;
  detail?: string;
}

const WEAKEST_COLUMNS: SumiTableColumn[] = [
  { key: 'kana', label: 'Kana' },
  { key: 'confidence', label: 'Confidence', align: 'end' },
  { key: 'correct', label: 'Correct', align: 'end' },
];

const COVERAGE_COLUMNS: SumiTableColumn[] = [
  { key: 'group', label: 'Group' },
  { key: 'coverage', label: 'Coverage' },
  { key: 'success', label: 'Success', align: 'end' },
];

const RECENT_COLUMNS: SumiTableColumn[] = [
  { key: 'word', label: 'Word' },
  { key: 'romaji', label: 'Romaji' },
  { key: 'answer', label: 'Answer', toneKey: 'answerTone' },
  { key: 'kana', label: 'Kana' },
  { key: 'time', label: 'Time', align: 'end' },
  { key: 'elo', label: 'Elo', align: 'end', toneKey: 'eloTone' },
  { key: 'when', label: 'When' },
];

@Component({
  selector: 'app-stats',
  imports: [
    SumiCard,
    SumiEmptyState,
    SumiErrorState,
    SumiButtonDirective,
    SumiPage,
    ...SUMI_CHARTS,
  ],
  providers: [DatePipe],
  templateUrl: './stats.component.html',
  styleUrl: './stats.component.css',
})
export class StatsComponent {
  private readonly api = inject(ApiService);
  private readonly datePipe = inject(DatePipe);

  readonly stats = signal<Stats | null>(null);
  readonly selected = signal<Selection | null>(null);
  /** Set when the initial `/api/stats` load fails — shows `sumi-error-state`
   *  instead of the cards until retried. */
  readonly failed = signal(false);

  protected readonly toPercent = toPercent;
  protected readonly weakestColumns = WEAKEST_COLUMNS;
  protected readonly coverageColumns = COVERAGE_COLUMNS;
  protected readonly recentColumns = RECENT_COLUMNS;

  readonly levelHint = computed(() => {
    const s = this.stats();
    if (!s) {
      return undefined;
    }
    if (s.level >= s.max_level) {
      return 'max level';
    }
    return `${Math.round(s.level_progress * 100)} % to level ${s.level + 1}`;
  });

  readonly eloValue = computed(() => Math.round(this.stats()?.elo ?? 0));

  readonly eloHint = computed(() => {
    const s = this.stats();
    return s && s.elo_history.length > 0 ? `last ${s.elo_history.length} answers` : undefined;
  });

  /** Last minus first point of the Elo history, rounded to 1 decimal;
   *  `null` below 2 points (the sparkline itself does not render then). */
  readonly eloDelta = computed(() => {
    const history = this.stats()?.elo_history ?? [];
    if (history.length < 2) {
      return null;
    }
    return Math.round((history[history.length - 1] - history[0]) * 10) / 10;
  });

  readonly accuracyValue = computed(() => {
    const accuracy = this.stats()?.accuracy ?? null;
    return accuracy !== null ? percent(accuracy) : '–';
  });

  readonly accuracyHint = computed(() => {
    const s = this.stats();
    return s ? `${s.correct_attempts}/${s.total_attempts} words` : undefined;
  });

  readonly speedValue = computed(() => {
    const s = this.stats();
    return s && s.total_attempts > 0 ? `${(s.avg_time_per_kana_ms / 1000).toFixed(1)} s` : '–';
  });

  readonly speedHint = computed(() => {
    const s = this.stats();
    return s ? `per kana · Ø ${(s.avg_time_ms / 1000).toFixed(1)} s per word` : undefined;
  });

  readonly streakHint = computed(() => `best: ${this.stats()?.best_streak ?? 0} in a row`);

  readonly weakest = computed<KanaStat[]>(() => {
    const s = this.stats();
    if (!s) {
      return [];
    }
    return s.kana
      .filter((k) => k.attempts >= 3 && k.ewma < 0.75)
      .sort((a, b) => a.ewma - b.ewma)
      .slice(0, 6);
  });

  readonly weakestRows = computed<SumiTableRow[]>(() =>
    this.weakest().map((k) => ({
      kana: k.kana,
      confidence: percent(k.ewma),
      correct: `${k.correct}/${k.attempts}`,
    })),
  );

  readonly levelCoverageRows = computed<SumiTableRow[]>(() =>
    (this.stats()?.coverage.levels ?? []).map((row) => this.coverageRow(`Level ${row.key}`, row)),
  );

  readonly sourceCoverageRows = computed<SumiTableRow[]>(() =>
    (this.stats()?.coverage.sources ?? []).map((row) => this.coverageRow(row.key, row)),
  );

  readonly matrices = computed<Matrix[]>(() => {
    const s = this.stats();
    if (!s) {
      return [];
    }
    const byKana = new Map(s.kana.map((k) => [k.kana, k]));
    return [basicMatrix(byKana), combinationsMatrix(byKana), extendedMatrix(s.kana, byKana)];
  });

  readonly recentRows = computed<SumiTableRow[]>(() =>
    (this.stats()?.recent ?? []).map((a) => ({
      word: a.katakana,
      romaji: a.romaji,
      answer: a.answer || '–',
      answerTone: a.correct ? 'correct' : 'wrong',
      kana: `${a.kana_correct}/${a.kana_total}`,
      time: `${(a.time_ms / 1000).toFixed(1)} s`,
      elo: `${a.elo_delta >= 0 ? '+' : ''}${a.elo_delta.toFixed(1)}`,
      eloTone: a.elo_delta > 0 ? 'correct' : a.elo_delta < 0 ? 'wrong' : undefined,
      when: this.datePipe.transform(a.created_at, 'MMM d, HH:mm') ?? a.created_at,
    })),
  );

  constructor() {
    this.load();
  }

  retry(): void {
    this.failed.set(false);
    this.load();
  }

  private load(): void {
    this.api.stats().subscribe({
      next: (s) => {
        this.failed.set(false);
        this.stats.set(s);
      },
      error: () => this.failed.set(true),
    });
  }

  protected selectedCellFor(matrix: MatrixId): { row: string; column: string } | null {
    const sel = this.selected();
    if (!sel || sel.matrix !== matrix) {
      return null;
    }
    return { row: sel.row, column: sel.column };
  }

  protected onSelect(matrix: Matrix, selection: SumiMatrixCellSelection): void {
    this.selected.set({
      matrix: matrix.id,
      row: selection.row,
      column: selection.column,
      kana: matrix.kanaOf(selection.row, selection.column),
      value: selection.value,
      detail: selection.detail,
    });
  }

  private coverageRow(label: string, row: CoverageRow): SumiTableRow {
    const segments: SumiSegment[] = [
      { label: 'Seen', value: row.seen, color: 'var(--sumi-accent)' },
      { label: 'Not seen yet', value: row.total - row.seen, color: 'var(--sumi-sunken)' },
    ];
    return {
      group: label,
      ariaLabel: `${label}: ${row.seen} of ${row.total} words seen`,
      segments,
      seenLabel: `${row.seen}/${row.total} seen`,
      success: row.success !== null ? percent(row.success) : '–',
    };
  }
}
