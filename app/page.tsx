"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpLeft,
  Check,
  Clipboard,
  Clock3,
  FileCheck2,
  ListTodo,
  LoaderCircle,
  Send,
  Sparkles,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";

type TelegramUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
};

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        initDataUnsafe?: { user?: TelegramUser };
        ready: () => void;
        expand: () => void;
        openTelegramLink?: (url: string) => void;
        isVersionAtLeast?: (version: string) => boolean;
        setHeaderColor?: (color: string) => void;
        setBackgroundColor?: (color: string) => void;
        setBottomBarColor?: (color: string) => void;
      };
    };
  }
  interface Document {
    modelContext?: {
      registerTool: (
        tool: {
          name: string;
          title: string;
          description: string;
          inputSchema: object;
          annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
          execute: (input: unknown) => unknown;
        },
        options?: { signal?: AbortSignal },
      ) => void | Promise<void>;
    };
  }
}

const EXAMPLE = "صبح حدود یک ساعت باگ ورود کاربران را بررسی کردم. بعد با تیم محصول جلسه داشتم و درباره نسخه جدید داشبورد تصمیم گرفتیم. عصر هم API گزارش فروش را در دو ساعت پیاده‌سازی کردم.";
const tones = [
  { id: "formal", label: "رسمی" },
  { id: "compact", label: "خیلی مختصر" },
  { id: "result", label: "نتیجه‌محور" },
] as const;
type Tone = (typeof tones)[number]["id"];

function todayInPersian() {
  return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
}

function userDisplayName(user: TelegramUser | null) {
  if (!user) return "کاربر تلگرام";
  return [user.first_name, user.last_name].filter(Boolean).join(" ");
}

function userInitial(user: TelegramUser | null) {
  return user?.first_name?.trim().charAt(0).toUpperCase() || "U";
}

