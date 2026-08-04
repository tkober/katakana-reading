import { DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ApiService } from './api.service';
import { TimeBudget } from './models';

@Component({
  selector: 'app-settings',
  imports: [DecimalPipe, FormsModule],
  template: `
    <section class="settings">
      <div class="panel">
        <h2>Reading time budget</h2>
        <p>
          How long a word may take before it counts as slow. The clock covers
          reading <em>and</em> typing, so a touchscreen keyboard needs a bigger
          budget than a real one. Being slow never costs Elo — it only earns
          less than a fast answer.
        </p>

        @if (budget(); as b) {
          <div class="budget">
            <label class="field">
              <span class="field-label">Base per word</span>
              <span class="field-row">
                <input
                  type="range"
                  [min]="b.bounds.time_base_ms[0]"
                  [max]="5000"
                  step="100"
                  [ngModel]="baseMs()"
                  (ngModelChange)="baseMs.set(+$event)"
                />
                <output>{{ baseMs() / 1000 | number: '1.1-1' }} s</output>
              </span>
            </label>

            <label class="field">
              <span class="field-label">Per kana</span>
              <span class="field-row">
                <input
                  type="range"
                  [min]="b.bounds.time_per_kana_ms[0]"
                  [max]="2500"
                  step="50"
                  [ngModel]="perKanaMs()"
                  (ngModelChange)="perKanaMs.set(+$event)"
                />
                <output>{{ perKanaMs() / 1000 | number: '1.2-2' }} s</output>
              </span>
            </label>
          </div>

          <p class="formula">
            Target = {{ baseMs() / 1000 | number: '1.1-1' }} s +
            {{ perKanaMs() / 1000 | number: '1.2-2' }} s × kana
          </p>

          <div class="examples">
            @for (ex of preview(); track ex.kana) {
              <div class="example">
                <span class="ex-kana">{{ ex.kana }} kana</span>
                <span class="ex-time">{{ ex.ms / 1000 | number: '1.1-1' }} s</span>
                <span class="ex-word kana-font">{{ ex.sample }}</span>
              </div>
            }
          </div>

          <div class="row">
            @if (dirty()) {
              <button class="btn-accent" [disabled]="saving()" (click)="save()">
                {{ saving() ? 'Saving…' : 'Save' }}
              </button>
              <button class="btn-outline" (click)="revert()">Revert</button>
            } @else {
              <span class="saved-note">Saved</span>
            }
            @if (!atDefaults()) {
              <button class="btn-quiet" (click)="useDefaults()">
                Back to defaults
              </button>
            }
          </div>
          @if (budgetError()) {
            <p class="warn">{{ budgetError() }}</p>
          }
        } @else {
          <p class="muted">Loading…</p>
        }
      </div>

      <div class="panel danger">
        <h2>Reset progress</h2>
        <p>
          Deletes <strong>all</strong> historical data: Elo &amp; level, kana
          statistics, answer history and the calibrated word difficulties. The
          dictionary itself is kept.
        </p>

        @if (done()) {
          <p class="success">All data has been reset. Good luck on the fresh start!</p>
        } @else {
          @switch (step()) {
            @case (0) {
              <button class="btn-outline" (click)="step.set(1)">
                Reset progress…
              </button>
            }
            @case (1) {
              <p class="warn">
                Are you sure? This action <strong>cannot</strong> be undone.
              </p>
              <div class="row">
                <button class="btn-outline" (click)="cancel()">Cancel</button>
                <button class="btn-danger" (click)="step.set(2)">
                  Yes, I'm sure
                </button>
              </div>
            }
            @case (2) {
              <p class="warn">
                Final confirmation: type <code>RESET</code> into the field to
                delete everything for good.
              </p>
              <div class="row">
                <input
                  class="confirm-input"
                  type="text"
                  [(ngModel)]="confirmText"
                  placeholder="RESET"
                  autocomplete="off"
                />
                <button class="btn-outline" (click)="cancel()">Cancel</button>
                <button
                  class="btn-danger"
                  [disabled]="confirmText !== 'RESET' || busy()"
                  (click)="reset()"
                >
                  Delete permanently
                </button>
              </div>
            }
          }
        }
        @if (error()) {
          <p class="warn">{{ error() }}</p>
        }
      </div>

      <div class="panel">
        <h2>About this app</h2>
        <p>
          Adaptive katakana reading practice: word selection follows your Elo,
          regularly probes your limit and favors words containing kana you still
          struggle with. Hepburn and Kunrei romaji are both accepted
          (e.g. <code>shi</code>/<code>si</code>), long vowels as doubled vowels
          or <code>-</code>.
        </p>
      </div>
    </section>
  `,
  styles: [
    `
      .settings {
        display: flex;
        flex-direction: column;
        gap: 20px;
      }
      .panel {
        background: var(--surface);
        border: 1px solid var(--grid);
        border-radius: 12px;
        padding: 18px 20px;
      }
      .panel h2 {
        font-size: 16px;
        margin: 0 0 10px;
      }
      .panel p {
        font-size: 14px;
        color: var(--ink-2);
        margin: 0 0 14px;
      }
      .panel.danger {
        border-color: var(--critical);
      }
      .warn {
        color: var(--critical);
      }
      .success {
        color: var(--good-text);
        font-weight: 600;
      }
      .row {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
      }
      .btn-outline,
      .btn-danger,
      .btn-accent,
      .btn-quiet {
        padding: 9px 16px;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
      }
      .btn-accent {
        background: var(--accent);
        border: none;
        color: var(--accent-ink);
      }
      .btn-quiet {
        background: transparent;
        border: none;
        color: var(--ink-2);
        text-decoration: underline;
        padding-left: 4px;
      }
      .btn-accent:disabled,
      .btn-outline:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      .budget {
        display: flex;
        flex-direction: column;
        gap: 14px;
        margin-bottom: 6px;
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .field-label {
        font-size: 13px;
        color: var(--ink-2);
      }
      .field-row {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .field-row input[type='range'] {
        flex: 1;
        min-width: 0;
        accent-color: var(--accent);
      }
      .field-row output {
        font-variant-numeric: tabular-nums;
        font-weight: 600;
        min-width: 4.5ch;
        text-align: right;
      }
      .formula {
        font-size: 13px !important;
        color: var(--muted) !important;
        margin: 0 0 12px !important;
      }
      .examples {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
        gap: 8px;
        margin-bottom: 16px;
      }
      .example {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 8px 10px;
        border: 1px solid var(--grid);
        border-radius: 10px;
      }
      .ex-word {
        font-size: 13px;
        color: var(--muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .ex-kana {
        font-size: 11px;
        color: var(--muted);
      }
      .ex-time {
        font-size: 17px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .saved-note {
        font-size: 13px;
        color: var(--good-text);
        font-weight: 600;
      }
      .muted {
        color: var(--muted);
      }
      .btn-outline {
        background: transparent;
        border: 1px solid var(--grid);
        color: var(--ink);
      }
      .btn-danger {
        background: var(--critical);
        border: none;
        color: #fff;
      }
      .btn-danger:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      .confirm-input {
        padding: 9px 12px;
        border-radius: 8px;
        border: 1px solid var(--grid);
        background: var(--page);
        color: var(--ink);
        font: inherit;
        width: 130px;
        text-align: center;
        letter-spacing: 0.1em;
      }
      code {
        background: var(--page);
        border: 1px solid var(--grid);
        border-radius: 4px;
        padding: 1px 5px;
        font-size: 13px;
      }
    `,
  ],
})
export class SettingsComponent implements OnInit {
  private api = inject(ApiService);

