import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ApiService } from './api.service';

@Component({
  selector: 'app-settings',
  imports: [FormsModule],
  template: `
    <section class="settings">
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
      .btn-danger {
        padding: 9px 16px;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
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
export class SettingsComponent {
  private api = inject(ApiService);

  readonly step = signal(0);
  readonly busy = signal(false);
  readonly done = signal(false);
  readonly error = signal('');

  confirmText = '';

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
