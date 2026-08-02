import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';

import { AnswerResult, NextWord, Profile, Stats } from './models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  /** Shared header state, refreshed by every API response that carries it. */
  readonly profile = signal<Profile | null>(null);

  nextWord(): Observable<NextWord> {
    return this.http.get<NextWord>('/api/word/next').pipe(
      tap((w) =>
        this.profile.update((p) => ({
          elo: w.elo,
          level: w.user_level,
          streak: p?.streak ?? 0,
        })),
      ),
    );
  }

  answer(wordId: number, answer: string, timeMs: number): Observable<AnswerResult> {
    return this.http
      .post<AnswerResult>('/api/answer', {
        word_id: wordId,
        answer,
        time_ms: Math.round(timeMs),
      })
      .pipe(
        tap((r) =>
          this.profile.set({
            elo: r.elo.after,
            level: r.user_level,
            streak: r.streak,
          }),
        ),
      );
  }

  stats(): Observable<Stats> {
    return this.http.get<Stats>('/api/stats').pipe(
      tap((s) =>
        this.profile.set({ elo: s.elo, level: s.level, streak: s.current_streak }),
      ),
    );
  }

  reset(): Observable<{ status: string }> {
    return this.http.post<{ status: string }>('/api/reset', { confirm: 'RESET' });
  }
}
