"use client";

import {
  WebContainer,
  type Unsubscribe,
  type WebContainerProcess,
} from "@webcontainer/api";
import type { AiPipelineOperation } from "@/lib/ai-execution";

type RuntimeLogWriter = (line: string) => void;

type ServerReadyHandler = (args: { port: number; url: string }) => void;

type ServerReadyState = { port: number; url: string };

type BackgroundCommandExit = {
  code: number | null;
  errorMessage: string | null;
  at: number;
};

const WEBCONTAINER_RUNTIME_VERSION = 2;

const normalizePath = (rawPath: string) =>
  rawPath
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\/+/g, "/");

const toFsPath = (path: string) => {
  const normalized = normalizePath(path);
  return normalized ? `/${normalized}` : "/";
};

const getParentPath = (path: string) => {
  const normalized = normalizePath(path);
  if (!normalized || !normalized.includes("/")) {
    return "";
  }

  return normalized.slice(0, normalized.lastIndexOf("/"));
};

const normalizeOutputChunk = (chunk: string) =>
  chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();

const stripAnsiControlSequences = (value: string) =>
  value
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");

const isSpinnerFrame = (value: string) => /^[-\\|/]$/.test(value.trim());

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error ?? "unknown");

const isCrossOriginIsolationError = (message: string) =>
  message.includes("SharedArrayBuffer") ||
  message.includes("crossOriginIsolated");

const isWebcontainerInstanceLimitError = (message: string) =>
  message.includes("Unable to create more instances");

class ProjectWebcontainerRuntime {
  private instance: WebContainer | null = null;

  private bootPromise: Promise<WebContainer> | null = null;

  private serverReadyHandlers = new Set<ServerReadyHandler>();

  private serverReadyUnsubscribe: Unsubscribe | null = null;

  private lastServerReady: ServerReadyState | null = null;

  private backgroundProcesses = new Map<string, WebContainerProcess>();

  private backgroundProcessExitPromises = new Map<
    string,
    Promise<BackgroundCommandExit>
  >();

  private backgroundProcessLastExits = new Map<string, BackgroundCommandExit>();

  private syncedProjectFilePaths = new Set<string>();

  private registerBootedInstance(
    instance: WebContainer,
    log?: RuntimeLogWriter,
  ) {
    this.instance = instance;
    this.serverReadyUnsubscribe?.();
    this.serverReadyUnsubscribe = instance.on("server-ready", (port, url) => {
      this.lastServerReady = { port, url };
      for (const handler of this.serverReadyHandlers) {
        handler({ port, url });
      }
    });

    log?.("WebContainer booted.");
    return instance;
  }

  public onServerReady(
    handler: ServerReadyHandler,
    options?: { emitCurrent?: boolean },
  ) {
    this.serverReadyHandlers.add(handler);

    if (options?.emitCurrent && this.lastServerReady) {
      handler(this.lastServerReady);
    }

    return () => {
      this.serverReadyHandlers.delete(handler);
    };
  }

  public clearServerReadyState() {
    this.lastServerReady = null;
  }

  public getLastServerReady() {
    return this.lastServerReady;
  }

