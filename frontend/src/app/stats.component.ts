import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';

import { ApiService } from './api.service';
import { HeatmapComponent } from './heatmap.component';
import { KanaStat, Stats } from './models';

@Component({
  selector: 'app-stats',
  imports: [DecimalPipe, DatePipe, HeatmapComponent],
  template: `
    @if (stats(); as s) {
      <section class="stats">
        <div class="tiles">
          <div class="tile">
            <div class="tile-label">Level</div>
            <div class="tile-value">{{ s.level }}</div>
            <div class="meter">
              <div class="meter-fill" [style.width.%]="s.level_progress * 100"></div>
            </div>
            <div class="tile-sub">
              {{ s.level_progress * 100 | number: '1.0-0' }} % to level
              {{ s.level < s.max_level ? s.level + 1 : s.max_level }}
            </div>
          </div>
          <div class="tile">
            <div class="tile-label">Elo</div>
            <div class="tile-value">{{ s.elo | number: '1.0-0' }}</div>
            @if (sparkPoints(); as pts) {
              <svg class="spark" viewBox="0 0 240 56" preserveAspectRatio="none">
                <polyline
                  [attr.points]="pts.line"
                  fill="none"
                  stroke="var(--series-1)"
                  stroke-width="2"
                  stroke-linejoin="round"
                  stroke-linecap="round"
                />
                <circle
                  [attr.cx]="pts.endX"
                  [attr.cy]="pts.endY"
                  r="4"
                  fill="var(--series-1)"
                  stroke="var(--surface)"
                  stroke-width="2"
                />
              </svg>
              <div class="tile-sub">last {{ s.elo_history.length }} answers</div>
            }
          </div>
          <div class="tile">
            <div class="tile-label">Accuracy</div>
            <div class="tile-value">
              {{ s.accuracy !== null ? (s.accuracy * 100 | number: '1.0-0') + ' %' : '–' }}
            </div>
            <div class="tile-sub">{{ s.correct_attempts }}/{{ s.total_attempts }} words</div>
          </div>
          <div class="tile">
            <div class="tile-label">Reading speed</div>
            <div class="tile-value">
              {{ s.total_attempts > 0 ? (s.avg_time_per_kana_ms / 1000 | number: '1.1-1') + ' s' : '–' }}
            </div>
            <div class="tile-sub">per kana · avg {{ s.avg_time_ms / 1000 | number: '1.1-1' }} s per word</div>
          </div>
          <div class="tile">
            <div class="tile-label">Streak</div>
            <div class="tile-value">{{ s.current_streak }}</div>
            <div class="tile-sub">best: {{ s.best_streak }} in a row</div>
          </div>
        </div>

        @if (weakest().length > 0) {
          <div class="panel">
            <h2>Your weakest kana</h2>
            <div class="weak-list kana-font">
              @for (k of weakest(); track k.kana) {
                <span class="weak-chip">
                  {{ k.kana }}
                  <small>{{ k.ewma * 100 | number: '1.0-0' }} %</small>
                </span>
              }
            </div>
            <p class="panel-note">
              Practice now favors words containing these kana.
            </p>
          </div>
        }

        <div class="panel">
          <h2>Kana confidence</h2>
          <app-heatmap [stats]="s.kana" />
        </div>

        @if (s.recent.length > 0) {
          <div class="panel">
            <h2>Recent answers</h2>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Word</th>
                    <th>Romaji</th>
                    <th>Answer</th>
                    <th>Kana</th>
                    <th>Time</th>
                    <th>Elo</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  @for (a of s.recent; track $index) {
                    <tr>
                      <td class="kana-font">
                        <span class="dot" [class.dot-ok]="a.correct" [class.dot-bad]="!a.correct"></span>
                        {{ a.katakana }}
                      </td>
                      <td>{{ a.romaji }}</td>
                      <td [class.bad-text]="!a.correct">{{ a.answer || '–' }}</td>
                      <td>{{ a.kana_correct }}/{{ a.kana_total }}</td>
                      <td>{{ a.time_ms / 1000 | number: '1.1-1' }} s</td>
                      <td [class.good-text]="a.elo_delta >= 0" [class.bad-text]="a.elo_delta < 0">
                        {{ a.elo_delta >= 0 ? '+' : '' }}{{ a.elo_delta | number: '1.1-1' }}
                      </td>
                      <td class="muted">{{ toIso(a.created_at) | date: 'MMM d, HH:mm' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        }
      </section>
    } @else {
      <p class="loading">Loading stats…</p>
    }
  `,
  styles: [
    `
      .stats {
        display: flex;
        flex-direction: column;
        gap: 20px;
      }
      .tiles {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 12px;
      }
      .tile {
        background: var(--surface);
        border: 1px solid var(--grid);
        border-radius: 12px;
        padding: 14px 16px;
      }
      .tile-label {
        font-size: 13px;
        color: var(--ink-2);
      }
      .tile-value {
        font-size: 30px;
        font-weight: 600;
        margin: 2px 0;
      }
      .tile-sub {
        font-size: 12px;
        color: var(--muted);
      }
      .meter {
        height: 6px;
        border-radius: 3px;
        background: var(--series-1-track);
        margin: 8px 0 6px;
        overflow: hidden;
      }
      .meter-fill {
        height: 100%;
        background: var(--series-1);
        border-radius: 3px;
      }
      .spark {
        width: 100%;
        height: 56px;
        margin: 4px 0 2px;
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
        color: var(--muted);
        margin: 12px 0 0;
      }
      .weak-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .weak-chip {
        display: inline-flex;
        align-items: baseline;
        gap: 8px;
        border: 1px solid var(--grid);
        border-radius: 10px;
        padding: 6px 12px;
        font-size: 20px;
        font-weight: 600;
      }
      .weak-chip small {
        font-size: 12px;
        color: var(--ink-2);
        font-weight: 400;
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
      }
      td {
        padding: 7px 10px;
        border-bottom: 1px solid var(--grid);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .dot {
        display: inline-block;
        width: 9px;
        height: 9px;
        border-radius: 50%;
        margin-right: 6px;
      }
      .dot-ok {
        background: var(--good);
      }
      .dot-bad {
        background: var(--critical);
      }
      .good-text {
        color: var(--good-text);
      }
      .bad-text {
        color: var(--critical);
      }
      .muted {
        color: var(--muted);
      }
      .loading {
        color: var(--muted);
        text-align: center;
      }
    `,
  ],
})
export class StatsComponent implements OnInit {
  private api = inject(ApiService);

  readonly stats = signal<Stats | null>(null);

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

  readonly sparkPoints = computed(() => {
    const s = this.stats();
    if (!s || s.elo_history.length < 2) {
      return null;
    }
    const hist = s.elo_history;
    const min = Math.min(...hist);
    const max = Math.max(...hist);
    const span = Math.max(max - min, 10);
    const w = 240;
    const h = 56;
    const pad = 5;
    const pts = hist.map((v, i) => {
      const x = pad + (i / (hist.length - 1)) * (w - 2 * pad);
      const y = h - pad - ((v - min) / span) * (h - 2 * pad);
      return [x, y] as const;
    });
    const last = pts[pts.length - 1];
    return {
      line: pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '),
      endX: last[0].toFixed(1),
      endY: last[1].toFixed(1),
    };
  });

  ngOnInit(): void {
    this.api.stats().subscribe((s) => this.stats.set(s));
  }

  /** SQLite delivers UTC "YYYY-MM-DD HH:MM:SS"; Safari needs strict ISO. */
  toIso(sqliteUtc: string): string {
    return sqliteUtc.replace(' ', 'T') + 'Z';
  }
}
