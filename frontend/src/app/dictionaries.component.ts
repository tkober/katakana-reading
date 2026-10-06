import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ApiService } from './api.service';
import { DictionaryInfo, WordRow } from './models';
import { LEVEL_COLORS, levelColor } from './ramp';

const PAGE_SIZE = 50;

@Component({
  selector: 'app-dictionaries',
  imports: [DecimalPipe, FormsModule],
  template: `
    @if (dicts(); as list) {
      <section class="dicts">
        <div class="cards">
          @for (d of list; track d.source) {
            <div class="card">
              <div class="card-head">
                <span class="card-name">{{ d.source }}</span>
                <span class="chip" [class.uploaded]="d.origin === 'upload'">{{
                  d.origin === 'upload' ? 'uploaded' : 'built-in'
                }}</span>
                <span class="card-total">{{ d.total }} words</span>
              </div>

              <div class="stack" [title]="levelTooltip(d)">
                @for (lv of d.levels; track lv.level) {
                  @if (lv.count > 0) {
                    <span
                      class="seg"
                      [style.flex-grow]="lv.count"
                      [style.background]="color(lv.level)"
                    ></span>
                  }
                }
              </div>
              <div class="level-table">
                @for (lv of d.levels; track lv.level) {
                  <div class="level-col" [class.zero]="lv.count === 0">
                    <span class="level-name">L{{ lv.level }}</span>
                    <span class="level-count">{{ lv.count }}</span>
                  </div>
                }
              </div>

              <dl class="facts">
                <div>
                  <dt>Word length</dt>
                  <dd>
                    Ø {{ d.avg_kana | number: '1.1-1' }} kana
                    <span class="muted">({{ d.min_kana }}–{{ d.max_kana }})</span>
                  </dd>
                </div>
                <div>
                  <dt>Rating span</dt>
                  <dd>{{ d.rating_min }} – {{ d.rating_max }}</dd>
                </div>
                <div>
                  <dt>Practiced</dt>
                  <dd>
                    {{ d.seen }}/{{ d.total }}
                    <span class="muted">({{ (d.seen / d.total) * 100 | number: '1.0-0' }} %)</span>
                  </dd>
                </div>
                <div>
                  <dt>Success</dt>
                  <dd>
                    @if (d.success !== null) {
                      {{ d.success * 100 | number: '1.0-0' }} %
                      <span class="muted">({{ d.correct }}/{{ d.served }})</span>
                    } @else {
                      <span class="muted">–</span>
                    }
                  </dd>
                </div>
              </dl>

              <div class="card-actions">
                <a class="link" [href]="exportUrl(d.source)" download>Export JSON</a>
                @if (d.origin === 'upload') {
                  @if (pendingDelete() === d.source) {
                    <button class="link" (click)="pendingDelete.set(null)">Cancel</button>
                    <button class="link danger" (click)="remove(d.source)">
                      Really delete
                    </button>
                  } @else {
                    <button class="link danger" (click)="pendingDelete.set(d.source)">
                      Delete
                    </button>
                  }
                }
              </div>
            </div>
          }
        </div>

        <div class="legend">
          <span>easier</span>
          @for (c of levelColors; track $index) {
            <span class="swatch" [style.background]="c"></span>
          }
          <span>harder</span>
          <span class="legend-note">bar = share of levels 1–5 in that file</span>
        </div>

        <div class="panel">
          <h2>Add a dictionary</h2>
          <p class="panel-note">
            Upload a JSON word list to practice your own vocabulary. It is stored
            in the database — not in the app image — so it survives updates and
            stays off GitHub. Uploading the same name again replaces that
            dictionary.
          </p>
          <div class="upload-row">
            <input
              #picker
              type="file"
              accept=".json,application/json"
              hidden
              (change)="onFile($event)"
            />
            <button class="btn-outline" (click)="picker.click()">Choose file…</button>
            <span class="file-name" [class.muted]="!fileName()">
              {{ fileName() || 'no file selected' }}
            </span>
            <input
              class="name-input"
              type="text"
              placeholder="dictionary name"
              [(ngModel)]="name"
              autocomplete="off"
            />
            <button
              class="btn-primary"
              [disabled]="!entries() || !name.trim() || busy()"
              (click)="upload()"
            >
              Upload
            </button>
            <a class="link" href="/api/dictionaries/template" download>
              Download template
            </a>
          </div>
          @if (uploadError()) {
            <p class="warn">{{ uploadError() }}</p>
          }
          @if (uploadNote()) {
            <p class="success">{{ uploadNote() }}</p>
          }
        </div>

        <div class="panel">
          <h2>Browse words</h2>
          <div class="filters">
            <select [(ngModel)]="source" (ngModelChange)="reload()">
              <option value="">All dictionaries</option>
              @for (d of list; track d.source) {
                <option [value]="d.source">{{ d.source }}</option>
              }
            </select>
            <select [(ngModel)]="level" (ngModelChange)="reload()">
              <option value="">All levels</option>
              @for (lv of [1, 2, 3, 4, 5]; track lv) {
                <option [value]="lv">Level {{ lv }}</option>
              }
            </select>
            <select [(ngModel)]="sort" (ngModelChange)="reload()">
              <option value="level">Sort: level</option>
              <option value="rating">Sort: rating</option>
              <option value="served">Sort: most served</option>
              <option value="alpha">Sort: katakana</option>
            </select>
            <input
              type="search"
              placeholder="Search katakana, romaji or meaning…"
              [(ngModel)]="query"
              (ngModelChange)="onSearch()"
            />
          </div>

          @if (words(); as w) {
            <p class="result-note">
              {{ w.total }} matches
              @if (w.total > w.words.length) {
                · showing {{ offset() + 1 }}–{{ offset() + w.words.length }}
              }
            </p>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Word</th>
                    <th>Romaji</th>
                    <th>Meaning</th>
                    <th>Lv</th>
                    <th>Dict</th>
                    <th>Rating</th>
                    <th>Served</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of w.words; track row.katakana) {
                    <tr>
                      <td class="kana-font word">{{ row.katakana }}</td>
                      <td>{{ row.romaji }}</td>
                      <td class="meaning">{{ row.meaning }}</td>
                      <td>
                        <span class="lv-dot" [style.background]="color(row.level)"></span>
                        {{ row.level }}
                      </td>
                      <td class="muted">{{ row.source }}</td>
                      <td>{{ row.rating }}</td>
                      <td>
                        @if (row.times_served > 0) {
                          {{ row.times_correct }}/{{ row.times_served }}
                        } @else {
                          <span class="muted">–</span>
                        }
                      </td>
                    </tr>
                  }
                  @if (w.words.length === 0) {
                    <tr>
                      <td colspan="7" class="muted empty">No words match these filters.</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            @if (w.total > pageSize) {
              <div class="pager">
                <button [disabled]="offset() === 0" (click)="page(-1)">Previous</button>
                <span class="muted"
                  >Page {{ offset() / pageSize + 1 }} of
                  {{ Math.ceil(w.total / pageSize) }}</span
                >
                <button
                  [disabled]="offset() + pageSize >= w.total"
                  (click)="page(1)"
                >
                  Next
                </button>
              </div>
            }
          } @else {
            <p class="muted">Loading words…</p>
          }
        </div>
      </section>
    } @else {
      <p class="loading">Loading dictionaries…</p>
    }
  `,
  styles: [
    `
      .dicts {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 12px;
      }
      .card {
        background: var(--surface);
        border: 1px solid var(--grid);
        border-radius: 12px;
        padding: 14px 16px;
      }
      .card-head {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 8px;
        margin-bottom: 10px;
      }
      .card-name {
        font-weight: 650;
        font-size: 16px;
      }
      .card-total {
        color: var(--muted);
        font-size: 12px;
        font-variant-numeric: tabular-nums;
      }
      /* Origin badge: where this dictionary came from. The uploaded ones are
         the only ones the delete/replace actions apply to. */
      .chip {
        margin-right: auto;
        padding: 1px 7px;
        border-radius: 999px;
        border: 1px solid var(--grid);
        color: var(--muted);
        font-size: 11px;
        white-space: nowrap;
      }
      .chip.uploaded {
        border-color: var(--accent);
        color: var(--ink-2);
      }
      .card-actions {
        display: flex;
        gap: 12px;
        margin-top: 12px;
        padding-top: 10px;
        border-top: 1px solid var(--grid);
      }
      .link {
        background: none;
        border: none;
        padding: 0;
        font: inherit;
        font-size: 13px;
        color: var(--ink-2);
        text-decoration: underline;
        text-underline-offset: 2px;
        cursor: pointer;
      }
      .link.danger {
        color: var(--critical);
      }
      .stack {
        display: flex;
        gap: 2px;
        height: 12px;
        border-radius: 3px;
        overflow: hidden;
      }
      .seg {
        display: block;
        min-width: 3px;
      }
      /* Two rows in five fixed columns: the vertical pairing groups a level
         with its count, so the eye never has to find the boundaries. */
      .level-table {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 2px;
        margin-top: 7px;
        text-align: center;
      }
      .level-col {
        display: flex;
        flex-direction: column;
        line-height: 1.25;
      }
      .level-name {
        font-size: 10px;
        color: var(--muted);
      }
      .level-count {
        font-size: 14px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .level-col.zero .level-count {
        color: var(--muted);
        font-weight: 400;
      }
      .facts {
        margin: 12px 0 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .facts > div {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        font-size: 13px;
      }
      .facts dt {
        color: var(--ink-2);
      }
      .facts dd {
        margin: 0;
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .muted {
        color: var(--muted);
      }
      .legend {
        display: flex;
        align-items: center;
        gap: 4px;
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
      .panel {
        background: var(--surface);
        border: 1px solid var(--grid);
        border-radius: 12px;
        padding: 18px 20px;
      }
      .panel h2 {
        font-size: 16px;
        margin: 0 0 14px;
      }
      .panel-note {
        font-size: 13px;
        color: var(--ink-2);
        margin: -6px 0 14px;
        max-width: 70ch;
      }
      .upload-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
      }
      .file-name {
        font-size: 13px;
        max-width: 22ch;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .name-input {
        font: inherit;
        font-size: 13px;
        padding: 7px 10px;
        border-radius: 8px;
        border: 1px solid var(--grid);
        background: var(--page);
        color: var(--ink);
        width: 170px;
      }
      .btn-outline,
      .btn-primary {
        font: inherit;
        font-size: 13px;
        padding: 8px 14px;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
      }
      .btn-outline {
        background: transparent;
        border: 1px solid var(--grid);
        color: var(--ink);
      }
      .btn-primary {
        background: var(--accent);
        border: none;
        color: var(--accent-ink);
      }
      .btn-primary:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      .warn {
        color: var(--critical);
        font-size: 13px;
        margin: 12px 0 0;
      }
      .success {
        color: var(--good-text);
        font-size: 13px;
        font-weight: 600;
        margin: 12px 0 0;
      }
      .filters {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 12px;
      }
      .filters select,
      .filters input {
        font: inherit;
        font-size: 13px;
        padding: 7px 10px;
        border-radius: 8px;
        border: 1px solid var(--grid);
        background: var(--page);
        color: var(--ink);
      }
      .filters input {
        flex: 1;
        min-width: 180px;
      }
      .result-note {
        font-size: 12px;
        color: var(--muted);
        margin: 0 0 8px;
      }
      .table-wrap {
        overflow-x: auto;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
      }
      th {
        text-align: left;
        font-weight: 600;
        color: var(--ink-2);
        font-size: 12px;
        padding: 6px 10px;
        border-bottom: 1px solid var(--grid);
        white-space: nowrap;
      }
      td {
        padding: 6px 10px;
        border-bottom: 1px solid var(--grid);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      td.word {
        font-size: 16px;
      }
      td.meaning {
        white-space: normal;
        min-width: 160px;
        color: var(--ink-2);
      }
      td.empty {
        text-align: center;
        padding: 20px;
      }
      .lv-dot {
        display: inline-block;
        width: 9px;
        height: 9px;
        border-radius: 2px;
        margin-right: 5px;
        vertical-align: baseline;
      }
      .pager {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-top: 12px;
        font-size: 13px;
      }
      .pager button {
        padding: 6px 14px;
        border-radius: 8px;
        border: 1px solid var(--grid);
        background: transparent;
        color: var(--ink);
        cursor: pointer;
      }
      .pager button:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .loading {
        color: var(--muted);
        text-align: center;
      }
    `,
  ],
})
export class DictionariesComponent implements OnInit {
  private api = inject(ApiService);

  readonly dicts = signal<DictionaryInfo[] | null>(null);
  readonly words = signal<{ total: number; words: WordRow[] } | null>(null);
  readonly offset = signal(0);
  readonly levelColors = LEVEL_COLORS;
  readonly pageSize = PAGE_SIZE;
  readonly Math = Math;

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

  ngOnInit(): void {
    this.loadDictionaries();
    this.fetch();
  }

  exportUrl(source: string): string {
    return `/api/dictionaries/${encodeURIComponent(source)}/export`;
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

  private loadDictionaries(): void {
    this.api.dictionaries().subscribe((r) => this.dicts.set(r.dictionaries));
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

  color(level: number): string {
    return levelColor(level);
  }

  levelTooltip(d: DictionaryInfo): string {
    return d.levels.map((l) => `L${l.level}: ${l.count}`).join(' · ');
  }

  reload(): void {
    this.offset.set(0);
    this.fetch();
  }

  /** Debounced so typing doesn't fire a request per keystroke. */
  onSearch(): void {
    if (this.searchTimer !== null) {
      clearTimeout(this.searchTimer);
    }
    this.searchTimer = setTimeout(() => this.reload(), 250);
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
