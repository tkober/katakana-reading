import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { SumiCard, SumiErrorState, SumiPage } from 'sumi-ui/layout';
import { SumiButtonDirective, SumiInputDirective, SumiSliderDirective } from 'sumi-ui/forms';

import { ApiService } from './api.service';
import { TimeBudget } from './models';

@Component({
  selector: 'app-settings',
  imports: [
    DecimalPipe,
    FormsModule,
    SumiPage,
    SumiCard,
    SumiErrorState,
    SumiButtonDirective,
    SumiInputDirective,
    SumiSliderDirective,
  ],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.css',
})
export class SettingsComponent {
  private api = inject(ApiService);

  /** Set when the initial `/api/settings` load fails — shows
   *  `sumi-error-state` instead of the three cards until retried. */
  readonly failed = signal(false);

  readonly budget = signal<TimeBudget | null>(null);
  readonly baseMs = signal(0);
  readonly perKanaMs = signal(0);
  readonly saving = signal(false);
  readonly budgetError = signal('');

  readonly dirty = computed(() => {
    const b = this.budget();
    return !!b && (b.time_base_ms !== this.baseMs() || b.time_per_kana_ms !== this.perKanaMs());
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

  // Reset-progress state: step 0 → 1 (confirm) → 2 (type RESET) → done.
  readonly step = signal(0);
  readonly busy = signal(false);
  readonly done = signal(false);
  readonly error = signal('');
  confirmText = '';

  constructor() {
    this.loadBudget();
  }

  retry(): void {
    this.failed.set(false);
    this.loadBudget();
  }

  private loadBudget(): void {
    this.api.timeBudget().subscribe({
      next: (b) => {
        this.failed.set(false);
        this.applyBudget(b);
      },
      error: () => this.failed.set(true),
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

  cancelReset(): void {
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
