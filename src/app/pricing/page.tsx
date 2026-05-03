"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Check, Sparkles, Loader2, ArrowLeft, Zap, Shield, ArrowRight } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const TIERS = [
  {
    id: "basic",
    name: "Basic",
    price: "₹1,000",
    description: "Perfect for solo builders and hobby projects.",
    icon: Sparkles,
    features: [
      "10 AI Projects Limit",
      "Standard AI Model Access",
      "Community Support",
      "5GB Storage",
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
      "50 AI Projects Limit",
      "Advanced AI Models (GPT-4)",
      "Priority Support",
      "25GB Storage",
      "Custom Domains",
      "GitHub Integration",
    ],
  },
  {
    id: "advance",
    name: "Advanced",
    price: "₹5,000",
    description: "Scale your team with enterprise-grade features.",
    icon: Shield,
    features: [
      "Unlimited AI Projects",
      "All AI Models Unlocked",
      "Dedicated Support",
      "100GB Storage",
      "Custom Domains",
      "Team Collaboration",
      "Admin Dashboard",
      "Audit Logs",
    ],
  },
];

const PricingPage = () => {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [loadingTier, setLoadingTier] = useState<string | null>(null);
  const activeSub = useQuery(api.subscriptions.getActive);
  const isSubscribed = !!activeSub;

  const handleSubscribe = async (tier: string) => {
    try {
      if (!isLoaded) {
        return;
      }

      if (!isSignedIn) {
        router.push(`/sign-in?redirect_url=${encodeURIComponent("/pricing")}`);
        return;
      }

      setLoadingTier(tier);
      const token = await getToken();
      const headers: HeadersInit = { "Content-Type": "application/json" };

      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const res = await fetch("/api/stripe/create-checkout", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ tier }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create checkout");

      window.location.href = data.url;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong.";
      toast.error(message);
      setLoadingTier(null);
    }
  };

  return (
    <div className="relative min-h-screen bg-background overflow-hidden text-foreground selection:bg-primary/20">
      {}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,#2a2a2a_0%,transparent_100%)] opacity-40" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:32px_32px]" />
        {}
        <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 h-[500px] w-[800px] rounded-[100%] bg-primary/10 opacity-30 blur-[100px] mix-blend-screen" />
      </div>

      {}
      <header className="relative z-10 flex items-center justify-between p-6 max-w-6xl mx-auto w-full transition-all duration-300">
        <button
          onClick={() => router.push("/dashboard")}
          className="group flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-all duration-300"
        >
          <div className="rounded-full bg-muted/50 p-1.5 transition-colors group-hover:bg-muted">
            <ArrowLeft className="size-4 -translate-x-0.5 transition-transform group-hover:-translate-x-1" />
          </div>
          Back to Dashboard
        </button>
        <div className="flex items-center space-x-2 select-none">
          <div className="w-8 h-8 rounded-lg bg-foreground flex items-center justify-center shadow-lg shadow-foreground/10">
            <span className="text-background font-mono font-bold text-sm">O</span>
          </div>
          <span className="font-semibold text-lg tracking-tight">Orbit</span>
        </div>
      </header>

      {}
      <main className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 pt-8 pb-20 flex flex-col items-center">
        <div className="text-center mb-16 flex flex-col items-center max-w-2xl">
          <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1 font-mono text-[11px] font-medium text-primary backdrop-blur-md mb-6 shadow-[0_0_15px_rgba(var(--primary),0.1)]">
            <Sparkles className="size-3 mr-1.5" />
            Simple Pricing
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-b from-foreground via-foreground/90 to-foreground/40 pb-2">
            Build without limits
          </h1>
          <p className="mt-4 text-muted-foreground text-base sm:text-lg max-w-xl">
            Choose the perfect plan for your next big idea. Focus on building while we handle the rest.
          </p>
        </div>

        {}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8 w-full max-w-5xl">
          {TIERS.map((tier) => {
            const Icon = tier.icon;
            const isCurrentPlan = isSubscribed && activeSub.tier === tier.id;

            return (
              <div
                key={tier.id}
                className={cn(
                  "group relative flex flex-col rounded-3xl p-6 sm:p-8 transition-all duration-500",
                  "hover:-translate-y-1 hover:shadow-2xl",
                  tier.popular
                    ? "border-[1.5px] border-primary/50 bg-gradient-to-b from-background/90 to-background/50 shadow-xl shadow-primary/10 backdrop-blur-xl lg:-translate-y-3 lg:hover:-translate-y-4"
                    : "border border-border/50 bg-gradient-to-b from-background/60 to-background/20 backdrop-blur-lg hover:border-border/80"
                )}
              >
                {}
                {tier.popular && (
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-max z-10">
                    <div className="relative">
                      <div className="absolute inset-0 blur-[6px] bg-primary/30 rounded-full" />
                      <div className="relative px-4 py-1.5 bg-gradient-to-r from-primary to-primary/80 text-primary-foreground text-[10px] font-bold uppercase tracking-widest rounded-full shadow-md border border-primary-foreground/10 flex items-center gap-1.5">
                        <Zap className="size-3 hidden sm:block" />
                        Most Popular
                      </div>
                    </div>
                  </div>
                )}

                {}
                <div className="flex items-center gap-4 mb-4 mt-2">
                  <div
                    className={cn(
                      "p-3 rounded-2xl transition-colors duration-300",
                      tier.popular
                        ? "bg-primary/10 text-primary shadow-inner shadow-primary/20"
                        : "bg-surface-100 text-foreground/70 group-hover:text-foreground"
                    )}
                  >
                    <Icon className="size-5" />
                  </div>
                  <h3 className="text-2xl font-bold tracking-tight text-foreground">
                    {tier.name}
                  </h3>
                </div>

                <p className="text-[13px] text-muted-foreground/90 min-h-[40px] leading-relaxed">
                  {tier.description}
                </p>

                {}
                <div className="mt-6 mb-8 flex items-baseline gap-1.5 relative">
                  <div className="absolute -left-5 top-1/2 -translate-y-1/2 w-1 h-6 rounded-full bg-primary opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                  <span className="text-4xl sm:text-5xl font-black tracking-tighter text-foreground">
                    {tier.price}
                  </span>
                  <span className="text-muted-foreground text-sm font-semibold">
                    / per month
                  </span>
                </div>

                <div className="h-px w-full bg-gradient-to-r from-border/10 via-border/60 to-border/10 mb-8" />

                {}
                <ul className="space-y-4 mb-10 flex-1">
                  {tier.features.map((feature, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-3.5 text-[13px] font-medium text-muted-foreground transition-colors group-hover:text-foreground/90"
                    >
                      <div
                        className={cn(
                          "rounded-full shrink-0 flex items-center justify-center h-5 w-5 bg-opacity-20",
                          tier.popular ? "text-primary bg-primary/10" : "text-foreground/50 bg-foreground/5"
                        )}
                      >
                        <Check className="size-3" strokeWidth={3} />
                      </div>
                      <span className="leading-snug">{feature}</span>
                    </li>
                  ))}
                </ul>

                {}
                <div className="mt-auto">
                  {isCurrentPlan ? (
                    <div className="w-full h-12 rounded-xl bg-emerald-500/10 text-emerald-500 font-bold text-sm flex items-center justify-center gap-2 border border-emerald-500/20 shadow-sm">
                      <Check className="size-4.5" />
                      Active Plan
                    </div>
                  ) : (
                    <button
                      onClick={() => handleSubscribe(tier.id)}
                      disabled={!isLoaded || !!loadingTier || isSubscribed}
                      className={cn(
                        "relative w-full h-12 rounded-xl font-bold text-sm transition-all duration-300 flex items-center justify-center gap-2 overflow-hidden",
                        tier.popular
                          ? "bg-primary text-primary-foreground shadow-[0_0_20px_-5px] shadow-primary/40 hover:bg-primary/90 hover:scale-[1.02]"
                          : "bg-surface-100 hover:bg-muted text-foreground border border-border/50 hover:border-border hover:scale-[1.02]",
                        (!!loadingTier || isSubscribed) &&
                          "opacity-50 cursor-not-allowed hover:scale-100"
                      )}
                    >
                      {loadingTier === tier.id ? (
                        <Loader2 className="size-4.5 animate-spin" />
                      ) : (
                        <span className="flex items-center gap-1.5 relative z-10">
                          Get {tier.name}
                          <ArrowRight className={cn(
                            "size-4 transition-transform duration-300",
                            tier.popular ? "group-hover:translate-x-0.5" : ""
                          )} />
                        </span>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {}
        <div className="mt-16 text-center animate-in fade-in duration-1000 delay-500">
          <div className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-muted/40 border border-border/50 backdrop-blur-sm">
            <Shield className="size-3.5 text-muted-foreground" />
            <p className="text-[12px] font-medium text-muted-foreground">
              Secure payments processed by{" "}
              <span className="font-bold text-foreground">Stripe</span>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default PricingPage;
