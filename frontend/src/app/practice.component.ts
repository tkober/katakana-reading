import { DecimalPipe } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { SUMI_KEYS, SumiHotkeys, injectHotkey } from 'sumi-ui/core';
import { SumiBadge, SumiFocusModeDirective, SumiHanko, SumiPage, SumiShellFocusActionsDirective } from 'sumi-ui/layout';
import { SumiButtonDirective } from 'sumi-ui/forms';
import { SUMI_PRACTICE, SumiAnswerField, type SumiVerdict } from 'sumi-ui/practice';

import { ApiService } from './api.service';
import { AnswerResult, NextWord } from './models';

/** A session is explicit: nothing runs until it is started, and the clock
 *  only starts once the first word is on screen. */
type SessionState = 'idle' | 'active' | 'ended';

const TICK_MS = 100;

@Component({
  selector: 'app-practice',
  imports: [
    DecimalPipe,
    SumiBadge,
    SumiButtonDirective,
    SumiFocusModeDirective,
    SumiHanko,
    SumiPage,
    SumiShellFocusActionsDirective,
    ...SUMI_PRACTICE,
  ],
  templateUrl: './practice.component.html',
  styleUrl: './practice.component.css',
})
export class PracticeComponent {
  private api = inject(ApiService);
  private hotkeys = inject(SumiHotkeys);
  private injector = inject(Injector);
  private field = viewChild<SumiAnswerField>('field');
  private answerRow = viewChild<ElementRef<HTMLElement>>('answerRow');

  readonly state = signal<SessionState>('idle');
  readonly word = signal<NextWord | null>(null);
  readonly result = signal<AnswerResult | null>(null);
  /** Whether the current `result` came from Alt+H rather than a typed
   *  submission — drives the "Gave up" title and hides "Your answer". */
  readonly gaveUp = signal(false);
  readonly value = signal('');
  /** Open by default: the kana-by-kana breakdown is the core learning
   *  feedback on a miss. `F` (registered by `sumi-verdict` itself) toggles
   *  it, and that choice persists for the rest of the session rather than
   *  resetting on every word. */
  readonly detailsOpen = signal(true);

  readonly elapsedMs = signal(0);
  readonly sessionCount = signal(0);
  readonly sessionCorrect = signal(0);
  readonly sessionElo = signal(0);
  readonly sessionTimeMs = signal(0);
  readonly sessionDurationMs = signal(0);

  /** `null` means "unknown" (the shared profile was not loaded yet when the
   *  session started) — kept distinct from a real level so `levelUp` never
   *  guesses a rise it cannot actually see. */
  private startLevel: number | null = null;
  private startedAt = 0;
  private sessionStartedAt = 0;
  private ticker: ReturnType<typeof setInterval> | undefined;
  private submitting = false;

  readonly sessionAccuracy = computed(() =>
    this.sessionCount() ? this.sessionCorrect() / this.sessionCount() : 0,
  );
  readonly sessionAvgMs = computed(() =>
    this.sessionCount() ? this.sessionTimeMs() / this.sessionCount() : 0,
  );
  /** `sumi-session-summary` prints `delta` raw — round the accumulated Elo
   *  change to an integer before handing it over. */
  readonly roundedSessionElo = computed(() => Math.round(this.sessionElo()));

  /** 合格 ("passed") at 80 % or above, 練習 ("practice") otherwise — see
   *  docs/concept.md#tuschemotive and sumi-ui#38's `sumi-hanko` example. */
  readonly hankoCharacters = computed(() => (this.sessionAccuracy() >= 0.8 ? '合格' : '練習'));
  readonly hankoLabel = computed(() => (this.sessionAccuracy() >= 0.8 ? 'Passed' : 'Practice'));

  /** Set once the shared profile's level (updated on every `/api/answer`,
   *  see `ApiService.answer()`) is higher than it was when the session
   *  started. `undefined` (not a falsy level) so `sumi-session-summary`'s
   *  `levelUp` input, which only renders its second hanko when set, stays
   *  unset for a session without a level-up. */
  readonly levelUp = computed<string | undefined>(() => {
    const start = this.startLevel;
    const level = this.api.profile()?.level;
    if (start === null || level === undefined || level <= start) {
      return undefined;
    }
    return `Level ${level}`;
  });

  /** Drives `sumi-answer-field`'s `[verdict]` — just enough to freeze the
   *  field and pick correct/wrong styling. The richer feedback (title,
   *  message, breakdown) lives on `sumi-verdict` below, built straight from
   *  `result()` in the template. */
  readonly fieldVerdict = computed<SumiVerdict | null>(() => {
    const r = this.result();
    return r ? { kind: r.correct ? 'correct' : 'wrong' } : null;
  });

  /** Mirrors the field's own Enter-label switching (see
   *  `SumiAnswerField.submit()`) — this app never reaches held/retry, the
   *  backend is the sole judge of an answer. */
  readonly checkButtonLabel = computed(() =>
    this.result() !== null ? 'Next' : 'Check',
  );

  readonly verdictTitle = computed<string | undefined>(() => {
    const r = this.result();
    if (!r) {
      return undefined;
    }
    if (this.gaveUp()) {
      return 'Gave up';
    }
    if (r.correct) {
      return r.fast ? 'Correct & fast' : 'Correct';
    }
    return 'Not quite';
  });

