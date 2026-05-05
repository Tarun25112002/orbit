"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  ArrowLeft,
  ArrowRight,
  BadgeIndianRupee,
  Check,
  ChevronDown,
  CreditCard,
  Loader2,
  Lock,
  Shield,
  Sparkles,
  Zap,
} from "lucide-react";
import { motion, useReducedMotion, Variants } from "framer-motion";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TIERS = [
  {
    id: "basic",
    name: "Basic",
    price: "₹1,000",
    description: "Perfect for solo builders and hobby projects.",
    icon: Sparkles,
    popular: false,
    features: [
      "10 AI projects",
      "Standard model access",
      "Community support",
      "5 GB storage",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: "₹2,500",
    description: "For professionals shipping production apps.",
    icon: Zap,
    popular: true,
    features: [
      "50 AI projects",
      "Advanced models",
      "Priority support",
      "25 GB storage",
      "Custom domains",
      "GitHub integration",
    ],
  },
  {
    id: "advance",
    name: "Advanced",
    price: "₹5,000",
    description: "Scale your team with enterprise-grade features.",
    icon: Shield,
    popular: false,
    features: [
      "Unlimited AI projects",
      "All models unlocked",
      "Dedicated support",
      "100 GB storage",
      "Team collaboration",
      "Admin dashboard & audit logs",
    ],
  },
] as const;

const TRUST_POINTS = [
  { title: "Stripe Checkout", body: "Industry-standard PCI flow. We never store card numbers." },
  { title: "HTTPS everywhere", body: "Encrypted in transit from your browser to our edge." },
  { title: "INR pricing", body: "Clear local pricing. One-time checkout per plan selection." },
] as const;

const FAQ = [
  {
    q: "Is this a subscription?",
    a: "Checkout is a one-time payment for the selected plan tier. Renewal behavior can be extended later via Stripe billing if you choose.",
  },
  {
    q: "Can I change plans later?",
    a: "Yes. Pick a higher tier anytime — only the plan you confirm at checkout applies to your workspace limits.",
  },
  {
    q: "What happens after I pay?",
    a: "You are redirected to the dashboard and your plan activates automatically once Stripe confirms the session.",
  },
] as const;

const tierList: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.08, delayChildren: 0.06 },
  },
};

const tierItem: Variants = {
  hidden: { opacity: 0, y: 22 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] },
  },
};