  readonly step = signal(0);
  readonly busy = signal(false);
  readonly done = signal(false);
  readonly error = signal('');

  readonly budget = signal<TimeBudget | null>(null);
  readonly baseMs = signal(0);
  readonly perKanaMs = signal(0);
  readonly saving = signal(false);
  readonly budgetError = signal('');

  readonly dirty = computed(() => {
    const b = this.budget();
    return (
      !!b &&
      (b.time_base_ms !== this.baseMs() || b.time_per_kana_ms !== this.perKanaMs())
    );
  });

  readonly atDefaults = computed(() => {
    const b = this.budget();
    return (
      !!b &&
      b.defaults.time_base_ms === this.baseMs() &&
      b.defaults.time_per_kana_ms === this.perKanaMs()
    );
  });

  /** Real words, so the numbers mean something while dragging the slider. */
  private readonly samples = [
    { sample: 'バス', kana: 2 },
    { sample: 'イタリア', kana: 4 },
    { sample: 'ストリーミング', kana: 7 },
  ];

  readonly preview = computed(() =>
    this.samples.map((s) => ({
      ...s,
      ms: this.baseMs() + this.perKanaMs() * s.kana,
    })),
  );

  confirmText = '';

  ngOnInit(): void {
    this.loadBudget();
  }

  private loadBudget(): void {
    this.api.timeBudget().subscribe({
      next: (b) => this.applyBudget(b),
      error: () => this.budgetError.set('Could not load the time budget.'),
    });
  }

  private applyBudget(b: TimeBudget): void {
    this.budget.set(b);
    this.baseMs.set(b.time_base_ms);
    this.perKanaMs.set(b.time_per_kana_ms);
  }

  save(): void {
    this.saving.set(true);
    this.budgetError.set('');
    this.api.saveTimeBudget(this.baseMs(), this.perKanaMs()).subscribe({
      next: (b) => {
        this.saving.set(false);
        this.applyBudget(b);
      },
      error: () => {
        this.saving.set(false);
        this.budgetError.set('Saving failed — is the backend running?');
      },
    });
  }

  revert(): void {
    const b = this.budget();
    if (b) {
      this.baseMs.set(b.time_base_ms);
      this.perKanaMs.set(b.time_per_kana_ms);
    }
  }

  useDefaults(): void {
    const b = this.budget();
    if (b) {
      this.baseMs.set(b.defaults.time_base_ms);
      this.perKanaMs.set(b.defaults.time_per_kana_ms);
    }
  }

  cancel(): void {
    this.step.set(0);
    this.confirmText = '';
    this.error.set('');
  }

  reset(): void {
    this.busy.set(true);
    this.error.set('');
    this.api.reset().subscribe({
      next: () => {
        this.busy.set(false);
        this.done.set(true);
        this.api.stats().subscribe();
      },
      error: () => {
        this.busy.set(false);
        this.error.set('Reset failed — is the backend running?');
      },
    });
  }
}
