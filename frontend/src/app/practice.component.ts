import { DecimalPipe } from '@angular/common';
import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ApiService } from './api.service';
import { AnswerResult, NextWord } from './models';

@Component({
  selector: 'app-practice',
  imports: [DecimalPipe, FormsModule],
  template: `
    @if (word(); as w) {
      <section class="practice">
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
            [placeholder]="result() ? 'Press Enter for the next word' : 'Type romaji…'"
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
            <span class="hint">Target: under {{ w.target_time_ms / 1000 | number: '1.0-1' }} s</span>
          } @else {
            <span class="hint">Press Enter for the next word</span>
          }
          @if (sessionCount() > 0) {
            <span class="hint session">
              Session: {{ sessionCorrect() }}/{{ sessionCount() }} correct
            </span>
          }
        </div>
      </section>
    } @else {
      <p class="loading">Loading word…</p>
    }
  `,
  styles: [
    `
      .practice {
        display: flex;
        flex-direction: column;
        gap: 16px;
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
      .session {
        margin-left: auto;
      }
      .loading {
        color: var(--muted);
        text-align: center;
      }
    `,
  ],
})
export class PracticeComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);

  @ViewChild('answerBox') answerBox?: ElementRef<HTMLInputElement>;

  readonly word = signal<NextWord | null>(null);
  readonly result = signal<AnswerResult | null>(null);
  readonly answered = signal<string>('');
  readonly elapsedMs = signal(0);
  readonly sessionCount = signal(0);
  readonly sessionCorrect = signal(0);

  answer = '';
  private startedAt = 0;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private submitting = false;

  ngOnInit(): void {
    this.loadNext();
  }

  ngOnDestroy(): void {
    this.stopTicker();
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
