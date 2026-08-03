import { DecimalPipe } from '@angular/common';
import {
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ApiService } from './api.service';
import { AnswerResult, NextWord } from './models';

type SessionState = 'idle' | 'active' | 'ended';

@Component({
  selector: 'app-practice',
  imports: [DecimalPipe, FormsModule],
  template: `
    @switch (state()) {
      @case ('idle') {
        <section class="gate">
          <h2>Ready to read?</h2>
          <p>
            Words are picked to match your level and to target the kana you
            struggle with. The clock only starts once the first word is on
            screen — take your time until then.
          </p>
          <button class="primary" (click)="startSession()">
            Start training session
          </button>
        </section>
      }

      @case ('ended') {
        <section class="gate">
          <h2>Session finished</h2>
          @if (sessionCount() > 0) {
            <div class="summary">
              <div class="sum-tile">
                <span class="sum-label">Words</span>
                <span class="sum-value">{{ sessionCount() }}</span>
              </div>
              <div class="sum-tile">
                <span class="sum-label">Correct</span>
                <span class="sum-value">
                  {{ sessionCorrect() }}
                  <small>({{ sessionAccuracy() * 100 | number: '1.0-0' }} %)</small>
                </span>
              </div>
              <div class="sum-tile">
                <span class="sum-label">Ø per word</span>
                <span class="sum-value">
                  {{ sessionAvgMs() / 1000 | number: '1.1-1' }} s
                </span>
              </div>
              <div class="sum-tile">
                <span class="sum-label">Elo</span>
                <span
                  class="sum-value"
                  [class.up]="sessionElo() >= 0"
                  [class.down]="sessionElo() < 0"
                >
                  {{ sessionElo() >= 0 ? '+' : '' }}{{ sessionElo() | number: '1.0-0' }}
                </span>
              </div>
            </div>
          } @else {
            <p class="muted">No words answered in this session.</p>
          }
          <button class="primary" (click)="startSession()">
            Start another session
          </button>
        </section>
      }

      @case ('active') {
        @if (word(); as w) {
          <section class="practice">
            <div class="session-bar">
              <span class="session-stat">
                Session: <strong>{{ sessionCorrect() }}/{{ sessionCount() }}</strong>
                @if (sessionCount() > 0) {
                  <span class="muted">
                    · Ø {{ sessionAvgMs() / 1000 | number: '1.1-1' }} s
                  </span>
                }
              </span>
              <button class="ghost" (click)="endSession()">End session</button>
            </div>

            <div class="word-card" [class.answered]="result() !== null">
              <div class="word-meta">
                <span>Word level {{ w.level }}</span>
                <span>{{ w.kana_count }} kana</span>
              </div>
              @if (result(); as r) {
                <div class="tokens kana-font">
                  @for (t of r.tokens; track $index) {
                    <div class="token" [class.ok]="t.correct" [class.bad]="!t.correct">
                      <div class="token-kana">{{ t.kana }}</div>
                      <div class="token-romaji">{{ t.expected }}</div>
                      <div class="token-mark">{{ t.correct ? '✓' : '✕' }}</div>
                    </div>
                  }
                </div>
                <div class="reading">
                  <span class="reading-romaji">{{ r.romaji }}</span>
                  <span class="reading-meaning">{{ r.meaning }}</span>
                </div>
                <div class="reading-source">
                  <span class="source-chip">{{ r.source }}</span>
                </div>
              } @else {
                <div class="word kana-font">{{ w.katakana }}</div>
              }
            </div>

            @if (result(); as r) {
              <div
                class="verdict"
                [class.verdict-ok]="r.correct"
                [class.verdict-bad]="!r.correct"
              >
                <strong>{{
                  r.correct ? (r.fast ? 'Correct & fast!' : 'Correct!') : 'Not quite.'
                }}</strong>
                <span
                  >{{ r.kana_correct }}/{{ r.kana_total }} kana ·
                  {{ elapsedMs() / 1000 | number: '1.1-1' }} s ·
                  {{ r.elo.delta >= 0 ? '+' : '' }}{{ r.elo.delta | number: '1.1-1' }}
                  Elo</span
                >
                @if (!r.correct && answered()) {
                  <span class="your-answer">Your answer: “{{ answered() }}”</span>
                }
              </div>
            }

            <form class="answer-row" (submit)="onSubmit($event)">
              <input
                #answerBox
                class="answer-input"
                type="text"
                name="answer"
                [(ngModel)]="answer"
                [readonly]="result() !== null"
                [placeholder]="
                  result() ? 'Press Enter for the next word' : 'Type romaji…'
                "
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
              />
              <button class="submit-btn" type="submit">
                {{ result() ? 'Next' : 'Check' }}
              </button>
            </form>

            <div class="hint-row">
              @if (result() === null) {
                <span class="timer" [class.overtime]="elapsedMs() > w.target_time_ms">
                  {{ elapsedMs() / 1000 | number: '1.1-1' }} s
                </span>
                <span class="hint"
                  >Target: under
                  {{ w.target_time_ms / 1000 | number: '1.0-1' }} s</span
                >
              } @else {
                <span class="hint">Press Enter for the next word</span>
              }
            </div>
          </section>
        } @else {
          <p class="loading">Loading word…</p>
        }
      }
    }
  `,
  styles: [
    `
      .gate {
        background: var(--surface);
        border: 1px solid var(--grid);
        border-radius: 14px;
        padding: 32px 28px;
        text-align: center;
      }
      .gate h2 {
        margin: 0 0 10px;
        font-size: 20px;
      }
      .gate p {
        color: var(--ink-2);
        font-size: 14px;
        max-width: 44ch;
        margin: 0 auto 20px;
      }
      .primary {
        padding: 12px 26px;
        border-radius: 10px;
        border: none;
        background: var(--accent);
        color: var(--accent-ink);
        font-weight: 650;
        font-size: 15px;
        cursor: pointer;
      }
      .summary {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
        gap: 10px;
        margin: 0 0 22px;
      }
      .sum-tile {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 12px 10px;
        border: 1px solid var(--grid);
        border-radius: 10px;
      }
      .sum-label {
        font-size: 12px;
        color: var(--ink-2);
      }
      .sum-value {
        font-size: 22px;
        font-weight: 600;
      }
      .sum-value small {
        font-size: 12px;
        font-weight: 400;
        color: var(--muted);
      }
      .sum-value.up {
        color: var(--good-text);
      }
      .sum-value.down {
        color: var(--critical);
      }
      .practice {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .session-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px 12px;
        font-size: 13px;
        color: var(--ink-2);
      }
      .ghost {
        background: transparent;
        border: 1px solid var(--grid);
        border-radius: 8px;
        padding: 5px 12px;
        font-size: 13px;
        color: var(--ink-2);
        cursor: pointer;
      }
      .ghost:hover {
        color: var(--critical);
        border-color: var(--critical);
      }
      .word-card {
        background: var(--accent);
        color: var(--accent-ink);
        border-radius: 14px;
        padding: 28px 24px 36px;
        text-align: center;
      }
      .word-meta {
        display: flex;
        justify-content: space-between;
        font-size: 12px;
        opacity: 0.75;
        margin-bottom: 18px;
      }
      .word {
        font-size: clamp(34px, 9vw, 64px);
        font-weight: 600;
        letter-spacing: 0.06em;
        line-height: 1.2;
        overflow-wrap: anywhere;
      }
      .tokens {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px;
      }
      .token {
        min-width: 52px;
        padding: 8px 10px 6px;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.14);
      }
      .token.ok {
        outline: 2px solid var(--good);
      }
      .token.bad {
        outline: 2px solid var(--critical);
        background: rgba(0, 0, 0, 0.25);
      }
      .token-kana {
        font-size: 30px;
        font-weight: 600;
        line-height: 1.25;
      }
      .token-romaji {
        font-size: 13px;
        opacity: 0.9;
      }
      .token-mark {
        font-size: 12px;
        font-weight: 700;
      }
      .token.ok .token-mark {
        color: #b7f7b7;
      }
      .token.bad .token-mark {
        color: #ffc6c6;
      }
      .reading {
        margin-top: 16px;
        display: flex;
        justify-content: center;
        align-items: baseline;
        gap: 14px;
        flex-wrap: wrap;
      }
      .reading-romaji {
        font-size: 22px;
        font-weight: 650;
      }
      .reading-meaning {
        font-size: 15px;
        opacity: 0.85;
      }
      .reading-source {
        margin-top: 10px;
      }
      .source-chip {
        display: inline-block;
        border: 1px solid rgba(255, 255, 255, 0.35);
        border-radius: 999px;
        padding: 2px 12px;
        font-size: 12px;
        opacity: 0.9;
      }
      .verdict {
        display: flex;
        gap: 12px;
        align-items: baseline;
        flex-wrap: wrap;
        padding: 10px 14px;
        border-radius: 10px;
        font-size: 14px;
      }
      .verdict-ok {
        background: var(--good-wash);
        color: var(--good-text);
      }
      .verdict-bad {
        background: var(--critical-wash);
        color: var(--critical);
      }
      .your-answer {
        color: var(--ink-2);
      }
      .answer-row {
        display: flex;
        gap: 10px;
      }
      .answer-input {
        flex: 1;
        /* Without this the input keeps its intrinsic size=20 width (~242px)
           and pushes the button off screen on narrow phones. */
        min-width: 0;
        font-size: 20px;
        padding: 12px 16px;
        border-radius: 10px;
        border: 1px solid var(--grid);
        background: var(--surface);
        color: var(--ink);
        text-align: center;
        letter-spacing: 0.04em;
      }
      .answer-input:focus {
        outline: 2px solid var(--accent);
        border-color: transparent;
      }
      .submit-btn {
        flex: none;
        white-space: nowrap;
        padding: 12px 22px;
        border-radius: 10px;
        border: none;
        background: var(--accent);
        color: var(--accent-ink);
        font-weight: 600;
        cursor: pointer;
      }
      .hint-row {
        display: flex;
        gap: 16px;
        align-items: baseline;
        justify-content: center;
        min-height: 24px;
      }
      .timer {
        font-variant-numeric: tabular-nums;
        color: var(--ink-2);
        font-size: 14px;
      }
      .timer.overtime {
        color: var(--critical);
      }
      .hint {
        color: var(--muted);
        font-size: 13px;
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
export class PracticeComponent implements OnDestroy {
  private api = inject(ApiService);

  @ViewChild('answerBox') answerBox?: ElementRef<HTMLInputElement>;

  readonly state = signal<SessionState>('idle');
  readonly word = signal<NextWord | null>(null);
  readonly result = signal<AnswerResult | null>(null);
  readonly answered = signal<string>('');
  readonly elapsedMs = signal(0);
  readonly sessionCount = signal(0);
  readonly sessionCorrect = signal(0);
  readonly sessionElo = signal(0);
  readonly sessionTimeMs = signal(0);

  readonly sessionAccuracy = computed(() =>
    this.sessionCount() ? this.sessionCorrect() / this.sessionCount() : 0,
  );
  readonly sessionAvgMs = computed(() =>
    this.sessionCount() ? this.sessionTimeMs() / this.sessionCount() : 0,
  );

  answer = '';
  private startedAt = 0;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private submitting = false;

  ngOnDestroy(): void {
    this.stopTicker();
  }

  startSession(): void {
    this.sessionCount.set(0);
    this.sessionCorrect.set(0);
    this.sessionElo.set(0);
    this.sessionTimeMs.set(0);
    this.state.set('active');
    this.loadNext();
  }

  endSession(): void {
    this.stopTicker();
    this.word.set(null);
    this.result.set(null);
    this.answer = '';
    this.state.set('ended');
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    if (this.result()) {
      this.loadNext();
      return;
    }
    const word = this.word();
    if (!word || this.submitting || !this.answer.trim()) {
      return;
    }
    this.submitting = true;
    const timeMs = performance.now() - this.startedAt;
    this.stopTicker();
    this.elapsedMs.set(timeMs);
    this.api.answer(word.word_id, this.answer, timeMs).subscribe({
      next: (r) => {
        this.submitting = false;
        this.answered.set(this.answer.trim());
        this.result.set(r);
        this.sessionCount.update((n) => n + 1);
        this.sessionTimeMs.update((t) => t + timeMs);
        this.sessionElo.update((e) => e + r.elo.delta);
        if (r.correct) {
          this.sessionCorrect.update((n) => n + 1);
        }
        this.focusInput();
      },
      error: () => (this.submitting = false),
    });
  }

  private loadNext(): void {
    this.result.set(null);
    this.answer = '';
    this.answered.set('');
    this.word.set(null);
    this.api.nextWord().subscribe((w) => {
      // A session ended while the request was in flight must stay ended.
      if (this.state() !== 'active') {
        return;
      }
      this.word.set(w);
      this.startedAt = performance.now();
      this.elapsedMs.set(0);
      this.startTicker();
      this.focusInput();
    });
  }

  private startTicker(): void {
    this.stopTicker();
    this.ticker = setInterval(
      () => this.elapsedMs.set(performance.now() - this.startedAt),
      100,
    );
  }

  private stopTicker(): void {
    if (this.ticker !== null) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  private focusInput(): void {
    setTimeout(() => this.answerBox?.nativeElement.focus(), 0);
  }
}
