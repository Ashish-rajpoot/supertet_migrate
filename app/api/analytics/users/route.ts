import { Attempt, User } from "@/lib/server/models";
import { requireAdmin } from "@/lib/server/auth";
import { requireDb } from "@/lib/server/api";

export const dynamic = "force-dynamic";

const round = (n: number) => Math.round((n || 0) * 10) / 10;

/**
 * GET /api/analytics/users - admin only. One row per student with test
 * count, average, best, accuracy and last activity. Students who never
 * practised are included with zeros; orphaned attempts (account deleted)
 * show up as "Unknown user" so nothing is hidden.
 */
export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  const dbDown = await requireDb();
  if (dbDown) return dbDown;
  try {
    const users = await User.find()
      .select("id name email phone userId role canAddQuestions createdAt")
      .sort({ createdAt: 1 })
      .lean();

    const grouped = await Attempt.aggregate([
      { $match: { userId: { $nin: ["", null] } } },
      {
        $group: {
          _id: "$userId",
          attempts: { $sum: 1 },
          avgPercent: { $avg: "$percent" },
          best: { $max: "$percent" },
          totalQuestions: { $sum: "$total" },
          correctAnswers: { $sum: "$correct" },
          lastAt: { $max: "$at" },
        },
      },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byId = new Map<string, any>(grouped.map((g) => [String(g._id), g]));
    const students = users.map((u) => {
      const g = byId.get(u.id) || {};
      byId.delete(u.id);
      return {
        userId: u.id,
        name: u.name || "Student",
        email: u.email || "",
        phone: u.phone || "",
        role: u.role || "user",
        canAddQuestions: Boolean(u.canAddQuestions),
        attempts: g.attempts || 0,
        avgPercent: g.attempts ? round(g.avgPercent) : 0,
        best: g.best || 0,
        accuracy: g.totalQuestions
          ? Math.round(((g.correctAnswers || 0) / g.totalQuestions) * 100)
          : 0,
        totalQuestions: g.totalQuestions || 0,
        lastAt: g.lastAt || 0,
      };
    });

    for (const [userId, g] of byId) {
      students.push({
        userId,
        name: "Unknown user",
        email: "",
        phone: "",
        role: "user",
        canAddQuestions: false,
        attempts: g.attempts || 0,
        avgPercent: round(g.avgPercent),
        best: g.best || 0,
        accuracy: g.totalQuestions
          ? Math.round(((g.correctAnswers || 0) / g.totalQuestions) * 100)
          : 0,
        totalQuestions: g.totalQuestions || 0,
        lastAt: g.lastAt || 0,
      });
    }

    students.sort(
      (a, b) => b.attempts - a.attempts || String(a.name).localeCompare(String(b.name))
    );
    return Response.json({ students, count: students.length });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not load analytics" },
      { status: 500 }
    );
  }
}
