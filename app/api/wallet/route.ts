import { env } from "cloudflare:workers";
import { getD1 } from "@/db";
import { authenticateTelegram } from "@/lib/telegram-auth";

type RuntimeEnv = { TELEGRAM_BOT_TOKEN?: string };

export async function GET(request: Request) {
  try {
    const botToken = (env as unknown as RuntimeEnv).TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return Response.json({ mode: "setup_required", balance: 0, transactions: [] });
    }

    const initData = new URL(request.url).searchParams.get("initData") || "";
    const user = await authenticateTelegram(initData, botToken);
    if (!user) {
      return Response.json(
        { error: "کیف پول را از داخل ربات تلگرام باز کنید." },
        { status: 401 },
      );
    }

    const db = getD1();
    const now = Math.floor(Date.now() / 1000);
    await db
      .prepare(
        `INSERT INTO telegram_users
          (telegram_user_id, first_name, username, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(telegram_user_id) DO UPDATE SET
           first_name = excluded.first_name,
           username = excluded.username,
           updated_at = excluded.updated_at`,
      )
      .bind(String(user.id), user.first_name, user.username || null, now, now)
      .run();

    const balanceRow = await db
      .prepare(
        `SELECT COALESCE(SUM(credit_delta), 0) AS balance
         FROM wallet_transactions
         WHERE telegram_user_id = ? AND status = 'completed'`,
      )
      .bind(String(user.id))
      .first<{ balance: number }>();
    const recent = await db
      .prepare(
        `SELECT id, type, amount_stars AS amountStars, credit_delta AS creditDelta,
                status, created_at AS createdAt, completed_at AS completedAt
         FROM wallet_transactions
         WHERE telegram_user_id = ?
         ORDER BY created_at DESC
         LIMIT 10`,
      )
      .bind(String(user.id))
      .all();

    return Response.json({
      mode: "live",
      balance: Number(balanceRow?.balance || 0),
      transactions: recent.results,
      user: { firstName: user.first_name },
    });
  } catch {
    return Response.json(
      { error: "کیف پول موقتاً در دسترس نیست." },
      { status: 503 },
    );
  }
}
