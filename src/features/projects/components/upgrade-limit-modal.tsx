"use client";

import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CreditCard,
  Lock,
  Sparkles,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const UpgradeLimitModal = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const router = useRouter();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-hidden border-border/60 bg-card/95 p-0 shadow-2xl shadow-black/20 ring-1 ring-white/10 backdrop-blur-2xl sm:rounded-2xl dark:shadow-black/50">
        <div className="relative h-36 w-full overflow-hidden bg-gradient-to-b from-primary/15 via-primary/5 to-transparent">
          <div
            className="absolute inset-0 opacity-50"
            style={{
              backgroundImage: `linear-gradient(to right, oklch(0.5 0 0 / 8%) 1px, transparent 1px), linear-gradient(to bottom, oklch(0.5 0 0 / 8%) 1px, transparent 1px)`,
              backgroundSize: "18px 18px",
            }}
          />
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-[180px] w-[180px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/35 opacity-50 blur-[56px]" />

          <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center">
            <div className="relative flex size-[4.5rem] items-center justify-center rounded-2xl border border-white/15 bg-background/70 shadow-xl backdrop-blur-xl dark:bg-background/50">
              <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/25 via-transparent to-transparent" />
              <Zap className="relative size-8 text-primary drop-shadow-sm" />
              <Sparkles className="absolute -right-2 -top-2 size-4 text-primary/70" />
              <Sparkles className="absolute -bottom-1.5 -left-1.5 size-3 text-primary/45" />
            </div>
          </div>
        </div>

        <div className="space-y-6 px-6 pb-6 pt-1">
          <DialogHeader className="space-y-3 text-center sm:text-center">
            <DialogTitle className="text-xl font-bold tracking-tight sm:text-2xl">
              Project limit reached
            </DialogTitle>
            <DialogDescription className="mx-auto max-w-[95%] text-[15px] leading-relaxed text-muted-foreground">
              You have used all{" "}
              <strong className="font-semibold text-foreground">
                3 free project slots
              </strong>
              . Upgrade to create more workspaces, unlock higher model tiers, and
              raise storage limits.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/25 px-3 py-2.5 text-left text-xs text-muted-foreground dark:bg-muted/15">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background/80 text-primary shadow-sm ring-1 ring-border/50">
              <CreditCard className="size-4" />
            </div>
            <p>
              Checkout runs on{" "}
              <span className="font-semibold text-foreground">Stripe</span> with
              encryption in transit. You are only charged when you confirm a plan.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Button
              type="button"
              size="lg"
              className="h-12 w-full gap-2 rounded-xl text-[15px] font-semibold shadow-md"
              onClick={() => {
                onOpenChange(false);
                router.push("/pricing");
              }}
            >
              View plans &amp; pricing
              <ArrowRight className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-11 w-full rounded-xl text-muted-foreground hover:text-foreground"
              onClick={() => onOpenChange(false)}
            >
              Maybe later
            </Button>
          </div>

          <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
            <Lock className="size-3 opacity-70" />
            No card stored in Orbit — billing is handled by Stripe
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};
