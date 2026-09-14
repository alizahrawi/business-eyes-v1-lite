import { env } from "cloudflare:workers";
import { getD1 } from "@/db";
import { authenticateTelegram } from "@/lib/telegram-auth";
import { boundedInteger, noStoreJson, readJsonBody, RequestValidationError } from "@/lib/request-security";

type RuntimeEnv = {
  HF_TOKEN?: string;
  HF_MODEL?: string;
  HF_TIMEOUT_MS?: string;
  TELEGRAM_BOT_TOKEN?: string;
  ALLOW_PREVIEW_MODE?: string;
  MAX_REPORTS_PER_MINUTE?: string;
  MAX_REPORTS_PER_DAY?: string;
};
const TONE_RULES = { formal: "رسمی، حرفه‌ای و روشن", compact: "بسیار کوتاه، بدون کلمات اضافه", result: "نتیجه‌محور با تأکید بر خروجی واقعی کار" } as const;
const TRIAL_SECONDS = 5 * 24 * 60 * 60;
const MAX_REQUEST_BYTES = 32 * 1024;

type RateLimitResult = { allowed: boolean; retryAfter: number };

async function consumeReportQuota(
  db: ReturnType<typeof getD1>,
  telegramUserId: string,
  now: number,
  runtime: RuntimeEnv,
): Promise<RateLimitResult> {
  const minuteLimit = boundedInteger(runtime.MAX_REPORTS_PER_MINUTE, 6, 1, 60);
  const dayLimit = boundedInteger(runtime.MAX_REPORTS_PER_DAY, 100, 1, 5000);
  const minuteWindow = Math.floor(now / 60) * 60;
  const dayWindow = Math.floor(now / 86400) * 86400;
  const minuteKey = `report:minute:${telegramUserId}:${minuteWindow}`;
  const dayKey = `report:day:${telegramUserId}:${dayWindow}`;

  const [minuteResult, dayResult] = await db.batch([
    db
      .prepare(
        `INSERT INTO api_rate_limits
          (key, telegram_user_id, scope, window_started_at, request_count, updated_at)
         VALUES (?, ?, 'report_minute', ?, 1, ?)
         ON CONFLICT(key) DO UPDATE SET
           request_count = request_count + 1,
           updated_at = excluded.updated_at
         RETURNING request_count AS requestCount`,
      )
      .bind(minuteKey, telegramUserId, minuteWindow, now),
    db
      .prepare(
        `INSERT INTO api_rate_limits
          (key, telegram_user_id, scope, window_started_at, request_count, updated_at)
         VALUES (?, ?, 'report_day', ?, 1, ?)
         ON CONFLICT(key) DO UPDATE SET
           request_count = request_count + 1,
           updated_at = excluded.updated_at
         RETURNING request_count AS requestCount`,
      )
      .bind(dayKey, telegramUserId, dayWindow, now),
    db.prepare("DELETE FROM api_rate_limits WHERE updated_at < ?").bind(now - 2 * 24 * 60 * 60),
  ]);

  const minuteCount = Number((minuteResult.results?.[0] as { requestCount?: unknown } | undefined)?.requestCount ?? 0);
  const dayCount = Number((dayResult.results?.[0] as { requestCount?: unknown } | undefined)?.requestCount ?? 0);
  if (minuteCount > minuteLimit) return { allowed: false, retryAfter: Math.max(1, 60 - (now - minuteWindow)) };
  if (dayCount > dayLimit) return { allowed: false, retryAfter: Math.max(1, dayWindow + 86400 - now) };
  return { allowed: true, retryAfter: 0 };
}

