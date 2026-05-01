import { motion } from "framer-motion";
import { BotIcon, Code2Icon, FileCode2Icon, TerminalIcon, SparklesIcon } from "lucide-react";

export const OrbitBuildingAnimation = () => {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center overflow-hidden bg-background">
      {/* 
        Fixed height container so the orbits don't overlap the text 
      */}
      <div className="relative flex h-[350px] w-full items-center justify-center">
        
        {/* Core background glow */}
        <div className="absolute size-64 rounded-full bg-primary/5 blur-[80px]" />
        <div className="absolute size-32 rounded-full bg-primary/20 blur-[50px] animate-pulse" />

        {/* Outer Orbit */}
        <motion.div
          className="absolute rounded-full border border-primary/20 border-dashed"
          style={{ width: "320px", height: "320px" }}
          animate={{ rotate: 360 }}
          transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
        >
          {/* Icon wrapper to counter-rotate so icons stay upright */}
          <motion.div
            className="absolute -top-4 left-1/2 flex size-8 -translate-x-1/2 items-center justify-center rounded-full bg-background/80 backdrop-blur-md border border-primary/30 text-primary"
            style={{ boxShadow: "0 0 15px rgba(99, 102, 241, 0.2)" }}
            animate={{ rotate: -360 }}
            transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
          >
            <TerminalIcon className="size-4" />
          </motion.div>
          <motion.div
            className="absolute -bottom-4 left-1/2 flex size-8 -translate-x-1/2 items-center justify-center rounded-full bg-background/80 backdrop-blur-md border border-primary/30 text-primary"
            style={{ boxShadow: "0 0 15px rgba(99, 102, 241, 0.2)" }}
            animate={{ rotate: -360 }}
            transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
          >
            <FileCode2Icon className="size-4" />
          </motion.div>
        </motion.div>

        {/* Middle Orbit */}
        <motion.div
          className="absolute rounded-full border border-primary/20"
          style={{ width: "220px", height: "220px" }}
          animate={{ rotate: -360 }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
        >
          <motion.div
            className="absolute -left-4 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-background/80 backdrop-blur-md border border-primary/40 text-primary"
            style={{ boxShadow: "0 0 15px rgba(99, 102, 241, 0.3)" }}
            animate={{ rotate: 360 }}
            transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          >
            <Code2Icon className="size-4" />
          </motion.div>
          <motion.div
            className="absolute -right-4 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-background/80 backdrop-blur-md border border-primary/40 text-primary"
            style={{ boxShadow: "0 0 15px rgba(99, 102, 241, 0.3)" }}
            animate={{ rotate: 360 }}
            transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          >
            <SparklesIcon className="size-4" />
          </motion.div>
        </motion.div>

        {/* Inner Solid Ring (Decor) */}
        <div className="absolute rounded-full border-[1.5px] border-primary/10" style={{ width: "120px", height: "120px" }} />

        {/* Center AI Bot */}
        <div 
          className="relative z-10 flex size-20 items-center justify-center rounded-full bg-gradient-to-br from-primary via-primary to-primary/50 ring-4 ring-primary/20 ring-offset-2 ring-offset-background"
          style={{ boxShadow: "0 0 40px rgba(99, 102, 241, 0.4)" }}
        >
          <BotIcon className="size-8 text-primary-foreground drop-shadow-md animate-pulse" />
        </div>
      </div>

      {/* Building Text */}
      <div className="flex flex-col items-center space-y-3 z-20">
        <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-1.5 drop-shadow-sm">
          Building your project
          <span className="flex space-x-0.5 ml-1">
            <motion.span
              animate={{ opacity: [0, 1, 0] }}
              transition={{ duration: 1.5, repeat: Infinity, delay: 0 }}
            >
              .
            </motion.span>
            <motion.span
              animate={{ opacity: [0, 1, 0] }}
              transition={{ duration: 1.5, repeat: Infinity, delay: 0.2 }}
            >
              .
            </motion.span>
            <motion.span
              animate={{ opacity: [0, 1, 0] }}
              transition={{ duration: 1.5, repeat: Infinity, delay: 0.4 }}
            >
              .
            </motion.span>
          </span>
        </h2>
        <p className="max-w-sm text-center text-sm leading-6 text-muted-foreground">
          Orbit AI is actively generating files, analyzing logic, and configuring your workspace.
        </p>
      </div>
    </div>
  );
};
