import { env } from "cloudflare:workers";
import { getD1 } from "@/db";
import { telegramApi } from "@/lib/telegram-api";

type RuntimeEnv = {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  APP_URL?: string;
};

type Payment = {
  currency: string;
  total_amount: number;
  invoice_payload: string;
  telegram_payment_charge_id: string;
  provider_payment_charge_id: string;
};

function sameSecret(actual: string, expected: string) {
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

export async function POST(request: Request) {
  const runtime = env as unknown as RuntimeEnv;
  const botToken = runtime.TELEGRAM_BOT_TOKEN;
  const webhookSecret = runtime.TELEGRAM_WEBHOOK_SECRET;
  if (!botToken || !webhookSecret) return new Response("Not configured", { status: 503 });

  const suppliedSecret = request.headers.get("x-telegram-bot-api-secret-token") || "";
  if (!sameSecret(suppliedSecret, webhookSecret)) return new Response("Unauthorized", { status: 401 });

  try {
    const update = (await request.json()) as {
      pre_checkout_query?: {
        id: string;
        from: { id: number };
        currency: string;
        total_amount: number;
        invoice_payload: string;
      };
      message?: {
        chat: { id: number };
        from?: { id: number };
        text?: string;
        successful_payment?: Payment;
      };
    };
    const db = getD1();

    if (update.pre_checkout_query) {
      const query = update.pre_checkout_query;
      const transaction = await db
        .prepare(
          `SELECT id FROM wallet_transactions
           WHERE invoice_payload = ? AND telegram_user_id = ? AND amount_stars = ?
             AND status = 'pending'`,
        )
        .bind(query.invoice_payload, String(query.from.id), query.total_amount)
        .first();
      const valid = query.currency === "XTR" && Boolean(transaction);
      await telegramApi(botToken, "answerPreCheckoutQuery", {
        pre_checkout_query_id: query.id,
        ok: valid,
        ...(valid ? {} : { error_message: "این فاکتور معتبر نیست یا قبلاً استفاده شده است." }),
      });
      return Response.json({ ok: true });
    }

    const payment = update.message?.successful_payment;
    const payerId = update.message?.from?.id;
    if (payment && payerId && payment.currency === "XTR") {
      const transactionId = payment.invoice_payload.startsWith("wallet:")
        ? payment.invoice_payload.slice(7)
        : "";
      const completedAt = Math.floor(Date.now() / 1000);
      const result = await db
        .prepare(
          `UPDATE wallet_transactions
           SET status = 'completed', telegram_payment_charge_id = ?,
               provider_payment_charge_id = ?, completed_at = ?
           WHERE id = ? AND telegram_user_id = ? AND amount_stars = ?
             AND status = 'pending'`,
        )
        .bind(
          payment.telegram_payment_charge_id,
          payment.provider_payment_charge_id,
          completedAt,
          transactionId,
          String(payerId),
          payment.total_amount,
        )
        .run();

      if (result.meta.changes > 0) {
        const balance = await db
          .prepare(
            `SELECT COALESCE(SUM(credit_delta), 0) AS balance
             FROM wallet_transactions
             WHERE telegram_user_id = ? AND status = 'completed'`,
          )
          .bind(String(payerId))
          .first<{ balance: number }>();
        try {
          await telegramApi(botToken, "sendMessage", {
            chat_id: update.message?.chat.id,
            text: `✅ کیف پول شما ${payment.total_amount} اعتبار شارژ شد.\n\nموجودی فعلی: ⭐ ${Number(balance?.balance || 0)}`,
          });
        } catch {
          // Crediting must not be rolled back when confirmation messaging fails.
        }
      }
      return Response.json({ ok: true });
    }

    const command = update.message?.text?.trim().split(/\s+/)[0].split("@")[0];
    if (update.message && (command === "/pay" || command === "/start")) {
      const appUrl = runtime.APP_URL || "https://rooznegar-daily-report.zahrawi-biz.chatgpt.site";
      const isPay = command === "/pay";
      await telegramApi(botToken, "sendMessage", {
        chat_id: update.message.chat.id,
        text: isPay
          ? "برای افزایش اعتبار، کیف پول روزنگار را باز کنید و مقدار استار را وارد کنید."
          : "سلام 👋\nکارهای امروزت را بنویس تا به یک گزارش کوتاه و آماده تبدیل شوند.",
        reply_markup: {
          inline_keyboard: [[{
            text: isPay ? "⭐ شارژ کیف پول" : "✍️ ساخت گزارش امروز",
            web_app: { url: isPay ? `${appUrl}/pay` : appUrl },
          }]],
        },
      });
    }

    return Response.json({ ok: true });
  } catch {
    return new Response("Webhook processing failed", { status: 500 });
  }
}
