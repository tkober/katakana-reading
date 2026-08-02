export interface NextWord {
  word_id: number;
  katakana: string;
  level: number;
  kana_count: number;
  target_time_ms: number;
  user_level: number;
  elo: number;
}

export interface TokenResult {
  kana: string;
  expected: string;
  given: string;
  correct: boolean;
}

export interface EloChange {
  before: number;
  after: number;
  delta: number;
}

export interface AnswerResult {
  correct: boolean;
  fast: boolean;
  target_time_ms: number;
  romaji: string;
  meaning: string;
  katakana: string;
  level: number;
  kana_total: number;
  kana_correct: number;
  tokens: TokenResult[];
  elo: EloChange;
  user_level: number;
  level_progress: number;
  streak: number;
  best_streak: number;
}

export interface KanaStat {
  kana: string;
  attempts: number;
  correct: number;
  accuracy: number | null;
  ewma: number;
}

export interface RecentAttempt {
  katakana: string;
  romaji: string;
  answer: string;
  correct: boolean;
  kana_total: number;
  kana_correct: number;
  time_ms: number;
  elo_delta: number;
  created_at: string;
}

export interface Stats {
  elo: number;
  level: number;
  level_progress: number;
  max_level: number;
  current_streak: number;
  best_streak: number;
  total_attempts: number;
  correct_attempts: number;
  accuracy: number | null;
  avg_time_ms: number;
  avg_time_per_kana_ms: number;
  kana: KanaStat[];
  recent: RecentAttempt[];
  elo_history: number[];
}

export interface Profile {
  elo: number;
  level: number;
  streak: number;
}
