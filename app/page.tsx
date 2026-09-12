"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUpLeft, Check, Clipboard, Clock3, FileText, LoaderCircle, Send, Sparkles, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";

declare global {
  interface Window {
    Telegram?: { WebApp: { initData: string; ready: () => void; expand: () => void; openTelegramLink?: (url: string) => void; openInvoice?: (url: string, callback?: (status: "paid" | "cancelled" | "failed" | "pending") => void) => void } };
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
  return new Intl.DateTimeFormat("fa-IR-u-ca-persian", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
}

export default function Home() {
  const [rawText, setRawText] = useState("");
  const [tone, setTone] = useState<Tone>("formal");
  const [report, setReport] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<"ai" | "preview" | null>(null);
  const dateLabel = useMemo(todayInPersian, []);

  useEffect(() => {
    let attempts = 0;
    const connectTelegram = () => {
      if (window.Telegram?.WebApp) {
        window.Telegram.WebApp.ready();
        window.Telegram.WebApp.expand();
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
          description: "متن فعالیت‌های روزانه را در فرم روزنگار قرار می‌دهد و لحن گزارش را انتخاب می‌کند.",
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
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: text, tone, dateLabel, initData: window.Telegram?.WebApp.initData ?? "" }),
      });
      const data = (await response.json()) as { report?: string; mode?: "ai" | "preview"; error?: string };
      if (!response.ok || !data.report) throw new Error(data.error || "ساخت گزارش انجام نشد.");
      setReport(data.report);
      setMode(data.mode ?? null);
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

  return (
    <main className="min-h-dvh overflow-x-hidden bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_85%_-10%,rgba(36,193,203,.2),transparent_32%),radial-gradient(circle_at_0%_75%,rgba(70,91,178,.12),transparent_28%)]" />
      <div className="relative mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-4 pb-10 pt-5 sm:px-7 lg:px-10">
        <header className="mb-7 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-[0_10px_28px_rgba(31,42,68,.2)]"><FileText className="size-5" aria-hidden="true" /></div>
            <div><h1 className="text-lg font-extrabold tracking-tight">روزنگار</h1><p className="text-sm text-muted-foreground">گزارش امروز، مرتب و آماده</p></div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-full border border-border/70 bg-card/75 px-3 py-2 text-sm text-muted-foreground shadow-sm backdrop-blur sm:flex"><Clock3 className="size-4 text-accent-foreground" />{dateLabel}</div>
            <Button asChild variant="outline" className="h-11 rounded-2xl bg-card/80 px-3 font-bold shadow-sm">
              <a href="/pay"><WalletCards className="size-4" /><span className="hidden sm:inline">کیف پول</span></a>
            </Button>
          </div>
        </header>

        <div className="grid flex-1 items-start gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,.95fr)]">
          <section className="rounded-[2rem] border border-border/80 bg-card/90 p-4 shadow-[0_24px_70px_rgba(28,37,65,.08)] backdrop-blur sm:p-6">
            <div className="mb-5 flex items-start gap-4">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-sm font-black text-primary-foreground">۱</span>
              <div><h2 className="font-bold">امروز چه کارهایی انجام دادی؟</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">ساده و خودمانی بنویس؛ مرتب‌کردنش با من.</p></div>
            </div>
            <Textarea value={rawText} onChange={(event) => setRawText(event.target.value)} placeholder="مثلاً: صبح باگ پرداخت را رفع کردم، بعد یک ساعت جلسه برنامه‌ریزی داشتیم..." className="min-h-52 resize-none rounded-3xl border-0 bg-muted/65 px-5 py-5 text-base leading-8 shadow-none transition focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-ring sm:min-h-64" maxLength={5000} aria-label="شرح فعالیت‌های روزانه" />
            <div className="mt-3 flex items-center justify-between gap-3">
              <button type="button" className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-primary transition hover:bg-primary/5" onClick={() => setRawText(EXAMPLE)}>دیدن یک نمونه<ArrowUpLeft className="size-4" /></button>
              <span className="text-xs tabular-nums text-muted-foreground">{rawText.length.toLocaleString("fa-IR")} / ۵٬۰۰۰</span>
            </div>
            <div className="my-5 h-px bg-border/80" />
            <fieldset>
              <legend className="mb-3 text-sm font-bold">لحن گزارش</legend>
              <div className="flex flex-wrap gap-2">
                {tones.map((item) => <button key={item.id} type="button" aria-pressed={tone === item.id} onClick={() => setTone(item.id)} className="min-h-11 rounded-2xl border px-4 text-sm font-bold transition aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground">{item.label}</button>)}
              </div>
            </fieldset>
            <Button type="button" size="lg" onClick={generateReport} disabled={isLoading} className="mt-6 h-14 w-full rounded-2xl text-base font-extrabold shadow-[0_14px_30px_rgba(31,42,68,.2)]">
              {isLoading ? <><LoaderCircle className="size-5 animate-spin" />در حال مرتب‌کردن...</> : <><Sparkles className="size-5" />ساخت گزارش</>}
            </Button>
          </section>

          <section className="rounded-[2rem] border border-border/80 bg-card/90 p-4 shadow-[0_24px_70px_rgba(28,37,65,.08)] backdrop-blur sm:p-6" aria-live="polite">
            <div className="mb-5 flex items-start gap-4">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-sm font-black text-accent-foreground">۲</span>
              <div className="flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold">گزارش آماده</h2>{mode === "preview" && <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-bold text-secondary-foreground">حالت نمایشی</span>}</div>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">می‌توانی متن نهایی را قبل از ارسال ویرایش کنی.</p>
              </div>
            </div>
            {report ? <>
              <Textarea value={report} onChange={(event) => setReport(event.target.value)} className="min-h-72 resize-none rounded-3xl border-primary/10 bg-[#f8faff] px-5 py-5 text-base leading-8 shadow-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-secondary/40" aria-label="گزارش نهایی" />
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Button type="button" variant="outline" size="lg" onClick={copyReport} className="h-12 rounded-2xl font-bold">{copied ? <Check /> : <Clipboard />}{copied ? "کپی شد" : "کپی گزارش"}</Button>
                <Button type="button" size="lg" onClick={shareReport} className="h-12 rounded-2xl font-bold"><Send />ارسال</Button>
              </div>
            </> : <div className="grid min-h-72 place-items-center rounded-3xl border border-dashed border-border bg-muted/35 p-8 text-center">
              <div><div className="mx-auto grid size-14 place-items-center rounded-2xl bg-secondary text-secondary-foreground"><Sparkles className="size-6" /></div><p className="mt-4 font-bold">خروجی اینجا نمایش داده می‌شود</p><p className="mx-auto mt-2 max-w-64 text-sm leading-6 text-muted-foreground">متن شما به فعالیت‌های کوتاه، زمان‌دار و قابل ارائه تبدیل می‌شود.</p></div>
            </div>}
          </section>
        </div>
        <footer className="mt-6 flex items-center justify-center gap-2 text-center text-xs leading-5 text-muted-foreground"><span className="size-1.5 rounded-full bg-[#21b8c4]" />زمان یا نتیجه‌ای که ننوشته باشید، ساخته نمی‌شود.</footer>
      </div>
      <Toaster position="top-center" />
    </main>
  );
}
