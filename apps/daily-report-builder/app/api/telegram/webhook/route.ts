import { env } from "cloudflare:workers";
import { getD1 } from "@/db";
import { noStoreJson, readJsonBody, RequestValidationError } from "@/lib/request-security";
import { telegramApi } from "@/lib/telegram-api";

type RuntimeEnv = {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  APP_URL?: string;
  MONTHLY_PRICE_CREDITS?: string;
  QUARTERLY_PRICE_CREDITS?: string;
};

type TelegramPerson = { id: number; first_name?: string; username?: string };
type Payment = {
  currency: string;
  total_amount: number;
  invoice_payload: string;
  telegram_payment_charge_id: string;
  provider_payment_charge_id: string;
};
type TelegramUpdate = {
  update_id: number;
  pre_checkout_query?: {
    id: string;
    from: TelegramPerson;
    currency: string;
    total_amount: number;
    invoice_payload: string;
  };
  callback_query?: {
    id: string;
    from: TelegramPerson;
    data?: string;
    message?: { chat: { id: number } };
  };
  message?: {
    message_id: number;
    chat: { id: number };
    from?: TelegramPerson;
    text?: string;
    successful_payment?: Payment;
  };
};

const TRIAL_SECONDS = 5 * 24 * 60 * 60;
const TOP_UP_AMOUNTS = [50, 100, 250, 500];
const MIN_TOP_UP = 10;
const MAX_TOP_UP = 2500;
const MAX_WEBHOOK_BYTES = 256 * 1024;
const DEFAULT_APP_URL = "https://rooznegar-daily-report.zahrawi-biz.chatgpt.site";

function validWebhookSecret(value: string) {
  return /^[A-Za-z0-9_-]{32,256}$/.test(value);
}

function validTelegramPerson(person: TelegramPerson) {
  return Number.isSafeInteger(person.id) && person.id > 0
    && (person.first_name === undefined || (typeof person.first_name === "string" && person.first_name.length <= 128))
    && (person.username === undefined || (typeof person.username === "string" && /^[A-Za-z0-9_]{1,64}$/.test(person.username)));
}

function miniAppUrl(runtime: RuntimeEnv) {
  const url = new URL(runtime.APP_URL || DEFAULT_APP_URL);
  if (url.protocol !== "https:") throw new Error("APP_URL must use HTTPS");
  return url.toString();
}

function sameSecret(actual: string, expected: string) {
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

function positiveInteger(value?: string) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeNumber(value: string) {
  return value
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[٬,\s]/g, "");
}

function formatNumber(value: number) {
  return value.toLocaleString("fa-IR");
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    dateStyle: "medium",
    timeZone: "Asia/Tehran",
  }).format(new Date(timestamp * 1000));
}