  public async waitForServerReady(args?: {
    timeoutMs?: number;
    expectedPort?: number;
  }) {
    const timeoutMs = args?.timeoutMs ?? 20_000;
    const expectedPort = args?.expectedPort;

    const cached = this.lastServerReady;
    if (
      cached &&
      (expectedPort === undefined || cached.port === expectedPort)
    ) {
      return cached;
    }

    await this.ensureBooted();

    const nextCached = this.lastServerReady;
    if (
      nextCached &&
      (expectedPort === undefined || nextCached.port === expectedPort)
    ) {
      return nextCached;
    }

    return await new Promise<ServerReadyState>((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        unsubscribe();
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      const unsubscribe = this.onServerReady((ready) => {
        if (expectedPort !== undefined && ready.port !== expectedPort) {
          return;
        }

        cleanup();
        resolve(ready);
      });

      timeoutId = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `Timed out waiting for preview server${
              expectedPort === undefined ? "" : ` on port ${expectedPort}`
            }.`,
          ),
        );
      }, timeoutMs);
    });
  }

  public async ensureBooted(log?: RuntimeLogWriter) {
    if (this.instance) {
      return this.instance;
    }

    if (typeof window !== "undefined" && !window.crossOriginIsolated) {
      throw new Error(
        "WebContainer requires cross-origin isolation (SharedArrayBuffer). Open this project in a top-level tab and ensure COOP/COEP headers are not stripped by your browser, proxy, or extensions.",
      );
    }

    if (!this.bootPromise) {
      this.bootPromise = WebContainer.boot({
        coep: "credentialless",
      })
        .then((instance) => {
          return this.registerBootedInstance(instance, log);
        })
        .catch(async (error) => {
          const message = getErrorMessage(error);

          if (isCrossOriginIsolationError(message)) {
            this.bootPromise = null;
            throw new Error(
              "WebContainer requires cross-origin isolation (SharedArrayBuffer). Open this project in a top-level tab and ensure COOP/COEP headers are not stripped by your browser, proxy, or extensions.",
            );
          }

          if (isWebcontainerInstanceLimitError(message)) {
            log?.(
              "WebContainer instance limit reached. Resetting runtime and retrying once...",
            );
            this.teardown();

            try {
              const recoveredInstance = await WebContainer.boot({
                coep: "credentialless",
              });
              return this.registerBootedInstance(recoveredInstance, log);
            } catch (retryError) {
              const retryMessage = getErrorMessage(retryError);
              this.bootPromise = null;
              throw new Error(
                `${retryMessage}. Try reloading the page and closing other Orbit tabs that have Runtime/Preview open.`,
              );
            }
          }

          this.bootPromise = null;
          throw error;
        });
    }

    return this.bootPromise;
  }

  public async applyOperation(args: {
    operation: AiPipelineOperation;
    readFileContentByPath: (path: string) => string | undefined;
  }) {
    const { operation, readFileContentByPath } = args;
    const instance = await this.ensureBooted();

    if (operation.type === "create_folder") {
      await instance.fs.mkdir(toFsPath(operation.path), { recursive: true });
      return;
    }

    if (
      operation.type === "run_command" ||
      operation.type === "start_background_command"
    ) {
      return;
    }

    if (operation.type === "delete_path") {
      await instance.fs.rm(toFsPath(operation.path), {
        force: true,
        recursive: true,
      });
      return;
    }

    if (operation.type === "rename_path") {
      const sourcePath = toFsPath(operation.path);
      const targetPath = toFsPath(operation.newPath);
      const targetParent = getParentPath(operation.newPath);

      if (targetParent) {
        await instance.fs.mkdir(toFsPath(targetParent), { recursive: true });
      }

      try {
        await instance.fs.rename(sourcePath, targetPath);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error ?? "unknown");

        if (message.includes("ENOENT")) {
          return;
        }

        throw error;
      }

      return;
    }

    const content = readFileContentByPath(operation.path);
    if (content === undefined) {
      throw new Error(`Missing content snapshot for ${operation.path}`);
    }

    const parentPath = getParentPath(operation.path);
    if (parentPath) {
      await instance.fs.mkdir(toFsPath(parentPath), { recursive: true });
    }

    await instance.fs.writeFile(toFsPath(operation.path), content);
  }

  public async syncProjectFiles(args: {
    filesByPath: Map<string, string>;
    log?: RuntimeLogWriter;
  }) {
    const instance = await this.ensureBooted(args.log);
    const nextPaths = new Set<string>();

    for (const [rawPath, content] of args.filesByPath.entries()) {
      const normalizedPath = normalizePath(rawPath);
      if (!normalizedPath) {
        continue;
      }

      const parentPath = getParentPath(normalizedPath);
      if (parentPath) {
        await instance.fs.mkdir(toFsPath(parentPath), { recursive: true });
      }

      await instance.fs.writeFile(toFsPath(normalizedPath), content);
      nextPaths.add(normalizedPath);
    }

    for (const previousPath of this.syncedProjectFilePaths) {
      if (nextPaths.has(previousPath)) {
        continue;
      }

      try {
        await instance.fs.rm(toFsPath(previousPath), {
          force: true,
          recursive: true,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error ?? "unknown");

        if (!message.includes("ENOENT")) {
          throw error;
        }
      }
    }

    this.syncedProjectFilePaths = nextPaths;
  }

  public async runCommand(args: {
    command: string;
    commandArgs?: string[];
    log?: RuntimeLogWriter;
    timeoutMs?: number;
  }) {
    const instance = await this.ensureBooted(args.log);
    const process = await instance.spawn(args.command, args.commandArgs ?? []);

    const outputDone = this.pipeProcessOutput(process, args.log);
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let runError: unknown = null;
    let exitCode: number | null = null;

    try {
      if (args.timeoutMs && args.timeoutMs > 0) {
        const timeoutMs = args.timeoutMs;
        const timedExitCode = await Promise.race([
          process.exit,
          new Promise<number>((_, reject) => {
            timeoutId = setTimeout(() => {
              try {
                process.kill();
              } catch {
                // Best-effort termination when timeout fires.
              }

              reject(new Error(`Command timed out after ${timeoutMs}ms.`));
            }, timeoutMs);
          }),
        ]);

        exitCode = timedExitCode;
      } else {
        exitCode = await process.exit;
      }
    } catch (error) {
      runError = error;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }

    try {
      await outputDone;
    } catch (error) {
      if (!runError) {
        runError = error;
      }
    }

    if (runError) {
      throw runError;
    }

    return exitCode ?? 1;
  }

  public async readFileIfExists(path: string) {
    const instance = await this.ensureBooted();

    try {
      const content = await instance.fs.readFile(toFsPath(path), "utf-8");
      if (typeof content === "string") {
        return content;
      }

      return new TextDecoder().decode(content);
    } catch (error) {
      const message = getErrorMessage(error);

      if (message.includes("ENOENT") || message.includes("EISDIR")) {
        return null;
      }

      throw error;
    }
  }

  public async startBackgroundCommand(args: {
    key: string;
    command: string;
    commandArgs?: string[];
    log?: RuntimeLogWriter;
  }) {
    if (this.backgroundProcesses.has(args.key)) {
      args.log?.(`Background command (${args.key}) is already running.`);
      return;
    }

    const instance = await this.ensureBooted(args.log);
    const process = await instance.spawn(args.command, args.commandArgs ?? []);
    this.backgroundProcesses.set(args.key, process);
    this.backgroundProcessLastExits.delete(args.key);

    const exitPromise: Promise<BackgroundCommandExit> = process.exit
      .then((code) => ({ code, errorMessage: null, at: Date.now() }))
      .catch((error) => ({
        code: null,
        errorMessage: getErrorMessage(error),
        at: Date.now(),
      }));

    this.backgroundProcessExitPromises.set(args.key, exitPromise);

    void this.pipeProcessOutput(process, args.log).catch((error) => {
      const message = getErrorMessage(error);
      args.log?.(`Background output error: ${message}`);
    });

    void exitPromise.then((exit) => {
      this.backgroundProcesses.delete(args.key);
      this.backgroundProcessExitPromises.delete(args.key);
      this.backgroundProcessLastExits.set(args.key, exit);

      if (exit.errorMessage) {
        args.log?.(
          `Background command (${args.key}) failed: ${exit.errorMessage}`,
        );
        return;
      }

      args.log?.(
        `Background command (${args.key}) exited with code ${exit.code}.`,
      );
    });
  }

  public stopBackgroundCommand(args: { key: string; log?: RuntimeLogWriter }) {
    const process = this.backgroundProcesses.get(args.key);
    if (!process) {
      return false;
    }

    try {
      process.kill();
    } catch (error) {
      const message = getErrorMessage(error);
      args.log?.(`Failed to stop background command (${args.key}): ${message}`);
    }

    this.backgroundProcesses.delete(args.key);
    args.log?.(`Stopped background command (${args.key}).`);
    return true;
  }

  public isBackgroundCommandRunning(key: string) {
    return this.backgroundProcesses.has(key);
  }

  public getBackgroundCommandLastExit(key: string) {
    return this.backgroundProcessLastExits.get(key) ?? null;
  }

  public async waitForBackgroundCommandExit(args: {
    key: string;
    timeoutMs?: number;
  }) {
    const runningExitPromise = this.backgroundProcessExitPromises.get(args.key);
    if (!runningExitPromise) {
      return this.backgroundProcessLastExits.get(args.key) ?? null;
    }

    const timeoutMs = args.timeoutMs ?? 0;
    if (timeoutMs <= 0) {
      return await runningExitPromise;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const timeoutPromise = new Promise<BackgroundCommandExit | null>(
      (resolve) => {
        timeoutId = setTimeout(() => {
          resolve(null);
        }, timeoutMs);
      },
    );

    const result = await Promise.race([runningExitPromise, timeoutPromise]);

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    return result;
  }

  private async pipeProcessOutput(
    process: WebContainerProcess,
    log?: RuntimeLogWriter,
  ) {
    await process.output.pipeTo(
      new WritableStream({
        write: (chunk) => {
          const text = normalizeOutputChunk(String(chunk));
          if (!text) {
            return;
          }

          for (const line of text.split("\n")) {
            const sanitizedLine = stripAnsiControlSequences(line).trim();
            if (!sanitizedLine || isSpinnerFrame(sanitizedLine)) {
              continue;
            }

            log?.(sanitizedLine);
          }
        },
      }),
    );
  }

  public teardown() {
    this.serverReadyUnsubscribe?.();
    this.serverReadyUnsubscribe = null;
    this.lastServerReady = null;

    for (const process of this.backgroundProcesses.values()) {
      try {
        process.kill();
      } catch {
        // Best-effort shutdown; teardown continues even if a process is already gone.
      }
    }
    this.backgroundProcesses.clear();
    this.backgroundProcessExitPromises.clear();
    this.backgroundProcessLastExits.clear();

    if (this.instance) {
      this.instance.teardown();
    }

    this.instance = null;
    this.bootPromise = null;
    this.syncedProjectFilePaths.clear();
  }
}

const isRuntimeCompatible = (
  value: unknown,
): value is ProjectWebcontainerRuntime => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.ensureBooted === "function" &&
    typeof record.applyOperation === "function" &&
    typeof record.syncProjectFiles === "function" &&
    typeof record.runCommand === "function" &&
    typeof record.startBackgroundCommand === "function" &&
    typeof record.waitForBackgroundCommandExit === "function" &&
    typeof record.getBackgroundCommandLastExit === "function" &&
    typeof record.stopBackgroundCommand === "function" &&
    typeof record.teardown === "function"
  );
};

declare global {
  var __orbitProjectWebcontainerRuntime__:
    | { version: number; runtime: unknown }
    | undefined;
}

const resolveProjectWebcontainerRuntime = () => {
  const existing = globalThis.__orbitProjectWebcontainerRuntime__;

  if (
    existing?.version === WEBCONTAINER_RUNTIME_VERSION &&
    isRuntimeCompatible(existing.runtime)
  ) {
    return existing.runtime;
  }

  if (isRuntimeCompatible(existing?.runtime)) {
    existing.runtime.teardown();
  }

  const runtime = new ProjectWebcontainerRuntime();
  globalThis.__orbitProjectWebcontainerRuntime__ = {
    version: WEBCONTAINER_RUNTIME_VERSION,
    runtime,
  };

  return runtime;
};

export const projectWebcontainerRuntime = resolveProjectWebcontainerRuntime();
