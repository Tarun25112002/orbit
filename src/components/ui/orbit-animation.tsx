"use client";

import { motion } from "framer-motion";

export const OrbitAnimation = () => {
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 z-0 -translate-x-1/2 -translate-y-1/2 opacity-30 md:opacity-50">
      {/* Radial fade to blur out the edges so it blends to the canvas */}
      <div className="absolute inset-0 z-10 rounded-full bg-[radial-gradient(circle,transparent_40%,var(--background)_70%)] pointer-events-none scale-150" />
      
      <div className="relative flex items-center justify-center">
        {/* Core center node */}
        <div className="absolute size-3 rounded-full bg-foreground/30 shadow-[0_0_20px_var(--foreground)] blur-[1px]" />

        {/* Inner Ring */}
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
          className="absolute size-[300px] rounded-full border border-dashed border-foreground/20"
        >
          <div className="absolute left-1/2 top-0 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground border border-background shadow-[0_0_15px_var(--foreground)]" />
        </motion.div>

        {/* Middle Ring */}
        <motion.div
          animate={{ rotate: -360 }}
          transition={{ duration: 65, repeat: Infinity, ease: "linear" }}
          className="absolute size-[500px] rounded-full border border-solid border-foreground/10"
        >
          <div className="absolute right-[14%] top-[14%] size-1.5 rounded-full bg-muted-foreground shadow-sm" />
          <div className="absolute bottom-[14%] left-[14%] size-3 rounded-full bg-primary/80 border border-background blur-[0.5px]" />
        </motion.div>

        {/* Outer Ring */}
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 90, repeat: Infinity, ease: "linear" }}
          className="absolute size-[750px] rounded-full border border-dashed border-foreground/10"
        >
          <div className="absolute bottom-0 left-1/2 size-2 -translate-x-1/2 translate-y-1/2 rounded-full bg-emerald-500/60 shadow-[0_0_20px_#10b981]" />
        </motion.div>
      </div>
    </div>
  );
};