async function ensureUser(person: TelegramPerson) {
  if (!validTelegramPerson(person)) throw new Error("Invalid Telegram user");
  const db = getD1();
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO telegram_users
        (telegram_user_id, first_name, username, trial_started_at, trial_ends_at,
         subscription_ends_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(telegram_user_id) DO UPDATE SET
         first_name = excluded.first_name,
         username = excluded.username,
         trial_started_at = CASE WHEN telegram_users.trial_started_at = 0 THEN excluded.trial_started_at ELSE telegram_users.trial_started_at END,
         trial_ends_at = CASE WHEN telegram_users.trial_ends_at = 0 THEN excluded.trial_ends_at ELSE telegram_users.trial_ends_at END,
         updated_at = excluded.updated_at`,
    )
    .bind(
      String(person.id),
      person.first_name?.slice(0, 128) || "",
      person.username?.slice(0, 64) || null,
      now,
      now + TRIAL_SECONDS,
      now,
      now,
    )
    .run();
}

async function getAccount(userId: number) {
  return getD1()
    .prepare(
      `SELECT u.trial_ends_at AS trialEndsAt,
              u.subscription_ends_at AS subscriptionEndsAt,
              COALESCE(SUM(CASE WHEN w.status = 'completed' THEN w.credit_delta ELSE 0 END), 0) AS balance
       FROM telegram_users u
       LEFT JOIN wallet_transactions w ON w.telegram_user_id = u.telegram_user_id
       WHERE u.telegram_user_id = ?
       GROUP BY u.telegram_user_id`,
    )
    .bind(String(userId))
    .first<{ trialEndsAt: number; subscriptionEndsAt: number; balance: number }>();
}

function accessText(account: { trialEndsAt: number; subscriptionEndsAt: number; balance: number }) {
  const now = Math.floor(Date.now() / 1000);
  if (account.subscriptionEndsAt > now) return `اشتراک فعال تا ${formatDate(account.subscriptionEndsAt)}`;
  if (account.trialEndsAt > now) return `دوره آزمایشی فعال تا ${formatDate(account.trialEndsAt)}`;
  return "دسترسی شما پایان یافته است";
}

function walletKeyboard(runtime: RuntimeEnv) {
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
    TOP_UP_AMOUNTS.slice(0, 2).map((amount) => ({ text: `${formatNumber(amount)} ⭐`, callback_data: `topup:${amount}` })),
    TOP_UP_AMOUNTS.slice(2).map((amount) => ({ text: `${formatNumber(amount)} ⭐`, callback_data: `topup:${amount}` })),
    [{ text: "✍️ مبلغ دلخواه", callback_data: "topup:custom" }],
  ];
  const monthly = positiveInteger(runtime.MONTHLY_PRICE_CREDITS);
  const quarterly = positiveInteger(runtime.QUARTERLY_PRICE_CREDITS);
  if (monthly) keyboard.push([{ text: `خرید یک‌ماهه — ${formatNumber(monthly)} اعتبار`, callback_data: "plan:monthly" }]);
  if (quarterly) keyboard.push([{ text: `خرید سه‌ماهه — ${formatNumber(quarterly)} اعتبار`, callback_data: "plan:quarterly" }]);
  return { inline_keyboard: keyboard };
}

async function sendWallet(botToken: string, runtime: RuntimeEnv, chatId: number, user: TelegramPerson) {
  await ensureUser(user);
  const account = await getAccount(user.id);
  if (!account) throw new Error("Account not found");
  const plansReady = positiveInteger(runtime.MONTHLY_PRICE_CREDITS) || positiveInteger(runtime.QUARTERLY_PRICE_CREDITS);
  await telegramApi(botToken, "sendMessage", {
    chat_id: chatId,
    text: `⭐ کیف پول Business Eyes\n\nموجودی: ${formatNumber(Number(account.balance))} اعتبار\nوضعیت: ${accessText(account)}\n\nبرای شارژ، تعداد استار را انتخاب کنید.${plansReady ? "\nپس از شارژ می‌توانید پلن را از همین‌جا بخرید." : ""}`,
    reply_markup: walletKeyboard(runtime),
  });
}

async function sendTopUpInvoice(botToken: string, chatId: number, userId: number, amount: number, updateId: number) {
  const db = getD1();
  const transactionId = `topup_${updateId}`;
  const payload = `wallet:${transactionId}`;
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT OR IGNORE INTO wallet_transactions
        (id, telegram_user_id, type, amount_stars, credit_delta, status, invoice_payload, created_at)
       VALUES (?, ?, 'top_up', ?, ?, 'pending', ?, ?)`,
    )
    .bind(transactionId, String(userId), amount, amount, payload, now)
    .run();
  await telegramApi(botToken, "sendInvoice", {
    chat_id: chatId,
    title: "شارژ کیف پول Business Eyes",
    description: `افزایش موجودی به اندازه ${formatNumber(amount)} اعتبار`,
    payload,
    provider_token: "",
    currency: "XTR",
    prices: [{ label: "اعتبار Business Eyes", amount }],
  });
}

