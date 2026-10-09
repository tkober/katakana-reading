import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  SumiDataTable,
  SumiSegmentedBar,
  SumiTableCellTemplate,
  type SumiSegment,
  type SumiTableColumn,
  type SumiTableRow,
} from 'sumi-ui/charts';
import { SumiBadge, SumiCard, SumiEmptyState, SumiErrorState, SumiPage } from 'sumi-ui/layout';
import { SumiButtonDirective, SumiInputDirective, SumiSelectDirective } from 'sumi-ui/forms';

import { ApiService } from './api.service';
import { DictionaryInfo, WordRow } from './models';

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 250;

const LEVEL_OPTIONS = [
  { value: '', label: 'All levels' },
  { value: 1, label: 'Level 1' },
  { value: 2, label: 'Level 2' },
  { value: 3, label: 'Level 3' },
  { value: 4, label: 'Level 4' },
  { value: 5, label: 'Level 5' },
];

const SORTS = [
  { value: 'level', label: 'Sort: level' },
  { value: 'rating', label: 'Sort: rating' },
  { value: 'served', label: 'Sort: most served' },
  { value: 'alpha', label: 'Sort: katakana' },
];

const WORD_COLUMNS: SumiTableColumn[] = [
  { key: 'word', label: 'Word' },
  { key: 'romaji', label: 'Romaji' },
  { key: 'meaning', label: 'Meaning' },
  { key: 'level', label: 'Level', align: 'end' },
  { key: 'dict', label: 'Dict' },
  { key: 'rating', label: 'Rating', align: 'end' },
  { key: 'served', label: 'Served', align: 'end' },
];

@Component({
  selector: 'app-dictionaries',
  imports: [
    DecimalPipe,
    FormsModule,
    SumiPage,
    SumiCard,
    SumiBadge,
    SumiEmptyState,
    SumiErrorState,
    SumiDataTable,
    SumiTableCellTemplate,
    SumiSegmentedBar,
    SumiButtonDirective,
    SumiInputDirective,
    SumiSelectDirective,
  ],
  templateUrl: './dictionaries.component.html',
  styleUrl: './dictionaries.component.css',
})
export class DictionariesComponent {
  private api = inject(ApiService);

  readonly levelOptions = LEVEL_OPTIONS;
  readonly sorts = SORTS;
  readonly pageSize = PAGE_SIZE;
  readonly wordColumns = WORD_COLUMNS;

  readonly dicts = signal<DictionaryInfo[] | null>(null);
  readonly failed = signal(false);
  readonly words = signal<{ total: number; words: WordRow[] } | null>(null);
  readonly offset = signal(0);

  readonly wordRows = computed<SumiTableRow[]>(() =>
    (this.words()?.words ?? []).map((w) => ({
      word: w.katakana,
      romaji: w.romaji,
      meaning: w.meaning,
      level: w.level,
      dict: w.source,
      rating: w.rating,
      served: w.times_served > 0 ? `${w.times_correct}/${w.times_served}` : '–',
    })),
  );

  readonly pageCount = computed(() =>
    Math.max(1, Math.ceil((this.words()?.total ?? 0) / PAGE_SIZE)),
  );
  readonly pageNumber = computed(() => Math.floor(this.offset() / PAGE_SIZE) + 1);
  readonly hasNext = computed(() => this.pageNumber() < this.pageCount());

  // Upload state: the parsed file contents plus the feedback line below the row.
  readonly fileName = signal('');
  readonly entries = signal<unknown | null>(null);
  readonly busy = signal(false);
  readonly uploadError = signal('');
  readonly uploadNote = signal('');
  readonly pendingDelete = signal<string | null>(null);