export default function Home() {
  const [rawText, setRawText] = useState("");
  const [tone, setTone] = useState<Tone>("formal");
  const [report, setReport] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<"ai" | "preview" | null>(null);
  const [accessExpired, setAccessExpired] = useState(false);
  const [telegramUser, setTelegramUser] = useState<TelegramUser | null>(null);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const dateLabel = useMemo(todayInPersian, []);

  useEffect(() => {
    let attempts = 0;
    const connectTelegram = () => {
      const webApp = window.Telegram?.WebApp;
      if (webApp) {
        webApp.ready();
        webApp.expand();
        if (webApp.isVersionAtLeast?.("6.1")) {
          webApp.setHeaderColor?.("#080a09");
          webApp.setBackgroundColor?.("#080a09");
        }
        if (webApp.isVersionAtLeast?.("7.10")) webApp.setBottomBarColor?.("#080a09");
        setTelegramUser(webApp.initDataUnsafe?.user ?? null);
        return;
      }
      attempts += 1;
      if (attempts < 20) window.setTimeout(connectTelegram, 100);
    };
    connectTelegram();
  }, []);

  useEffect(() => {
    if (!document.modelContext?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(
      document.modelContext.registerTool(
        {
          name: "prepare_daily_report",
          title: "آماده‌سازی گزارش روزانه",
          description: "متن فعالیت‌های روزانه را در فرم Business Eyes قرار می‌دهد و لحن گزارش را انتخاب می‌کند.",
          inputSchema: {
            type: "object",
            properties: {
              text: { type: "string", minLength: 8, maxLength: 5000 },
              tone: { type: "string", enum: ["formal", "compact", "result"] },
            },
            required: ["text"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: true },
          execute(input) {
            if (!input || typeof input !== "object") throw new Error("ورودی معتبر نیست.");
            const value = input as { text?: unknown; tone?: unknown };
            if (typeof value.text !== "string" || value.text.trim().length < 8 || value.text.length > 5000) {
              throw new Error("متن فعالیت‌ها باید بین ۸ تا ۵۰۰۰ نویسه باشد.");
            }
            const selectedTone = tones.some((item) => item.id === value.tone) ? value.tone as Tone : "formal";
            setRawText(value.text.trim());
            setTone(selectedTone);
            setReport("");
            setMode(null);
            return { prepared: true, tone: selectedTone, characterCount: value.text.trim().length };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  async function generateReport() {
    const text = rawText.trim();
    if (text.length < 8) {
      toast.error("کمی بیشتر درباره کارهای امروز بنویسید.");
      return;
    }
    setIsLoading(true);
    setCopied(false);
    setAccessExpired(false);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: text, tone, dateLabel, initData: window.Telegram?.WebApp.initData ?? "" }),
      });
      const data = (await response.json()) as { report?: string; mode?: "ai" | "preview"; error?: string; accessExpired?: boolean };
      if (data.accessExpired) setAccessExpired(true);
      if (!response.ok || !data.report) throw new Error(data.error || "ساخت گزارش انجام نشد.");
      setReport(data.report);
      setMode(data.mode ?? null);
      window.setTimeout(() => document.querySelector("#report-output")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ساخت گزارش انجام نشد.");
    } finally {
      setIsLoading(false);
    }
  }

  async function copyReport() {
    await navigator.clipboard.writeText(report);
    setCopied(true);
    toast.success("گزارش کپی شد.");
    window.setTimeout(() => setCopied(false), 1800);
  }

  function shareReport() {
    const url = `https://t.me/share/url?url=&text=${encodeURIComponent(report)}`;
    if (window.Telegram?.WebApp.openTelegramLink) window.Telegram.WebApp.openTelegramLink(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  }

  const avatar = (
    <span className="grid size-full place-items-center overflow-hidden rounded-full bg-[linear-gradient(135deg,#b8ffd9,#3fc983)] text-lg font-black text-[#07130c]">
      {telegramUser?.photo_url && !avatarFailed
        ? <img src={telegramUser.photo_url} alt={`عکس پروفایل ${userDisplayName(telegramUser)}`} className="size-full object-cover" referrerPolicy="no-referrer" onError={() => setAvatarFailed(true)} />
        : userInitial(telegramUser)}
    </span>
  );

  return (
    <main className="min-h-dvh overflow-x-hidden bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_15%_-10%,rgba(96,230,156,.12),transparent_28%),radial-gradient(circle_at_100%_55%,rgba(96,230,156,.05),transparent_22%)]" />
      <div className="relative mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-4 pb-36 pt-4 sm:px-7 sm:pt-7 lg:px-10">
        <header className="mb-9 flex items-center justify-between rounded-[1.8rem] border border-border bg-card/90 px-4 py-3 shadow-[0_18px_55px_rgba(0,0,0,.35)] sm:px-5">
          <div className="flex min-w-0 items-center gap-3" dir="ltr">
            <div className="size-12 shrink-0 overflow-hidden rounded-full border border-[#6f4528] bg-black shadow-[0_0_28px_rgba(174,93,35,.22)]">
              <img src="/business-eye-logo.jpg" alt="لوگوی Business Eyes" className="size-full object-cover" />
            </div>
            <div className="min-w-0 text-left"><h1 className="truncate text-base font-black tracking-tight text-white sm:text-lg">Business Eyes</h1><p className="mt-0.5 text-[.7rem] font-bold uppercase tracking-[.18em] text-muted-foreground">V1 Lite</p></div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border bg-[#0b0d0c] px-3 py-2 text-xs text-muted-foreground sm:text-sm"><Clock3 className="size-4 text-accent" /><span className="hidden sm:inline">{dateLabel}</span><span className="sm:hidden">امروز</span></div>
        </header>

        <div className="mb-5 flex items-center justify-between px-1">
          <p className="flex items-center gap-2 text-xs font-black tracking-[.14em] text-muted-foreground"><span className="size-1.5 rounded-full bg-accent shadow-[0_0_10px_#61e69c]" />گزارش روزانه</p>
          <span className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1.5 text-xs font-black text-accent">آماده ثبت</span>
        </div>

        {accessExpired && <div className="mb-5 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm font-semibold leading-6 text-amber-100">دوره دسترسی تمام شده است. برای شارژ کیف پول و خرید اشتراک، در ربات دستور <span dir="ltr">/pay</span> را بزنید.</div>}

        <div className="grid flex-1 items-start gap-5 lg:grid-cols-2">
          <section id="daily-input" className="scroll-mt-6 rounded-[2rem] border border-border bg-card p-4 shadow-[0_24px_70px_rgba(0,0,0,.24)] sm:p-6">
            <div className="mb-5 flex items-start gap-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-accent/20 bg-accent/10 text-accent"><ListTodo className="size-5" /></span>
              <div><p className="text-[.7rem] font-black uppercase tracking-[.15em] text-accent">Daily Input</p><h2 className="mt-1 text-base font-black text-white">امروز چه کارهایی انجام دادی؟</h2></div>
            </div>
            <Textarea value={rawText} onChange={(event) => setRawText(event.target.value)} placeholder="مثلاً: باگ پرداخت را رفع کردم، بعد یک ساعت جلسه برنامه‌ریزی داشتیم..." className="min-h-56 resize-none rounded-[1.4rem] border-border bg-[#090b0a] px-5 py-5 text-base leading-8 text-white shadow-inner placeholder:text-[#5f6461] focus-visible:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent/20 sm:min-h-64" maxLength={5000} aria-label="شرح فعالیت‌های روزانه" />
            <div className="mt-3 flex items-center justify-between gap-3">
              <button type="button" className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-2 text-sm font-bold text-accent transition hover:bg-accent/10" onClick={() => setRawText(EXAMPLE)}>دیدن نمونه<ArrowUpLeft className="size-4" /></button>
              <span className="text-xs tabular-nums text-muted-foreground">{rawText.length.toLocaleString("fa-IR")} / ۵٬۰۰۰</span>
            </div>
            <div className="my-5 h-px bg-border" />
            <fieldset>
              <legend className="mb-3 text-sm font-bold text-[#c9cecb]">لحن گزارش</legend>
              <div className="flex flex-wrap gap-2">
                {tones.map((item) => <button key={item.id} type="button" aria-pressed={tone === item.id} onClick={() => setTone(item.id)} className="min-h-11 rounded-2xl border border-border bg-[#0b0d0c] px-4 text-sm font-bold text-muted-foreground transition hover:border-[#3b433e] aria-pressed:border-accent/45 aria-pressed:bg-accent/10 aria-pressed:text-accent">{item.label}</button>)}
              </div>
            </fieldset>
            <Button type="button" size="lg" onClick={generateReport} disabled={isLoading} className="mt-6 h-14 w-full rounded-2xl bg-accent text-base font-black text-[#07120b] shadow-[0_12px_34px_rgba(87,218,145,.2)] hover:bg-[#76eeab]">
              {isLoading ? <><LoaderCircle className="size-5 animate-spin" />در حال مرتب‌کردن...</> : <><Sparkles className="size-5" />ساخت گزارش</>}
            </Button>
          </section>

          <section id="report-output" className="scroll-mt-6 rounded-[2rem] border border-border bg-card p-4 shadow-[0_24px_70px_rgba(0,0,0,.24)] sm:p-6" aria-live="polite">
            <div className="mb-5 flex items-start gap-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-accent/20 bg-accent/10 text-accent"><FileCheck2 className="size-5" /></span>
              <div className="flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-[.7rem] font-black uppercase tracking-[.15em] text-accent">Final Report</p><h2 className="mt-1 text-base font-black text-white">گزارش آماده</h2></div>{mode === "preview" && <span className="rounded-full border border-border bg-[#0b0d0c] px-2.5 py-1 text-xs font-bold text-muted-foreground">حالت نمایشی</span>}</div>
              </div>
            </div>
            {report ? <>
              <Textarea value={report} onChange={(event) => setReport(event.target.value)} className="min-h-[22rem] resize-none rounded-[1.4rem] border-accent/15 bg-[#090b0a] px-5 py-5 text-base leading-8 text-white shadow-inner focus-visible:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent/20" aria-label="گزارش نهایی" />
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Button type="button" variant="outline" size="lg" onClick={copyReport} className="h-12 rounded-2xl border-border bg-[#0b0d0c] font-bold text-white hover:bg-[#171b18] hover:text-white">{copied ? <Check /> : <Clipboard />}{copied ? "کپی شد" : "کپی گزارش"}</Button>
                <Button type="button" size="lg" onClick={shareReport} className="h-12 rounded-2xl bg-accent font-black text-[#07120b] hover:bg-[#76eeab]"><Send />ارسال</Button>
              </div>
            </> : <div className="grid min-h-[22rem] place-items-center rounded-[1.4rem] border border-dashed border-[#2a2e2b] bg-[#090b0a] p-8 text-center">
              <div><div className="mx-auto grid size-16 place-items-center rounded-full border border-accent/15 bg-accent/10 text-accent"><Sparkles className="size-6" /></div><p className="mt-4 font-black text-white">خروجی اینجا نمایش داده می‌شود</p><p className="mx-auto mt-2 max-w-64 text-sm leading-6 text-muted-foreground">فعالیت‌ها به یک گزارش کوتاه و آماده ارائه تبدیل می‌شوند.</p></div>
            </div>}
          </section>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 mx-auto flex w-[calc(100%-2rem)] max-w-xl items-center justify-center gap-3" dir="ltr">
        <nav className="flex h-[4.6rem] flex-1 items-center justify-around rounded-[2rem] border border-border bg-[#111412]/95 px-2 shadow-[0_20px_60px_rgba(0,0,0,.55)] backdrop-blur-xl" aria-label="دسترسی سریع">
          <a href="#daily-input" className="flex min-w-24 flex-col items-center justify-center gap-1 rounded-2xl py-2 text-accent transition hover:bg-white/5"><ListTodo className="size-5" /><span className="text-[.7rem] font-bold">نوشتن</span></a>
          <a href="#report-output" className="flex min-w-24 flex-col items-center justify-center gap-1 rounded-2xl py-2 text-muted-foreground transition hover:bg-white/5 hover:text-white"><FileCheck2 className="size-5" /><span className="text-[.7rem] font-bold">خروجی</span></a>
        </nav>
        <div className="relative shrink-0">
          {profileOpen && <div className="absolute bottom-[calc(100%+12px)] right-0 w-64 rounded-3xl border border-border bg-[#111412]/98 p-4 text-right shadow-[0_20px_60px_rgba(0,0,0,.6)] backdrop-blur-xl" dir="rtl">
            <div className="flex items-center gap-3"><span className="size-11 shrink-0">{avatar}</span><div className="min-w-0"><p className="truncate text-sm font-black text-white">{userDisplayName(telegramUser)}</p><p className="mt-1 truncate text-xs text-muted-foreground" dir="ltr">{telegramUser?.username ? `@${telegramUser.username}` : "Telegram account"}</p></div></div>
            {!telegramUser && <p className="mt-3 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">پروفایل واقعی پس از بازکردن برنامه از داخل ربات نمایش داده می‌شود.</p>}
          </div>}
          <button type="button" aria-label={`حساب تلگرام ${userDisplayName(telegramUser)}`} aria-expanded={profileOpen} onClick={() => setProfileOpen((value) => !value)} className="size-[4.6rem] rounded-full border border-border bg-[#111412] p-1.5 shadow-[0_20px_60px_rgba(0,0,0,.55)] transition hover:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            {telegramUser ? avatar : <span className="grid size-full place-items-center rounded-full bg-[linear-gradient(135deg,#b8ffd9,#3fc983)] text-[#07130c]"><UserRound className="size-6" /></span>}
          </button>
        </div>
      </div>
      <Toaster position="top-center" theme="dark" />
    </main>
  );
}