async function buyPlan(botToken: string, runtime: RuntimeEnv, chatId: number, user: TelegramPerson, plan: "monthly" | "quarterly", updateId: number) {
  await ensureUser(user);
  const price = positiveInteger(plan === "monthly" ? runtime.MONTHLY_PRICE_CREDITS : runtime.QUARTERLY_PRICE_CREDITS);
  if (!price) {
    await telegramApi(botToken, "sendMessage", { chat_id: chatId, text: "قیمت این پلن هنوز تنظیم نشده است." });
    return;
  }

  const db = getD1();
  const now = Math.floor(Date.now() / 1000);
  const duration = (plan === "monthly" ? 30 : 90) * 24 * 60 * 60;
  const transactionId = `plan_${updateId}`;
  const type = plan === "monthly" ? "subscription_30d" : "subscription_90d";
  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO wallet_transactions
          (id, telegram_user_id, type, amount_stars, credit_delta, status, invoice_payload, created_at)
         SELECT ?, ?, ?, 0, ?, 'pending', ?, ?
         WHERE (SELECT COALESCE(SUM(credit_delta), 0) FROM wallet_transactions
                WHERE telegram_user_id = ? AND status = 'completed') >= ?`,
      )
      .bind(transactionId, String(user.id), type, -price, `purchase:${plan}`, now, String(user.id), price),
    db
      .prepare(
        `UPDATE telegram_users
         SET subscription_ends_at = (CASE WHEN subscription_ends_at > ? THEN subscription_ends_at ELSE ? END) + ?, updated_at = ?
         WHERE telegram_user_id = ?
           AND EXISTS (SELECT 1 FROM wallet_transactions WHERE id = ? AND status = 'pending')`,
      )
      .bind(now, now, duration, now, String(user.id), transactionId),
    db
      .prepare("UPDATE wallet_transactions SET status = 'completed', completed_at = ? WHERE id = ? AND status = 'pending'")
      .bind(now, transactionId),
  ]);

  const purchase = await db
    .prepare("SELECT id FROM wallet_transactions WHERE id = ? AND status = 'completed'")
    .bind(transactionId)
    .first();
  const account = await getAccount(user.id);
  if (!purchase || !account) {
    await telegramApi(botToken, "sendMessage", {
      chat_id: chatId,
      text: `موجودی کیف پول برای این خرید کافی نیست.\nقیمت پلن: ${formatNumber(price)} اعتبار\nبرای شارژ، /pay را بزنید.`,
    });
    return;
  }
  await telegramApi(botToken, "sendMessage", {
    chat_id: chatId,
    text: `✅ پلن ${plan === "monthly" ? "یک‌ماهه" : "سه‌ماهه"} فعال شد.\nدسترسی تا ${formatDate(account.subscriptionEndsAt)}\nموجودی: ${formatNumber(Number(account.balance))} اعتبار`,
    reply_markup: { inline_keyboard: [[{ text: "✍️ ورود به Business Eyes", web_app: { url: miniAppUrl(runtime) } }]] },
  });
}

export async function POST(request: Request) {
  const runtime = env as unknown as RuntimeEnv;
  const botToken = runtime.TELEGRAM_BOT_TOKEN;
  const webhookSecret = runtime.TELEGRAM_WEBHOOK_SECRET;
  if (!botToken || !webhookSecret || !validWebhookSecret(webhookSecret)) return new Response("Not configured", { status: 503 });
  const suppliedSecret = request.headers.get("x-telegram-bot-api-secret-token") || "";
  if (!sameSecret(suppliedSecret, webhookSecret)) return new Response("Unauthorized", { status: 401 });

  try {
    const update = await readJsonBody<TelegramUpdate>(request, MAX_WEBHOOK_BYTES);
    if (!Number.isSafeInteger(update.update_id) || update.update_id < 0) return noStoreJson({ error: "Invalid update" }, 400);
    const people = [update.pre_checkout_query?.from, update.callback_query?.from, update.message?.from].filter(Boolean) as TelegramPerson[];
    if (people.some((person) => !validTelegramPerson(person))) return noStoreJson({ error: "Invalid Telegram user" }, 400);
    const db = getD1();

    if (update.pre_checkout_query) {
      const query = update.pre_checkout_query;
      const transaction = await db
        .prepare(
          `SELECT id FROM wallet_transactions
           WHERE invoice_payload = ? AND telegram_user_id = ? AND amount_stars = ? AND status = 'pending'`,
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
    const payer = update.message?.from;
    if (payment && payer && payment.currency === "XTR") {
      const transactionId = payment.invoice_payload.startsWith("wallet:") ? payment.invoice_payload.slice(7) : "";
      const completedAt = Math.floor(Date.now() / 1000);
      const result = await db
        .prepare(
          `UPDATE wallet_transactions
           SET status = 'completed', telegram_payment_charge_id = ?, provider_payment_charge_id = ?, completed_at = ?
           WHERE id = ? AND telegram_user_id = ? AND amount_stars = ? AND status = 'pending'`,
        )
        .bind(payment.telegram_payment_charge_id, payment.provider_payment_charge_id, completedAt, transactionId, String(payer.id), payment.total_amount)
        .run();
      if (result.meta.changes > 0) {
        const account = await getAccount(payer.id);
        try {
          await telegramApi(botToken, "sendMessage", {
            chat_id: update.message?.chat.id,
            text: `✅ کیف پول ${formatNumber(payment.total_amount)} اعتبار شارژ شد.\nموجودی فعلی: ${formatNumber(Number(account?.balance || 0))} اعتبار\n\nبرای خرید اشتراک دوباره /pay را بزنید.`,
          });
        } catch {
          // The payment remains credited even if Telegram cannot send the confirmation.
        }
      }
      return Response.json({ ok: true });
    }

    const callback = update.callback_query;
    if (callback?.data && callback.message) {
      await telegramApi(botToken, "answerCallbackQuery", { callback_query_id: callback.id });
      const chatId = callback.message.chat.id;
      if (callback.data === "wallet:show") {
        await sendWallet(botToken, runtime, chatId, callback.from);
      } else if (callback.data === "topup:custom") {
        const now = Math.floor(Date.now() / 1000);
        await ensureUser(callback.from);
        await db
          .prepare(
            `INSERT INTO bot_sessions (telegram_user_id, kind, expires_at, created_at)
             VALUES (?, 'awaiting_topup_amount', ?, ?)
             ON CONFLICT(telegram_user_id) DO UPDATE SET kind = excluded.kind, expires_at = excluded.expires_at, created_at = excluded.created_at`,
          )
          .bind(String(callback.from.id), now + 10 * 60, now)
          .run();
        await telegramApi(botToken, "sendMessage", {
          chat_id: chatId,
          text: `تعداد استار دلخواه را فقط به‌صورت عدد بفرستید.\nحداقل ${formatNumber(MIN_TOP_UP)} و حداکثر ${formatNumber(MAX_TOP_UP)} استار.`,
        });
      } else if (callback.data.startsWith("topup:")) {
        const amount = Number(callback.data.slice(6));
        if (TOP_UP_AMOUNTS.includes(amount)) {
          await ensureUser(callback.from);
          await sendTopUpInvoice(botToken, chatId, callback.from.id, amount, update.update_id);
        }
      } else if (callback.data === "plan:monthly" || callback.data === "plan:quarterly") {
        await buyPlan(botToken, runtime, chatId, callback.from, callback.data === "plan:monthly" ? "monthly" : "quarterly", update.update_id);
      }
      return Response.json({ ok: true });
    }

    const message = update.message;
    const sender = message?.from;
    if (!message || !sender) return Response.json({ ok: true });
    const command = message.text?.trim().split(/\s+/)[0].split("@")[0].toLowerCase();
    if (command === "/start") {
      await ensureUser(sender);
      const account = await getAccount(sender.id);
      if (!account) throw new Error("Account not found");
      const now = Math.floor(Date.now() / 1000);
      const active = account.trialEndsAt > now || account.subscriptionEndsAt > now;
      await telegramApi(botToken, "sendMessage", {
        chat_id: message.chat.id,
        text: `سلام ${sender.first_name || ""} 👋\n${accessText(account)}\n\nکارهای امروزت را بنویس و یک گزارش کوتاه و آماده تحویل بگیر.`,
        reply_markup: active
          ? { inline_keyboard: [[{ text: "✍️ ورود به Business Eyes", web_app: { url: miniAppUrl(runtime) } }], [{ text: "⭐ کیف پول و اشتراک", callback_data: "wallet:show" }]] }
          : { inline_keyboard: [[{ text: "⭐ شارژ کیف پول و تمدید", callback_data: "wallet:show" }]] },
      });
      return Response.json({ ok: true });
    }
    if (command === "/pay" || command === "/balance" || command === "/status") {
      await sendWallet(botToken, runtime, message.chat.id, sender);
      return Response.json({ ok: true });
    }
    if (command === "/paysupport") {
      await telegramApi(botToken, "sendMessage", { chat_id: message.chat.id, text: "برای پیگیری پرداخت، همین‌جا شناسه تراکنش و توضیح مشکل را ارسال کنید تا پشتیبانی بررسی کند." });
      return Response.json({ ok: true });
    }
    if (command === "/terms") {
      await telegramApi(botToken, "sendMessage", { chat_id: message.chat.id, text: "اعتبار کیف پول فقط برای خدمات Business Eyes قابل استفاده است. خرید اشتراک یک‌باره است و تمدید خودکار ندارد. پرداخت‌ها با Telegram Stars انجام می‌شوند." });
      return Response.json({ ok: true });
    }

    const session = await db
      .prepare("SELECT kind, expires_at AS expiresAt FROM bot_sessions WHERE telegram_user_id = ?")
      .bind(String(sender.id))
      .first<{ kind: string; expiresAt: number }>();
    const now = Math.floor(Date.now() / 1000);
    if (session?.kind === "awaiting_topup_amount" && session.expiresAt >= now && message.text) {
      const amount = Number(normalizeNumber(message.text.trim()));
      if (!Number.isSafeInteger(amount) || amount < MIN_TOP_UP || amount > MAX_TOP_UP) {
        await telegramApi(botToken, "sendMessage", { chat_id: message.chat.id, text: `یک عدد بین ${formatNumber(MIN_TOP_UP)} تا ${formatNumber(MAX_TOP_UP)} بفرستید.` });
      } else {
        await ensureUser(sender);
        await sendTopUpInvoice(botToken, message.chat.id, sender.id, amount, update.update_id);
        await db.prepare("DELETE FROM bot_sessions WHERE telegram_user_id = ?").bind(String(sender.id)).run();
      }
    } else if (session && session.expiresAt < now) {
      await db.prepare("DELETE FROM bot_sessions WHERE telegram_user_id = ?").bind(String(sender.id)).run();
      await telegramApi(botToken, "sendMessage", { chat_id: message.chat.id, text: "زمان واردکردن مبلغ تمام شد. دوباره /pay را بزنید." });
    }

    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof RequestValidationError) return noStoreJson({ error: "Invalid request" }, error.status);
    console.error("Telegram webhook failed", error instanceof Error ? error.message : "Unknown error");
    return new Response("Webhook processing failed", { status: 500 });
  }
}