  /** "{kana_correct}/{kana_total} kana · {s.s} s · {±d.d} Elo" — the time is
   *  the frozen `elapsedMs` (the ring stops ticking at submit time), not a
   *  live value. */
  readonly verdictMessage = computed<string | undefined>(() => {
    const r = this.result();
    if (!r) {
      return undefined;
    }
    const seconds = (this.elapsedMs() / 1000).toFixed(1);
    const delta = r.elo.delta;
    const sign = delta >= 0 ? '+' : '';
    return `${r.kana_correct}/${r.kana_total} kana · ${seconds} s · ${sign}${delta.toFixed(1)} Elo`;
  });

  constructor() {
    // `?` only becomes a hotkey once a verdict is on screen — bare keys
    // otherwise belong to the field. `F` is registered by `sumi-verdict`
    // itself as soon as its details slot has content, which it always does
    // here.
    injectHotkey({
      keys: SUMI_KEYS.help,
      label: 'Toggle this menu (after answering)',
      scope: 'feedback',
      allowInEditable: true,
      enabled: () => this.result() !== null,
      handler: () => this.hotkeys.toggleHelp(),
    });

    inject(DestroyRef).onDestroy(() => this.stopTicker());
  }

  startSession(): void {
    this.sessionCount.set(0);
    this.sessionCorrect.set(0);
    this.sessionElo.set(0);
    this.sessionTimeMs.set(0);
    this.detailsOpen.set(true);
    this.startLevel = this.api.profile()?.level ?? null;
    this.sessionStartedAt = Date.now();
    this.state.set('active');
    this.loadNext();
  }

  endSession(): void {
    this.stopTicker();
    this.sessionDurationMs.set(Date.now() - this.sessionStartedAt);
    this.word.set(null);
    this.result.set(null);
    this.value.set('');
    this.state.set('ended');
  }

  /** `Enter` on a settled verdict, routed here from the field's `(next)`
   *  output and from the Check/Next button via `field.submit()`. */
  onNext(): void {
    this.loadNext();
  }

  /** `Enter` on a finished, typed answer. The field itself already ignores
   *  an empty/whitespace answer (ignores the trim and never emits), so no
   *  extra guard is needed here. */
  onSubmitted(answer: string): void {
    this.submit(answer, false);
  }

  /** Alt+H: reveal the solution, scored as a plain miss by the backend. */
  onGaveUp(): void {
    this.submit(this.value(), true);
  }

  /** The Check/Next button next to the field — `sumiHoldFocus` keeps the
   *  caret (and on a phone, the keyboard) in the field; this just does
   *  whatever `Enter` would do right now. */
  onCheckClick(): void {
    this.field()?.submit();
  }

  private submit(answer: string, gaveUp: boolean): void {
    const word = this.word();
    if (!word || this.state() !== 'active' || this.submitting) {
      return;
    }
    this.submitting = true;
    const timeMs = performance.now() - this.startedAt;
    this.stopTicker();
    this.elapsedMs.set(timeMs);
    this.gaveUp.set(gaveUp);

    this.api.answer(word.word_id, answer, timeMs, gaveUp).subscribe({
      next: (r) => {
        this.submitting = false;
        this.result.set(r);
        this.sessionCount.update((n) => n + 1);
        this.sessionTimeMs.update((t) => t + timeMs);
        this.sessionElo.update((e) => e + r.elo.delta);
        if (r.correct) {
          this.sessionCorrect.update((n) => n + 1);
        }
        this.revealVerdict();
      },
      error: () => {
        this.submitting = false;
      },
    });
  }

  private loadNext(): void {
    this.result.set(null);
    this.gaveUp.set(false);
    this.value.set('');
    this.word.set(null);
    this.api.nextWord().subscribe((w) => {
      // A session ended while this request was in flight must stay ended.
      if (this.state() !== 'active') {
        return;
      }
      this.word.set(w);
      this.startedAt = performance.now();
      this.elapsedMs.set(0);
      this.startTicker();
    });
  }

  /** Bring the correction into view, below the sticky header — see the
   *  pilot's identically-named method for the full reasoning. With the
   *  on-screen keyboard up, the prompt, the input *and* the verdict do not
   *  fit on screen together (360×780 reference), so the input row is
   *  scrolled to just under the header once a verdict lands. */
  private revealVerdict(): void {
    afterNextRender(
      () => {
        const row = this.answerRow()?.nativeElement;
        if (!row) {
          return;
        }
        const header = document.querySelector('.sumi-app-shell__header');
        row.style.scrollMarginTop = `${(header?.getBoundingClientRect().height ?? 0) + 8}px`;
        row.scrollIntoView({ block: 'start', behavior: 'smooth' });
      },
      { injector: this.injector },
    );
  }

  private startTicker(): void {
    this.stopTicker();
    this.ticker = setInterval(() => this.elapsedMs.set(performance.now() - this.startedAt), TICK_MS);
  }

  private stopTicker(): void {
    if (this.ticker !== undefined) {
      clearInterval(this.ticker);
      this.ticker = undefined;
    }
  }
}
