"use client";

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";
import { UserButton } from "@clerk/nextjs";
import { Plus, Search, Blocks } from "lucide-react";
import { motion } from "framer-motion";
import {
  adjectives,
  animals,
  colors,
  uniqueNamesGenerator,
} from "unique-names-generator";

import { Kbd } from "@/components/ui/kbd";

import { ProjectsCommandDialog } from "./projects-command-dialog";
import { ProjectsList } from "./projects-list";
import { useCreateProject } from "../hooks/use-projects";

export const ProjectsView = () => {
  const createProject = useCreateProject();
  const [commandOpen, setCommandOpen] = useState(false);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.1,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.6,
        ease: [0.22, 1, 0.36, 1],
      },
    },
  };

  const handleNewProject = useCallback(async () => {
    const projectName = uniqueNamesGenerator({
      dictionaries: [adjectives, animals, colors],
      separator: "_",
      length: 3,
    });

    await createProject({ name: projectName });
  }, [createProject]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isCmdOrCtrl = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (isCmdOrCtrl && key === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }

      if (isCmdOrCtrl && key === "j") {
        event.preventDefault();
        handleNewProject();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleNewProject]);

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-background">
      {/* Dynamic Background */}
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>
        <motion.div
          animate={{
            backgroundPosition: ["0px 0px", "0px -24px"],
          }}
          transition={{
            repeat: Number.POSITIVE_INFINITY,
            ease: "linear",
            duration: 5,
          }}
          className="absolute inset-x-0 bottom-0 top-[20%] z-0 bg-gradient-to-t from-background via-background/80 to-transparent"
        />
        <div className="absolute left-1/2 top-0 -ml-[50%] -mt-[10%] h-[600px] w-[1000px] rounded-full bg-primary/5 opacity-50 blur-[100px] pointer-events-none" />
      </div>

      <header className="relative z-10 flex items-center justify-between p-6 max-w-7xl mx-auto w-full">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
          className="flex items-center space-x-2"
        >
          <div className="w-8 h-8 rounded-sm bg-foreground flex items-center justify-center">
            <span className="text-background font-mono font-bold">O</span>
          </div>
          <span className="font-semibold text-lg tracking-tight">Orbit</span>
        </motion.div>
        
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
          className="flex items-center space-x-4 font-mono text-sm"
        >
          <UserButton />
        </motion.div>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-4 pb-6 mt-[-5vh]">
        <motion.div 
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="w-full max-w-lg"
        >
          <div className="flex flex-col items-center gap-8">
            <motion.div variants={itemVariants} className="space-y-3 text-center">
              <span className="inline-flex items-center rounded-full border border-border bg-muted/50 px-3 py-1 font-mono text-xs text-muted-foreground backdrop-blur-sm">
                <Blocks className="size-3.5 mr-2" />
                Workspace
              </span>
              <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl bg-clip-text text-transparent bg-gradient-to-b from-foreground to-foreground/70">
                Launch your next idea.
              </h1>
              <p className="text-sm md:text-base text-muted-foreground max-w-md mx-auto">
                Create a new agentic workspace or jump right back into an existing one.
              </p>
            </motion.div>

            <motion.div 
              variants={itemVariants}
              className="w-full overflow-hidden rounded-[20px] border border-border/80 bg-card/40 shadow-2xl backdrop-blur-xl"
            >
              <div className="p-2 pb-0">
                <button
                  onClick={handleNewProject}
                  className="group flex w-full items-center gap-4 rounded-2xl px-4 py-3 text-left transition-all duration-300 hover:bg-foreground hover:text-background"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-foreground text-background transition-colors duration-300 group-hover:bg-background group-hover:text-foreground">
                    <Plus className="size-5" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <span className="text-base font-semibold">
                      New Project
                    </span>
                    <p className="text-xs text-muted-foreground group-hover:text-background/70 transition-colors">
                      Scaffold an application instantly
                    </p>
                  </div>

                  <Kbd className="font-mono text-xs opacity-50 group-hover:text-background transition-all group-hover:border-background/20 group-hover:bg-background/10">
                    ⌘J
                  </Kbd>
                </button>
              </div>

              <div className="px-3 py-2">
                <button
                  onClick={() => setCommandOpen(true)}
                  className="group flex w-full items-center gap-3 rounded-xl border border-transparent bg-muted/30 px-4 py-2.5 text-left transition-all duration-200 hover:border-border hover:bg-muted/60"
                >
                  <Search className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground" />

                  <span className="flex-1 text-[13px] text-muted-foreground transition-colors group-hover:text-foreground">
                    Quick search projects…
                  </span>

                  <Kbd className="h-5 font-mono text-[10px] opacity-60">
                    ⌘K
                  </Kbd>
                </button>
              </div>

              <div className="border-t border-border/50" />

              <div className="p-2">
                <ProjectsList onViewAll={() => setCommandOpen(true)} />
              </div>
            </motion.div>
          </div>
        </motion.div>
      </main>

      <ProjectsCommandDialog open={commandOpen} onOpenChange={setCommandOpen} />
    </div>
  );
};
