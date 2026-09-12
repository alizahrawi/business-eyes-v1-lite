"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Clock3, LoaderCircle, LockKeyhole, ReceiptText, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toaster } from "@/components/ui/sonner";

type Transaction = {
  id: string;
  amountStars: number;
  creditDelta: number;
  status: string;
  createdAt: number;
  completedAt?: number | null;
};

const presets = [50, 100, 250, 500];

function normalizeDigits(value: string) {
  return value
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[^0-9]/g, "");
}

export default function PayPage() {
  const [amount, setAmount] = useState("100");
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPaying, setIsPaying] = useState(false);
  const [mode, setMode] = useState<"live" | "setup_required" | null>(null);

  const loadWallet = useCallback(async () => {
    try {
      const initData = window.Telegram?.WebApp.initData || "";
      const response = await fetch(`/api/wallet?initData=${encodeURIComponent(initData)}`);
      const data = await response.json() as {
        balance?: number;
        transactions?: Transaction[];
        mode?: "live" | "setup_required";
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "دریافت موجودی انجام نشد.");
      setBalance(Number(data.balance || 0));
      setTransactions(data.transactions || []);
      setMode(data.mode || null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "کیف پول در دسترس نیست.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let attempts = 0;
    const connect = () => {
      if (window.Telegram?.WebApp) {
        window.Telegram.WebApp.ready();
        window.Telegram.WebApp.expand();
        void loadWallet();
        return;
      }
      attempts += 1;
      if (attempts < 20) window.setTimeout(connect, 100);
      else void loadWallet();
    };
    connect();
  }, [loadWallet]);

  async function startPayment() {
    const numericAmount = Number(amount);
    if (!Number.isInteger(numericAmount) || numericAmount < 10 || numericAmount > 2500) {
      toast.error("مبلغ باید بین ۱۰ تا ۲۵۰۰ استار باشد.");
      return;
    }
    if (!window.Telegram?.WebApp.openInvoice) {
      toast.error("پرداخت را از داخل ربات تلگرام باز کنید.");
      return;
    }

    setIsPaying(true);
    try {
      const response = await fetch("/api/pay/create-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: numericAmount,
          initData: window.Telegram.WebApp.initData,
        }),
      });
      const data = await response.json() as { invoiceUrl?: string; error?: string };
      if (!response.ok || !data.invoiceUrl) throw new Error(data.error || "فاکتور ساخته نشد.");

      window.Telegram.WebApp.openInvoice(data.invoiceUrl, (status) => {
        if (status === "paid") {
          toast.success("پرداخت انجام شد؛ موجودی در حال به‌روزرسانی است.");
          window.setTimeout(() => void loadWallet(), 1200);
          window.setTimeout(() => void loadWallet(), 3000);
        } else if (status === "failed") {
          toast.error("پرداخت ناموفق بود.");
        }
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "پرداخت آغاز نشد.");
    } finally {
      setIsPaying(false);
    }
  }

  return (
    <main className="min-h-dvh overflow-x-hidden bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_85%_-10%,rgba(36,193,203,.2),transparent_32%),radial-gradient(circle_at_0%_90%,rgba(70,91,178,.14),transparent_30%)]" />
      <div className="relative mx-auto min-h-dvh w-full max-w-2xl px-4 pb-12 pt-5 sm:px-7">
        <header className="mb-6 flex items-center justify-between">
          <Button asChild variant="ghost" className="h-11 rounded-2xl px-3 font-bold">
            <a href="/"><ArrowRight />بازگشت</a>
          </Button>
          <div className="text-left"><p className="font-extrabold">کیف پول</p><p className="text-xs text-muted-foreground">پرداخت امن با Telegram Stars</p></div>
        </header>

        <section className="relative overflow-hidden rounded-[2rem] bg-primary p-6 text-primary-foreground shadow-[0_24px_60px_rgba(31,42,68,.25)] sm:p-8">
          <div className="absolute -left-10 -top-16 size-52 rounded-full bg-accent/20 blur-2xl" />
          <div className="relative flex items-start justify-between gap-5">
            <div><p className="text-sm text-white/65">موجودی قابل استفاده</p><div className="mt-3 flex items-end gap-2"><strong className="text-4xl font-black tabular-nums">{isLoading ? "—" : balance.toLocaleString("fa-IR")}</strong><span className="pb-1 text-sm font-bold text-white/70">اعتبار</span></div></div>
            <div className="grid size-14 place-items-center rounded-2xl bg-white/10 text-2xl shadow-inner">⭐</div>
          </div>
          <div className="relative mt-6 flex items-center gap-2 text-xs text-white/65"><Sparkles className="size-4 text-accent" />هر ۱ استار برابر ۱ اعتبار روزنگار است.</div>
        </section>

        {mode === "setup_required" && (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
            رابط کیف پول آماده است؛ پرداخت پس از اتصال توکن ربات فعال می‌شود.
          </div>
        )}

        <section className="mt-5 rounded-[2rem] border border-border/80 bg-card/90 p-5 shadow-[0_20px_55px_rgba(28,37,65,.07)] backdrop-blur sm:p-7">
          <div className="mb-5"><h1 className="text-lg font-extrabold">شارژ کیف پول</h1><p className="mt-1 text-sm leading-6 text-muted-foreground">تعداد استار دلخواه را وارد کنید.</p></div>
          <label htmlFor="star-amount" className="mb-2 block text-sm font-bold">مبلغ شارژ</label>
          <div className="relative">
            <Input id="star-amount" value={amount} onChange={(event) => setAmount(normalizeDigits(event.target.value))} inputMode="numeric" className="h-16 rounded-2xl bg-muted/45 pl-20 pr-5 text-xl font-black shadow-none" aria-describedby="amount-help" />
            <span className="absolute left-5 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">Stars ⭐</span>
          </div>
          <p id="amount-help" className="mt-2 text-xs text-muted-foreground">حداقل ۱۰ و حداکثر ۲۵۰۰ استار</p>
          <div className="mt-4 grid grid-cols-4 gap-2">
            {presets.map((value) => <button key={value} type="button" onClick={() => setAmount(String(value))} aria-pressed={amount === String(value)} className="min-h-11 rounded-xl border text-sm font-extrabold tabular-nums transition aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground">{value.toLocaleString("fa-IR")}</button>)}
          </div>
          <Button type="button" size="lg" disabled={isPaying || mode === "setup_required"} onClick={startPayment} className="mt-6 h-14 w-full rounded-2xl text-base font-extrabold shadow-[0_14px_30px_rgba(31,42,68,.18)]">
            {isPaying ? <><LoaderCircle className="animate-spin" />در حال ساخت فاکتور...</> : <>پرداخت با Telegram Stars</>}
          </Button>
          <div className="mt-4 flex items-start gap-2 text-xs leading-5 text-muted-foreground"><LockKeyhole className="mt-0.5 size-4 shrink-0 text-accent-foreground" />پرداخت در صفحه رسمی تلگرام انجام می‌شود و اطلاعات بانکی در اختیار روزنگار قرار نمی‌گیرد.</div>
        </section>

        <section className="mt-5 rounded-[2rem] border border-border/80 bg-card/90 p-5 sm:p-7">
          <h2 className="flex items-center gap-2 font-extrabold"><ReceiptText className="size-5 text-accent-foreground" />تراکنش‌های اخیر</h2>
          {transactions.length ? <div className="mt-4 divide-y divide-border">
            {transactions.map((item) => <div key={item.id} className="flex items-center justify-between gap-4 py-4">
              <div className="flex items-center gap-3">
                <span className={`grid size-10 place-items-center rounded-xl ${item.status === "completed" ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground"}`}>{item.status === "completed" ? <CheckCircle2 className="size-5" /> : <Clock3 className="size-5" />}</span>
                <div><p className="text-sm font-bold">شارژ کیف پول</p><p className="mt-1 text-xs text-muted-foreground">{item.status === "completed" ? "تکمیل‌شده" : item.status === "failed" ? "ناموفق" : "در انتظار پرداخت"}</p></div>
              </div>
              <strong className="text-sm tabular-nums">+{item.amountStars.toLocaleString("fa-IR")} ⭐</strong>
            </div>)}
          </div> : <p className="mt-4 rounded-2xl bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">هنوز تراکنشی ثبت نشده است.</p>}
        </section>
      </div>
      <Toaster position="top-center" />
    </main>
  );
}
