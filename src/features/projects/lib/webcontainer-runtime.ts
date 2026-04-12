"use client";

import {
  WebContainer,
  type Unsubscribe,
  type WebContainerProcess,
} from "@webcontainer/api";
import type { AiPipelineOperation } from "@/lib/ai-execution";

type RuntimeLogWriter = (line: string) => void;

type ServerReadyHandler = (args: { port: number; url: string }) => void;

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

class ProjectWebcontainerRuntime {
  private instance: WebContainer | null = null;

  private bootPromise: Promise<WebContainer> | null = null;

  private serverReadyHandlers = new Set<ServerReadyHandler>();

  private serverReadyUnsubscribe: Unsubscribe | null = null;

  private backgroundProcesses = new Map<string, WebContainerProcess>();

  private syncedProjectFilePaths = new Set<string>();

  public onServerReady(handler: ServerReadyHandler) {
    this.serverReadyHandlers.add(handler);

    return () => {
      this.serverReadyHandlers.delete(handler);
    };
  }

  public async ensureBooted(log?: RuntimeLogWriter) {
    if (this.instance) {
      return this.instance;
    }

    if (!this.bootPromise) {
      this.bootPromise = WebContainer.boot({
        coep: "credentialless",
      })
        .then((instance) => {
          this.instance = instance;
          this.serverReadyUnsubscribe = instance.on(
            "server-ready",
            (port, url) => {
              for (const handler of this.serverReadyHandlers) {
                handler({ port, url });
              }
            },
          );

          log?.("WebContainer booted.");
          return instance;
        })
        .catch((error) => {
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
  }) {
    const instance = await this.ensureBooted(args.log);
    const process = await instance.spawn(args.command, args.commandArgs ?? []);

    const outputDone = this.pipeProcessOutput(process, args.log);
    const exitCode = await process.exit;
    await outputDone;

    return exitCode;
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
      const message =
        error instanceof Error ? error.message : String(error ?? "unknown");

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

    void this.pipeProcessOutput(process, args.log).catch((error) => {
      const message =
        error instanceof Error ? error.message : String(error ?? "unknown");
      args.log?.(`Background output error: ${message}`);
    });

    void process.exit
      .then((code) => {
        this.backgroundProcesses.delete(args.key);
        args.log?.(
          `Background command (${args.key}) exited with code ${code}.`,
        );
      })
      .catch((error) => {
        this.backgroundProcesses.delete(args.key);
        const message =
          error instanceof Error ? error.message : String(error ?? "unknown");
        args.log?.(`Background command (${args.key}) failed: ${message}`);
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
      const message =
        error instanceof Error ? error.message : String(error ?? "unknown");
      args.log?.(`Failed to stop background command (${args.key}): ${message}`);
    }

    this.backgroundProcesses.delete(args.key);
    args.log?.(`Stopped background command (${args.key}).`);
    return true;
  }

  public isBackgroundCommandRunning(key: string) {
    return this.backgroundProcesses.has(key);
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
            if (line.trim()) {
              log?.(line);
            }
          }
        },
      }),
    );
  }

  public teardown() {
    this.serverReadyUnsubscribe?.();
    this.serverReadyUnsubscribe = null;

    for (const process of this.backgroundProcesses.values()) {
      try {
        process.kill();
      } catch {
        // Best-effort shutdown; teardown continues even if a process is already gone.
      }
    }
    this.backgroundProcesses.clear();

    if (this.instance) {
      this.instance.teardown();
    }

    this.instance = null;
    this.bootPromise = null;
    this.syncedProjectFilePaths.clear();
  }
}

export const projectWebcontainerRuntime = new ProjectWebcontainerRuntime();
