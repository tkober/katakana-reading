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
  source: string;
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

export interface CoverageRow {
  key: string;
  total: number;
  seen: number;
  served: number;
  correct: number;
  success: number | null;
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
  coverage: {
    levels: CoverageRow[];
    sources: CoverageRow[];
  };
}

export interface LevelCount {
  level: number;
  count: number;
}

export interface DictionaryInfo {
  source: string;
  /** "file" ships with the app, "upload" was added through the UI. */
  origin: 'file' | 'upload';
  uploaded_at: string | null;
  total: number;
  seen: number;
  served: number;
  correct: number;
  success: number | null;
  levels: LevelCount[];
  avg_kana: number;
  min_kana: number;
  max_kana: number;
  rating_min: number;
  rating_max: number;
}

export interface DictionariesResponse {
  dictionaries: DictionaryInfo[];
  all: DictionaryInfo | null;
}

export interface UploadResult {
  source: string;
  replaced: boolean;
  entries: number;
  words: number;
}

export interface DeleteResult {
  source: string;
  removed: number;
  /** Words kept because they carry answer history. */
  kept: number;
}

export interface WordRow {
  katakana: string;
  romaji: string;
  meaning: string;
  level: number;
  source: string;
  rating: number;
  times_served: number;
  times_correct: number;
  kana_count: number;
}

export interface WordsResponse {
  total: number;
  offset: number;
  limit: number;
  words: WordRow[];
}

export interface Profile {
  elo: number;
  level: number;
  streak: number;
}
