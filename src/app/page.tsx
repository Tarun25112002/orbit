"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Github, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { adjectives, animals, colors, uniqueNamesGenerator } from "unique-names-generator";
import { useAuth, UserButton } from "@clerk/nextjs";
import { useCreateProject } from "@/features/projects/hooks/use-projects";

export default function Home() {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const createProject = useCreateProject();
  const [isCreating, setIsCreating] = useState(false);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.2,
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
      },
    },
  };

  const handleInitialize = async () => {
    if (isCreating) return;
    setIsCreating(true);

    try {
      const projectName = uniqueNamesGenerator({
        dictionaries: [adjectives, animals, colors],
        separator: "_",
        length: 3,
      });

      const projectId = await createProject({ name: projectName });
      if (projectId) {
        router.push(`/projects/${projectId}`);
      }
    } catch (error) {
      console.error("Failed to create project:", error);
      setIsCreating(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-background overflow-x-hidden selection:bg-primary/20 flex flex-col">
      {/* Subtle Background Animation */}
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
        <div className="absolute right-0 top-0 -mr-[50%] -mt-[25%] h-[1000px] w-[1000px] rounded-full bg-primary/5 opacity-50 blur-[100px] animate-pulse pointer-events-none" />
        <div className="absolute left-0 bottom-0 -ml-[50%] -mb-[25%] h-[800px] w-[800px] rounded-full bg-foreground/5 opacity-50 blur-[100px] animate-pulse pointer-events-none" />
      </div>

      <nav className="relative z-10 flex items-center justify-between p-6 max-w-7xl mx-auto w-full">
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
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground transition-colors hidden sm:flex items-center space-x-2"
          >
            <Github className="w-4 h-4" />
            <span>GitHub</span>
          </a>
          
          {isLoaded && !isSignedIn && (
            <>
              <Link 
                href="/sign-in"
                className="text-muted-foreground hover:text-foreground transition-colors ml-4"
              >
                Sign In
              </Link>
              <Link 
                href="/sign-up"
                className="px-4 py-1.5 border border-border rounded bg-foreground text-background hover:bg-foreground/90 transition-colors duration-300"
              >
                Sign Up
              </Link>
            </>
          )}

          {isLoaded && isSignedIn && (
            <>
              <Link
                href="/dashboard"
                className="px-4 py-2 border border-border rounded hover:bg-foreground hover:text-background transition-colors duration-300"
              >
                Dashboard
              </Link>
              <div className="flex items-center h-full pl-2">
                <UserButton />
              </div>
            </>
          )}
        </motion.div>
      </nav>

      <main className="relative z-10 flex flex-col items-center justify-center flex-1 px-6">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="max-w-4xl mx-auto text-center mt-[-10vh]"
        >
          <motion.div variants={itemVariants} className="mb-6">
            <span className="inline-flex items-center rounded-full border border-border bg-muted/50 px-3 py-1 font-mono text-xs text-muted-foreground backdrop-blur-sm">
              <span className="w-2 h-2 rounded-full bg-emerald-500 mr-2 animate-pulse" />
              Orbit Agentic Pipeline v2.0
            </span>
          </motion.div>

          <motion.h1
            variants={itemVariants}
            className="text-5xl md:text-7xl font-bold tracking-tighter mb-6 bg-clip-text text-transparent bg-gradient-to-b from-foreground to-foreground/50"
          >
            Code generation,
            <br />
            redefined.
          </motion.h1>

          <motion.p
            variants={itemVariants}
            className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto font-light leading-relaxed"
          >
            A high-performance intelligence layer that automates your development
            pipeline. Experience autonomous, self-healing, multi-agent project
            scaffolding.
          </motion.p>

          <motion.div
            variants={itemVariants}
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <button
              onClick={handleInitialize}
              disabled={isCreating}
              className="group flex items-center justify-center space-x-2 bg-foreground text-background px-8 py-4 rounded-md font-medium transition-transform active:scale-95 disabled:opacity-80 disabled:cursor-not-allowed w-full sm:w-auto"
            >
              {isCreating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Initializing...</span>
                </>
              ) : (
                <>
                  <span>Initialize Workspace</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </motion.div>
        </motion.div>
      </main>
    </div>
  );
}