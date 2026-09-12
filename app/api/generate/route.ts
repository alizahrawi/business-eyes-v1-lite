import { env } from "cloudflare:workers";
import { getD1 } from "@/db";
import { authenticateTelegram } from "@/lib/telegram-auth";

type RuntimeEnv = { HF_TOKEN?: string; HF_MODEL?: string; TELEGRAM_BOT_TOKEN?: string };
const TONE_RULES = { formal: "رسمی، حرفه‌ای و روشن", compact: "بسیار کوتاه، بدون کلمات اضافه", result: "نتیجه‌محور با تأکید بر خروجی واقعی کار" } as const;
const TRIAL_SECONDS = 5 * 24 * 60 * 60;

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
    const body = (await request.json()) as { rawText?: unknown; tone?: unknown; dateLabel?: unknown; initData?: unknown };
    const rawText = typeof body.rawText === "string" ? body.rawText.trim() : "";
    const dateLabel = typeof body.dateLabel === "string" ? body.dateLabel.slice(0, 80) : "امروز";
    const tone = typeof body.tone === "string" && body.tone in TONE_RULES ? body.tone as keyof typeof TONE_RULES : "formal";
    if (rawText.length < 8 || rawText.length > 5000) return Response.json({ error: "متن گزارش نامعتبر است." }, { status: 400 });

    const runtime = env as unknown as RuntimeEnv;
    const botToken = runtime.TELEGRAM_BOT_TOKEN;
    const hfToken = runtime.HF_TOKEN;
    if (!botToken) return Response.json({ report: previewReport(rawText, dateLabel), mode: "preview" });

    const initData = typeof body.initData === "string" ? body.initData : "";
    const user = await authenticateTelegram(initData, botToken);
    if (!user) return Response.json({ error: "ورود تلگرام معتبر نیست. برنامه را از داخل ربات باز کنید." }, { status: 401 });

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
      return Response.json(
        { error: "دوره دسترسی شما پایان یافته است. برای شارژ و خرید اشتراک، در ربات دستور /pay را بزنید.", accessExpired: true },
        { status: 402 },
      );
    }

    if (!hfToken) return Response.json({ report: previewReport(rawText, dateLabel), mode: "preview" });

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

    const aiResponse = await fetch("https://router.huggingface.co/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${hfToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: runtime.HF_MODEL || "Qwen/Qwen2.5-7B-Instruct-1M:fastest", messages: [{ role: "system", content: prompt }, { role: "user", content: rawText }], temperature: 0.1, max_tokens: 700 }),
    });
    if (!aiResponse.ok) return Response.json({ error: "سرویس هوشمند موقتاً پاسخ نداد. دوباره تلاش کنید." }, { status: 502 });
    const result = await aiResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
    const report = result.choices?.[0]?.message?.content?.trim();
    if (!report) return Response.json({ error: "گزارشی تولید نشد." }, { status: 502 });
    return Response.json({ report, mode: "ai" });
  } catch {
    return Response.json({ error: "درخواست قابل پردازش نبود." }, { status: 400 });
  }
}
