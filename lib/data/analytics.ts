/* ===========================================================
   data/analytics.ts - aggregate attempts into stats and trends
   Port of js/analytics.js (pure functions, no DOM).
   =========================================================== */
import type { Attempt } from "@/lib/types";
import { pct } from "@/lib/client/util";
import { getAttempts } from "@/lib/client/store";

export function summary(attempts: Attempt[] = getAttempts()) {
  if (!attempts.length) {
    return {
      attempts: 0,
      avgScore: 0,
      bestScore: 0,
      accuracy: 0,
      totalQ: 0,
      totalTime: 0,
      streakDays: 0,
    };
  }
  const avgScore = Math.round(attempts.reduce((a, x) => a + x.percent, 0) / attempts.length);
  const bestScore = Math.max.apply(
    null,
    attempts.map((x) => x.percent)
  );
  const totalCorrect = attempts.reduce((a, x) => a + x.correct, 0);
  const totalQ = attempts.reduce((a, x) => a + x.total, 0);
  return {
    attempts: attempts.length,
    avgScore,
    bestScore,
    accuracy: pct(totalCorrect, totalQ),
    totalQ,
    totalTime: attempts.reduce((a, x) => a + (x.timeTaken || 0), 0),
    streakDays: streak(attempts),
  };
}

/** Consecutive days (ending today or yesterday) with at least one attempt. */
export function streak(attempts: Attempt[] = getAttempts()): number {
  if (!attempts.length) return 0;
  const days = new Set(attempts.map((a) => new Date(a.at).toDateString()));
  let count = 0;
  const d = new Date();
  if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1);
  while (days.has(d.toDateString())) {
    count++;
    d.setDate(d.getDate() - 1);
  }
  return count;
}

/** Score trend: oldest -> newest, for the sparkline. */
export function trend(attempts: Attempt[] = getAttempts(), limit = 30) {
  return attempts.slice(-limit).map((a) => ({
    at: a.at,
    percent: a.percent,
    label: a.label || "Test",
  }));
}

export interface BreakdownRowFull {
  key: string;
  total: number;
  correct: number;
  wrong: number;
  skipped: number;
  accuracy: number;
}

/** Group questions/results by subject and topic using attempt details. */
export function breakdown(attempts: Attempt[] = getAttempts()): {
  subjects: BreakdownRowFull[];
  topics: BreakdownRowFull[];
} {
  const bySubject = new Map<string, BreakdownRowFull>();
  const byTopic = new Map<string, BreakdownRowFull>();
  for (const a of attempts) {
    for (const d of a.details || []) {
      const bump = (map: Map<string, BreakdownRowFull>, key: string) => {
        if (!map.has(key)) {
          map.set(key, { key, total: 0, correct: 0, wrong: 0, skipped: 0, accuracy: 0 });
        }
        return map.get(key)!;
      };
      const s = bump(bySubject, d.subject || "General");
      const t = bump(byTopic, (d.subject || "General") + " / " + (d.topic || "General"));
      for (const row of [s, t]) {
        row.total++;
        if (d.status === "correct") row.correct++;
        else if (d.status === "wrong") row.wrong++;
        else row.skipped++;
      }
    }
  }
  const finish = (m: Map<string, BreakdownRowFull>) =>
    Array.from(m.values())
      .map((r) => ({ ...r, accuracy: pct(r.correct, r.total) }))
      .sort((a, b) => a.accuracy - b.accuracy);
  return { subjects: finish(bySubject), topics: finish(byTopic) };
}
/** Topics with the lowest accuracy (min 3 attempts on the topic). */
export function weakTopics(
  attempts: Attempt[] = getAttempts(),
  minAsked = 3,
  limit = 5
): BreakdownRowFull[] {
  return breakdown(attempts)
    .topics.filter((t) => t.total >= minAsked)
    .slice(0, limit);
}

/** Difficulty performance. */
export function byDifficulty(attempts: Attempt[] = getAttempts()) {
  const m = new Map<string, { key: string; total: number; correct: number }>();
  for (const a of attempts) {
    for (const d of a.details || []) {
      const k = d.difficulty || "medium";
      if (!m.has(k)) m.set(k, { key: k, total: 0, correct: 0 });
      const r = m.get(k)!;
      r.total++;
      if (d.status === "correct") r.correct++;
    }
  }
  return Array.from(m.values()).map((r) => ({
    ...r,
    accuracy: pct(r.correct, r.total),
  }));
}

/**
 * User-wise summary: one row per student. Works on device results
 * (grouped by name) and on cloud results (grouped by account id).
 */
export function groupByStudent(attempts: Attempt[] = getAttempts()) {
  const m = new Map<
    string,
    {
      key: string;
      userId: string;
      name: string;
      attempts: number;
      total: number;
      correct: number;
      percentSum: number;
      best: number;
      timeTaken: number;
      lastAt: number;
    }
  >();
  for (const a of attempts) {
    const key = a.userId || "name:" + (a.student || "Anonymous");
    if (!m.has(key)) {
      m.set(key, {
        key,
        userId: a.userId || "",
        name: a.student || "Anonymous",
        attempts: 0,
        total: 0,
        correct: 0,
        percentSum: 0,
        best: 0,
        timeTaken: 0,
        lastAt: 0,
      });
    }
    const r = m.get(key)!;
    r.attempts++;
    r.total += a.total || 0;
    r.correct += a.correct || 0;
    r.percentSum += a.percent || 0;
    r.best = Math.max(r.best, a.percent || 0);
    r.timeTaken += a.timeTaken || 0;
    r.lastAt = Math.max(r.lastAt, a.at || 0);
  }
  return Array.from(m.values())
    .map((r) => ({
      ...r,
      avgPercent: Math.round(r.percentSum / r.attempts),
      accuracy: pct(r.correct, r.total),
    }))
    .sort((a, b) => b.attempts - a.attempts || String(a.name).localeCompare(String(b.name)));
}

/** Build the downloadable "report card" text for sharing. */
export function reportText(attempt: Attempt): string {
  const lines: string[] = [];
  lines.push("*" + (attempt.label || "Test") + " - Result*");
  lines.push("Score: " + attempt.score + "/" + attempt.total + " (" + attempt.percent + "%)");
  lines.push(
    "Correct: " + attempt.correct + "  Wrong: " + attempt.wrong + "  Skipped: " + attempt.skipped
  );
  lines.push(
    "Time: " + Math.floor((attempt.timeTaken || 0) / 60) + "m " + ((attempt.timeTaken || 0) % 60) + "s"
  );
  if (attempt.breakdown && attempt.breakdown.length) {
    lines.push("");
    lines.push("*Subject-wise:*");
    attempt.breakdown.forEach((b) =>
      lines.push("• " + b.subject + ": " + b.correct + "/" + b.total + " (" + b.accuracy + "%)")
    );
  }
  const weak = (attempt.weakTopics || []).slice(0, 5);
  if (weak.length) {
    lines.push("");
    lines.push("*Need revision:*");
    weak.forEach((t) => lines.push("• " + t.topic + " - " + t.accuracy + "%"));
  }
  return lines.join("\n");
}
