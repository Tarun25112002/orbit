"use client";

import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Sparkles, ArrowRight, Zap } from "lucide-react";

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
      <DialogContent className="max-w-md bg-card/95 border-white/10 p-0 sm:rounded-[28px] overflow-hidden shadow-[0_0_100px_-20px_rgba(255,255,255,0.1)] backdrop-blur-3xl">
        
        {/* Decorative Header Area */}
        <div className="relative h-40 w-full overflow-hidden bg-gradient-to-b from-primary/10 via-primary/5 to-transparent">
          {/* Subtle Grid Pattern */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:14px_14px]"></div>
          
          {/* Ambient Glow */}
          <div className="absolute left-1/2 top-1/2 -ml-[100px] -mt-[100px] h-[200px] w-[200px] rounded-full bg-primary/40 opacity-40 blur-[60px] pointer-events-none" />
          
          {/* Floating Icon Container */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 mt-2">
            <div className="relative flex items-center justify-center size-20 rounded-2xl border border-white/20 bg-background/60 shadow-2xl backdrop-blur-xl">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-primary/20 via-transparent to-transparent opacity-50" />
              <Zap className="size-8 text-primary drop-shadow-[0_0_10px_rgba(255,255,255,0.4)]" />
              
              {/* Decorative sparkles around icon */}
              <Sparkles className="absolute -top-3 -right-3 size-5 text-primary/60" />
              <Sparkles className="absolute -bottom-2 -left-2 size-3 text-primary/40" />
            </div>
          </div>
        </div>

        <div className="px-8 pb-8 pt-2">
          <DialogHeader className="text-center sm:text-center pb-6">
            <DialogTitle className="text-2xl font-bold tracking-tight text-foreground">
              Workspace Limit Reached
            </DialogTitle>
            <DialogDescription className="text-[15px] mt-3 leading-relaxed text-muted-foreground/90 max-w-[90%] mx-auto">
              You've used all <strong className="text-foreground font-semibold">3 free project slots</strong>. Upgrade your plan to unlock unlimited projects, faster AI models, and premium features.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 mt-2">
            <button
              onClick={() => {
                onOpenChange(false);
                router.push("/pricing");
              }}
              className="group relative w-full h-12 rounded-xl flex items-center justify-center gap-2 overflow-hidden bg-foreground text-background font-semibold text-[15px] transition-all hover:bg-foreground/90 active:scale-[0.98] shadow-lg shadow-foreground/10"
            >
              <span className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-background/10 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]" />
              Unlock Orbit Pro
              <ArrowRight className="size-4 group-hover:translate-x-1 transition-transform" />
            </button>
            <button
              onClick={() => onOpenChange(false)}
              className="w-full h-11 rounded-xl bg-transparent text-muted-foreground font-medium text-sm hover:text-foreground hover:bg-muted/50 transition-all active:scale-[0.98]"
            >
              Maybe later
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
