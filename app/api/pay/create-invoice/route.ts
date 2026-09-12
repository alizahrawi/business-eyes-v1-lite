import { env } from "cloudflare:workers";
import { getD1 } from "@/db";
import { authenticateTelegram } from "@/lib/telegram-auth";
import { telegramApi } from "@/lib/telegram-api";

type RuntimeEnv = { TELEGRAM_BOT_TOKEN?: string };

export async function POST(request: Request) {
  let transactionId = "";
  try {
    const botToken = (env as unknown as RuntimeEnv).TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return Response.json(
        { error: "پرداخت پس از اتصال توکن ربات فعال می‌شود." },
        { status: 503 },
      );
    }

    const body = (await request.json()) as { initData?: unknown; amount?: unknown };
    const initData = typeof body.initData === "string" ? body.initData : "";
    const amount = Number(body.amount);
    if (!Number.isInteger(amount) || amount < 10 || amount > 2500) {
      return Response.json(
        { error: "مبلغ شارژ باید بین ۱۰ تا ۲۵۰۰ استار باشد." },
        { status: 400 },
      );
    }

    const user = await authenticateTelegram(initData, botToken);
    if (!user) {
      return Response.json(
        { error: "پرداخت را از داخل ربات تلگرام انجام دهید." },
        { status: 401 },
      );
    }

    const db = getD1();
    const now = Math.floor(Date.now() / 1000);
    transactionId = crypto.randomUUID();
    const payload = `wallet:${transactionId}`;

    await db.batch([
      db
        .prepare(
          `INSERT INTO telegram_users
            (telegram_user_id, first_name, username, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(telegram_user_id) DO UPDATE SET
             first_name = excluded.first_name,
             username = excluded.username,
             updated_at = excluded.updated_at`,
        )
        .bind(String(user.id), user.first_name, user.username || null, now, now),
      db
        .prepare(
          `INSERT INTO wallet_transactions
            (id, telegram_user_id, type, amount_stars, credit_delta, status,
             invoice_payload, created_at)
           VALUES (?, ?, 'top_up', ?, ?, 'pending', ?, ?)`,
        )
        .bind(transactionId, String(user.id), amount, amount, payload, now),
    ]);

    const invoiceUrl = await telegramApi<string>(botToken, "createInvoiceLink", {
      title: "شارژ کیف پول روزنگار",
      description: `افزایش موجودی کیف پول به اندازه ${amount} اعتبار`,
      payload,
      provider_token: "",
      currency: "XTR",
      prices: [{ label: "اعتبار روزنگار", amount }],
    });

    return Response.json({ invoiceUrl, transactionId });
  } catch {
    if (transactionId) {
      try {
        await getD1()
          .prepare(
            "UPDATE wallet_transactions SET status = 'failed' WHERE id = ? AND status = 'pending'",
          )
          .bind(transactionId)
          .run();
      } catch {
        // The failed invoice remains pending for later reconciliation.
      }
    }
    return Response.json(
      { error: "ساخت فاکتور انجام نشد. دوباره تلاش کنید." },
      { status: 502 },
    );
  }
}