function previewReport(rawText: string, dateLabel: string) {
  const durationPattern = /((?:حدود\s*)?(?:نیم|یک|دو|سه|چهار|پنج|شش|هفت|هشت|نه|ده|\d+)\s*(?:ساعت|دقیقه))/i;
  const cleaned = rawText.replace(/\r/g, "").split(/\n+|(?<=[.!؟])\s+|،\s*(?=(?:بعد|سپس|عصر|صبح))/).map((item) => item.replace(/^[•\-*\d.\s]+/, "").trim()).filter((item) => item.length > 3).slice(0, 10);
  const items = cleaned.map((item) => {
    const duration = item.match(durationPattern)?.[1] ?? "زمان ثبت نشده";
    const title = item
      .replace(durationPattern, "")
      .replace(/^(صبح|ظهر|عصر|شب|بعد|سپس)\s*/i, "")
      .replace(/^هم\s+/i, "")
      .replace(/\s+در\s+(?=(?:پیاده‌سازی|بررسی|طراحی|توسعه|رفع|تکمیل|نوشتن))/i, " ")
      .replace(/\s+/g, " ")
      .replace(/[.!؟]+$/, "")
      .trim();
    return `• ${title} — ${duration}`;
  });
  return `گزارش کار روزانه — ${dateLabel}\n\n${items.join("\n")}`;
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<{ rawText?: unknown; tone?: unknown; dateLabel?: unknown; initData?: unknown }>(request, MAX_REQUEST_BYTES);
    const rawText = typeof body.rawText === "string" ? body.rawText.trim() : "";
    const dateLabel = typeof body.dateLabel === "string" ? body.dateLabel.slice(0, 80) : "امروز";
    const tone = typeof body.tone === "string" && body.tone in TONE_RULES ? body.tone as keyof typeof TONE_RULES : "formal";
    if (rawText.length < 8 || rawText.length > 5000) return noStoreJson({ error: "متن گزارش نامعتبر است." }, 400);

    const runtime = env as unknown as RuntimeEnv;
    const botToken = runtime.TELEGRAM_BOT_TOKEN;
    const hfToken = runtime.HF_TOKEN;
    if (!botToken) {
      if (runtime.ALLOW_PREVIEW_MODE === "true") return noStoreJson({ report: previewReport(rawText, dateLabel), mode: "preview" });
      return noStoreJson({ error: "سرویس احراز هویت تلگرام تنظیم نشده است." }, 503);
    }

    const initData = typeof body.initData === "string" ? body.initData : "";
    const user = await authenticateTelegram(initData, botToken);
    if (!user) return noStoreJson({ error: "ورود تلگرام معتبر نیست. برنامه را از داخل ربات باز کنید." }, 401);

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
      .bind(String(user.id), user.first_name, user.username || null, now, now + TRIAL_SECONDS, now, now)
      .run();
    const account = await db
      .prepare("SELECT trial_ends_at AS trialEndsAt, subscription_ends_at AS subscriptionEndsAt FROM telegram_users WHERE telegram_user_id = ?")
      .bind(String(user.id))
      .first<{ trialEndsAt: number; subscriptionEndsAt: number }>();
    if (!account || (account.trialEndsAt <= now && account.subscriptionEndsAt <= now)) {
      return noStoreJson(
        { error: "دوره دسترسی شما پایان یافته است. برای شارژ و خرید اشتراک، در ربات دستور /pay را بزنید.", accessExpired: true },
        402,
      );
    }

    const quota = await consumeReportQuota(db, String(user.id), now, runtime);
    if (!quota.allowed) {
      return noStoreJson(
        { error: "تعداد درخواست‌های شما بیش از حد مجاز است. کمی بعد دوباره تلاش کنید." },
        429,
        { "Retry-After": String(quota.retryAfter) },
      );
    }

    if (!hfToken) return noStoreJson({ report: previewReport(rawText, dateLabel), mode: "preview" });

    const prompt = `شما ویراستار گزارش کار روزانه فارسی هستید.

قوانین قطعی:
- هر فعالیت را در یک خط کوتاه، حرفه‌ای و قابل ارائه بنویس.
- زمان یا مدت را فقط اگر کاربر گفته است درج کن؛ در غیر این صورت «زمان ثبت نشده» بنویس.
- هیچ زمان، نتیجه، نام، عدد یا جزئیات جدیدی نساز.
- فعالیت‌های تکراری را ادغام کن.
- عبارت‌های محاوره‌ای و زمان‌های روز مثل صبح و عصر را از عنوان حذف کن.
- لحن خروجی: ${TONE_RULES[tone]}.
- هیچ توضیح، مقدمه یا Markdown اضافه‌ای خارج از قالب ننویس.

قالب دقیق:
گزارش کار روزانه — ${dateLabel}

• [عنوان فعالیت] — [مدت یا زمان ثبت نشده]`;

    let aiResponse: Response;
    try {
      aiResponse = await fetch("https://router.huggingface.co/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${hfToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: runtime.HF_MODEL || "Qwen/Qwen2.5-7B-Instruct-1M:fastest", messages: [{ role: "system", content: prompt }, { role: "user", content: rawText }], temperature: 0.1, max_tokens: 700 }),
        signal: AbortSignal.timeout(boundedInteger(runtime.HF_TIMEOUT_MS, 25000, 5000, 60000)),
      });
    } catch {
      return noStoreJson({ error: "سرویس هوشمند در زمان مناسب پاسخ نداد. دوباره تلاش کنید." }, 502);
    }
    if (!aiResponse.ok) return noStoreJson({ error: "سرویس هوشمند موقتاً پاسخ نداد. دوباره تلاش کنید." }, 502);
    const result = await aiResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
    const report = result.choices?.[0]?.message?.content?.trim();
    if (!report || report.length > 8000) return noStoreJson({ error: "گزارش معتبر تولید نشد." }, 502);
    return noStoreJson({ report, mode: "ai" });
  } catch (error) {
    if (error instanceof RequestValidationError) return noStoreJson({ error: "درخواست قابل پردازش نبود." }, error.status);
    console.error("Report generation failed", error instanceof Error ? error.message : "Unknown error");
    return noStoreJson({ error: "خطای داخلی رخ داد. دوباره تلاش کنید." }, 500);
  }
}
