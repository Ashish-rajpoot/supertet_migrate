/* ===========================================================
   types.ts - shared shapes for questions, attempts, users
   Ported from the localStorage schema of the classic site so
   device data, MongoDB documents and API payloads all agree.
   =========================================================== */

/** A bilingual string. Either side may be empty. */
export interface Bi {
  hi: string;
  en: string;
}

export type Difficulty = "easy" | "medium" | "hard";

/** Canonical question used by the app, the API and MongoDB. */
export interface Question {
  id: string;
  subject: string;
  topic: string;
  difficulty: Difficulty;
  question: Bi;
  options: { hi: string[]; en: string[] };
  answerIndex: number;
  answerLetter: string;
  explanation: Bi;
  tags: string[];
  source?: string;
  createdBy?: string;
}

/** The flat column layout used by Excel / CSV / the AI prompt. */
export interface QuestionRow {
  id?: string;
  subject?: string;
  topic?: string;
  difficulty?: string;
  q_hi?: string;
  q_en?: string;
  opt1_hi?: string;
  opt2_hi?: string;
  opt3_hi?: string;
  opt4_hi?: string;
  opt5_hi?: string;
  opt6_hi?: string;
  opt1_en?: string;
  opt2_en?: string;
  opt3_en?: string;
  opt4_en?: string;
  opt5_en?: string;
  opt6_en?: string;
  answer?: string;
  expl_hi?: string;
  expl_en?: string;
  tags?: string;
  [key: string]: unknown;
}

export type AnswerStatus = "correct" | "wrong" | "skipped";

export interface AttemptDetail {
  id: string;
  subject: string;
  topic: string;
  difficulty: string;
  question: Bi;
  options: { hi: string[]; en: string[] };
  answerIndex: number;
  chosenIndex: number | null;
  status: AnswerStatus;
  explanation: Bi;
}

export interface BreakdownRow {
  subject: string;
  total: number;
  correct: number;
  accuracy: number;
}

export interface WeakTopicRow {
  subject: string;
  topic: string;
  total: number;
  correct: number;
  accuracy: number;
}

/** One finished test / practice run. */
export interface Attempt {
  id: string;
  userId?: string;
  student?: string;
  at: number;
  finishedAt?: number;
  mode: "test" | "practice";
  label: string;
  subjects: string[];
  total: number;
  correct: number;
  wrong: number;
  skipped: number;
  score: number;
  percent: number;
  timeTaken: number;
  minutes?: number;
  negative?: boolean;
  breakdown: BreakdownRow[];
  weakTopics: WeakTopicRow[];
  details: AttemptDetail[];
}

/** A syllabus subject with its embedded topics. */
export interface SyllabusTopic {
  id: string;
  name: string;
  nameHi: string;
}

export interface SyllabusSubject {
  id: string;
  name: string;
  nameHi: string;
  topics: SyllabusTopic[];
  order?: number;
  createdAt?: string;
  updatedAt?: string;
}

/** The user object the API returns - never carries passwordHash / salt. */
export interface PublicUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  userId: string;
  avatar: string;
  verified: boolean;
  role: "user" | "admin";
  canAddQuestions: boolean;
  classLevel: string;
  city: string;
  school: string;
  about: string;
  createdAt?: string;
}

/** { token, user } kept in localStorage under stp.auth. */
export interface AuthSession {
  token: string;
  user: PublicUser;
}

/** Device settings mirrored from js/store.js DEFAULT_SETTINGS. */
export interface Settings {
  defaultCount: number;
  defaultMinutes: number;
  negativeMarking: number;
  showExplanation: boolean;
  shuffleOptions: boolean;
  name: string;
  apiUrl: string;
  googleClientId: string;
}

/** Language mode for every bilingual field. */
export type Lang = "hi" | "en" | "both";

/** One row of the admin "all students" roster. */
export interface StudentRow {
  userId: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  canAddQuestions: boolean;
  attempts: number;
  avgPercent: number;
  best: number;
  accuracy: number;
  totalQuestions: number;
  lastAt: number;
}