  source = '';
  level: number | '' = '';
  sort = 'level';
  query = '';
  name = '';

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.loadDictionaries();
    this.fetch();
  }

  exportUrl(source: string): string {
    return `/api/dictionaries/${encodeURIComponent(source)}/export`;
  }

  /** Per-dictionary level distribution for `sumi-segmented-bar` — zero
   *  counts are dropped by the bar itself, colours come from its own
   *  accent ramp (no app-side palette any more, see CLAUDE.md). */
  levelSegments(d: DictionaryInfo): SumiSegment[] {
    return d.levels.map((lv) => ({ label: `L${lv.level}`, value: lv.count }));
  }

  /** Read the picked file and pre-fill the name from its stem. */
  async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // so picking the same file again fires another change
    if (!file) {
      return;
    }
    this.uploadError.set('');
    this.uploadNote.set('');
    this.fileName.set(file.name);
    this.name = file.name.replace(/\.json$/i, '');
    try {
      this.entries.set(JSON.parse(await file.text()));
    } catch {
      this.entries.set(null);
      this.uploadError.set(`${file.name} is not valid JSON.`);
    }
  }

  upload(): void {
    const entries = this.entries();
    if (entries === null) {
      return;
    }
    this.busy.set(true);
    this.uploadError.set('');
    this.uploadNote.set('');
    this.api.uploadDictionary(this.name.trim(), entries).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.entries.set(null);
        this.fileName.set('');
        this.name = '';
        this.uploadNote.set(
          `${r.replaced ? 'Replaced' : 'Added'} "${r.source}" — ${r.entries} entries, ` +
            `${r.words} words in the pool.`,
        );
        this.loadDictionaries();
        this.reload();
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.uploadError.set(this.errorText(err));
      },
    });
  }

  remove(source: string): void {
    this.pendingDelete.set(null);
    this.api.deleteDictionary(source).subscribe({
      next: (r) => {
        this.uploadNote.set(
          r.kept > 0
            ? `Deleted "${r.source}" — ${r.removed} words removed, ${r.kept} kept ` +
                'because they carry answer history.'
            : `Deleted "${r.source}" — ${r.removed} words removed.`,
        );
        this.loadDictionaries();
        this.reload();
      },
      error: (err: HttpErrorResponse) => this.uploadError.set(this.errorText(err)),
    });
  }

  retry(): void {
    this.failed.set(false);
    this.loadDictionaries();
  }

  private loadDictionaries(): void {
    this.api.dictionaries().subscribe({
      next: (r) => {
        this.failed.set(false);
        this.dicts.set(r.dictionaries);
      },
      error: () => this.failed.set(true),
    });
  }

  /** The backend reports per-entry problems; surface the first few verbatim. */
  private errorText(err: HttpErrorResponse): string {
    const detail = err.error?.detail;
    if (typeof detail === 'string') {
      return detail;
    }
    if (detail?.errors?.length) {
      const shown = detail.errors.slice(0, 3).join(' · ');
      const rest = detail.errors.length - 3;
      return `${detail.message}: ${shown}${rest > 0 ? ` (+${rest} more)` : ''}`;
    }
    return 'Upload failed — is the backend running?';
  }

  reload(): void {
    this.offset.set(0);
    this.fetch();
  }

  /** Debounced so typing doesn't fire a request per keystroke. */
  onSearch(value: string): void {
    this.query = value;
    if (this.searchTimer !== null) {
      clearTimeout(this.searchTimer);
    }
    this.searchTimer = setTimeout(() => this.reload(), SEARCH_DEBOUNCE_MS);
  }

  page(direction: number): void {
    this.offset.update((o) => Math.max(0, o + direction * PAGE_SIZE));
    this.fetch();
  }

  private fetch(): void {
    this.api
      .words({
        source: this.source || undefined,
        level: this.level === '' ? undefined : Number(this.level),
        q: this.query.trim() || undefined,
        sort: this.sort,
        limit: PAGE_SIZE,
        offset: this.offset(),
      })
      .subscribe((r) => this.words.set({ total: r.total, words: r.words }));
  }
}