const PricingPage = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [loadingTier, setLoadingTier] = useState<string | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const activeSub = useQuery(api.subscriptions.getActive);
  const isSubscribed = !!activeSub;
  const prefersReducedMotion = useReducedMotion();
  const motionSafe = useMemo(() => !prefersReducedMotion, [prefersReducedMotion]);

  useEffect(() => {
    if (searchParams.get("payment") !== "cancelled") return;
    toast.message("Checkout cancelled", {
      description: "No charges were made. Choose a plan whenever you are ready.",
    });
    router.replace("/pricing");
  }, [router, searchParams]);

  const handleSubscribe = async (tier: string) => {
    try {
      if (!isLoaded) return;

      if (!isSignedIn) {
        router.push(`/sign-in?redirect_url=${encodeURIComponent("/pricing")}`);
        return;
      }

      setLoadingTier(tier);
      const token = await getToken();
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch("/api/stripe/create-checkout", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ tier }),
      });

      const data = (await res.json()) as { error?: string; url?: string };
      if (!res.ok) throw new Error(data.error || "Failed to create checkout");
      if (!data.url) throw new Error("No checkout URL returned");

      window.location.href = data.url;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong.";
      toast.error(message);
      setLoadingTier(null);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground selection:bg-primary/20">
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,oklch(0.55_0.12_280/0.12),transparent_55%)] dark:bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,oklch(0.75_0.08_280/0.08),transparent_55%)]" />
        <div
          className="absolute inset-0 opacity-[0.4] dark:opacity-[0.25]"
          style={{
            backgroundImage: `linear-gradient(to right, oklch(0.5 0 0 / 6%) 1px, transparent 1px), linear-gradient(to bottom, oklch(0.5 0 0 / 6%) 1px, transparent 1px)`,
            backgroundSize: "40px 40px",
          }}
        />
        <div className="absolute -top-40 left-1/2 h-[420px] w-[min(90vw,720px)] -translate-x-1/2 rounded-full bg-primary/15 blur-[100px] dark:bg-primary/10" />
      </div>

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-6 sm:py-6">
        <Link
          href="/dashboard"
          className={cn(
            "group inline-flex items-center gap-2 rounded-full border border-transparent px-1 py-1 text-sm font-medium text-muted-foreground transition-colors hover:border-border/60 hover:bg-muted/40 hover:text-foreground",
          )}
        >
          <span className="flex size-8 items-center justify-center rounded-full bg-muted/60 transition-colors group-hover:bg-muted">
            <ArrowLeft className="size-4 -translate-x-px transition-transform group-hover:-translate-x-0.5" />
          </span>
          Dashboard
        </Link>
        <Link
          href="/"
          className="flex select-none items-center gap-2 rounded-lg px-2 py-1 transition-opacity hover:opacity-90"
        >
          <div className="flex size-9 items-center justify-center rounded-lg bg-foreground font-mono text-sm font-bold text-background shadow-md">
            O
          </div>
          <span className="text-lg font-semibold tracking-tight">Orbit</span>
        </Link>
      </header>

      <main className="relative z-10 mx-auto flex max-w-6xl flex-col items-center px-4 pb-24 pt-4 sm:px-6 sm:pt-6">
        <motion.div
          className="mb-14 flex max-w-2xl flex-col items-center text-center"
          initial={motionSafe ? { opacity: 0, y: 16 } : { opacity: 1, y: 0 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-widest text-primary shadow-sm backdrop-blur-md">
            <Sparkles className="size-3" />
            Pricing
          </div>
          <h1 className="text-balance bg-gradient-to-b from-foreground via-foreground to-foreground/55 bg-clip-text pb-1 text-4xl font-extrabold tracking-tight text-transparent sm:text-5xl sm:leading-[1.08]">
            Ship faster with the right limits
          </h1>
          <p className="mt-4 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            Transparent INR pricing, secure Stripe checkout, and plans tuned for
            solo builders through growing teams.
          </p>
        </motion.div>

        <motion.div
          className="grid w-full max-w-5xl grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-7"
          variants={tierList}
          initial={motionSafe ? "hidden" : "visible"}
          animate="visible"
        >
          {TIERS.map((tier) => {
            const Icon = tier.icon;
            const isCurrentPlan = isSubscribed && activeSub.tier === tier.id;
            const ctaLabel = isCurrentPlan
              ? "Current plan"
              : isSubscribed
                ? `Switch to ${tier.name}`
                : `Get ${tier.name}`;

            return (
              <motion.div
                key={tier.id}
                variants={tierItem}
                initial={motionSafe ? "hidden" : "visible"}
                animate="visible"
                className={cn(
                  "group relative flex flex-col rounded-2xl border p-6 sm:p-8",
                  "transition-[transform,box-shadow,border-color] duration-300",
                  motionSafe && "hover:-translate-y-0.5",
                  tier.popular
                    ? "border-primary/45 bg-gradient-to-b from-card via-card to-muted/30 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.35)] ring-1 ring-primary/20 dark:from-card dark:to-muted/15 dark:shadow-[0_28px_70px_-28px_rgba(0,0,0,0.55)] lg:-translate-y-1 lg:hover:-translate-y-1.5"
                    : "border-border/60 bg-card/80 shadow-sm backdrop-blur-sm hover:border-border hover:shadow-md dark:bg-card/50",
                )}
              >
                {tier.popular && (
                  <div className="absolute -top-3 left-1/2 z-10 w-max -translate-x-1/2">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary-foreground shadow-lg">
                      <Zap className="size-3 opacity-90" />
                      Most popular
                    </span>
                  </div>
                )}

                <div className="mb-4 mt-1 flex items-center gap-3">
                  <div
                    className={cn(
                      "flex size-11 items-center justify-center rounded-xl border transition-colors",
                      tier.popular
                        ? "border-primary/30 bg-primary/10 text-primary shadow-inner"
                        : "border-border/60 bg-muted/50 text-foreground/80 group-hover:border-border group-hover:bg-muted",
                    )}
                  >
                    <Icon className="size-5" />
                  </div>
                  <h2 className="text-2xl font-bold tracking-tight">{tier.name}</h2>
                </div>

                <p className="min-h-[44px] text-sm leading-relaxed text-muted-foreground">
                  {tier.description}
                </p>

                <div className="relative my-6 flex items-baseline gap-2 border-y border-border/50 py-6">
                  <span className="text-4xl font-black tracking-tight sm:text-[2.75rem]">
                    {tier.price}
                  </span>
                  <div className="flex flex-col items-start gap-0.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      one-time
                    </span>
                    <span className="text-xs text-muted-foreground/90">
                      per checkout
                    </span>
                  </div>
                </div>

                <ul className="mb-8 flex flex-1 flex-col gap-3.5">
                  {tier.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-3 text-[13px] leading-snug text-muted-foreground transition-colors group-hover:text-foreground/90"
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
                          tier.popular
                            ? "border-primary/25 bg-primary/10 text-primary"
                            : "border-border/80 bg-muted/40 text-foreground/70",
                        )}
                      >
                        <Check className="size-3" strokeWidth={2.5} />
                      </span>
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-auto space-y-2">
                  {isCurrentPlan ? (
                    <div className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                      <Check className="size-4" strokeWidth={2.5} />
                      Active on this workspace
                    </div>
                  ) : (
                    <Button
                      type="button"
                      size="lg"
                      variant={tier.popular ? "default" : "secondary"}
                      className={cn(
                        "h-12 w-full gap-2 rounded-xl text-sm font-semibold shadow-sm",
                        tier.popular &&
                          "shadow-[0_12px_40px_-16px_oklch(0.45_0.15_280/0.45)] dark:shadow-[0_16px_48px_-16px_oklch(0.7_0.12_280/0.25)]",
                      )}
                      disabled={!isLoaded || loadingTier !== null}
                      onClick={() => void handleSubscribe(tier.id)}
                    >
                      {loadingTier === tier.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <>
                          {ctaLabel}
                          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                        </>
                      )}
                    </Button>
                  )}
                  <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
                    <Lock className="size-3 shrink-0 opacity-70" />
                    Secure payment via Stripe
                  </p>
                </div>
              </motion.div>
            );
          })}
        </motion.div>

        <section className="mt-16 grid w-full max-w-4xl gap-4 sm:grid-cols-3">
          {TRUST_POINTS.map((item) => (
            <div
              key={item.title}
              className="rounded-xl border border-border/60 bg-muted/20 p-4 text-left shadow-sm backdrop-blur-sm dark:bg-muted/10"
            >
              <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-background/80 text-primary shadow-sm ring-1 ring-border/50 dark:bg-background/50">
                {item.title.includes("Stripe") ? (
                  <CreditCard className="size-4" />
                ) : item.title.includes("HTTPS") ? (
                  <Lock className="size-4" />
                ) : (
                  <BadgeIndianRupee className="size-4" />
                )}
              </div>
              <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                {item.body}
              </p>
            </div>
          ))}
        </section>

        <section className="mt-14 w-full max-w-2xl">
          <h3 className="mb-4 text-center text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Questions
          </h3>
          <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-card/60 shadow-sm backdrop-blur-md dark:bg-card/40">
            {FAQ.map((item, i) => {
              const open = openFaq === i;
              return (
                <div key={item.q}>
                  <button
                    type="button"
                    onClick={() => setOpenFaq(open ? null : i)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted/40"
                  >
                    <span>{item.q}</span>
                    <ChevronDown
                      className={cn(
                        "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
                        open && "-rotate-180",
                      )}
                    />
                  </button>
                  {open && (
                    <div className="border-t border-border/40 bg-muted/15 px-4 py-3 text-sm leading-relaxed text-muted-foreground dark:bg-muted/10">
                      {item.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <div className="mt-12 flex flex-wrap items-center justify-center gap-3 text-[12px] text-muted-foreground">
          <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/30 px-4 py-2 backdrop-blur-sm">
            <Shield className="size-3.5 text-primary" />
            <span>
              Payments processed by <strong className="font-semibold text-foreground">Stripe</strong>
            </span>
          </span>
        </div>
      </main>
    </div>
  );
};

const PricingPageWrapper = () => {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center"><div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>}>
      <PricingPage />
    </Suspense>
  );
};

export default PricingPageWrapper;
