"use client";

import type { AiPipelineOperation } from "@/lib/ai-execution";

type RuntimeLogWriter = (line: string) => void;

type ServerReadyHandler = (args: { port: number; url: string }) => void;

type ServerReadyState = { port: number; url: string };

type BackgroundCommandExit = {
  code: number | null;
  errorMessage: string | null;
  at: number;
};

class RuntimeRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "RuntimeRequestError";
    this.status = status;
  }
}

const DOCKER_RUNTIME_VERSION = 4;
const SESSION_NOT_FOUND_PATTERN = /\bsession\b[\s\S]*\bnot found\b/i;
const CONTAINER_NOT_FOUND_PATTERN =
  /\bno such container\b|\bcontainer\b[\s\S]*\bnot found\b/i;
const FILE_SYNC_MAX_BATCH_FILES = 40;
const FILE_SYNC_MAX_BATCH_CHARS = 180_000;
const FILE_SYNC_PAYLOAD_TOO_LARGE_PATTERN =
  /payload|entity too large|request body|body exceeded|request too large|413|content length|too large/i;
const BACKGROUND_PID_PREFIX = "__orbit_pid__:";

const normalizePath = (rawPath: string) =>
  rawPath
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\/+/g, "/");

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

const generateSessionId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const splitFileSyncBatches = (
  files: Array<{ path: string; content: string }>,
) => {
  const batches: Array<Array<{ path: string; content: string }>> = [];
  let currentBatch: Array<{ path: string; content: string }> = [];
  let currentBatchChars = 0;

  for (const file of files) {
    const fileChars = file.path.length + file.content.length;
    const shouldFlushCurrentBatch =
      currentBatch.length > 0 &&
      (currentBatch.length >= FILE_SYNC_MAX_BATCH_FILES ||
        currentBatchChars + fileChars > FILE_SYNC_MAX_BATCH_CHARS);

    if (shouldFlushCurrentBatch) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBatchChars = 0;
    }

    currentBatch.push(file);
    currentBatchChars += fileChars;

    if (fileChars >= FILE_SYNC_MAX_BATCH_CHARS) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBatchChars = 0;
    }
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
};

const normalizeProjectKey = (value: string | null | undefined) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 80);

  return normalized || null;
};

const PORT_PATTERNS: RegExp[] = [
  /(?:listening|started|running)\s+(?:on|at)\s+(?:port\s+)?(\d{2,5})/i,
  /(?:Local|Network):\s+https?:\/\/(?:localhost|0\.0\.0\.0|127\.0\.0\.1):(\d{2,5})/i,
  /https?:\/\/(?:localhost|0\.0\.0\.0|127\.0\.0\.1):(\d{2,5})/i,
];

function detectPortFromLine(line: string): number | null {
  for (const pattern of PORT_PATTERNS) {
    const match = pattern.exec(line);
    if (match?.[1]) {
      const port = parseInt(match[1], 10);
      if (port >= 1024 && port <= 65535) return port;
    }
  }
  return null;
}

class ProjectDockerRuntime {
  private sessionId: string | null = null;
  private projectKey: string | null = null;
  private booted = false;
  private bootPromise: Promise<void> | null = null;
  private sessionRecoveryPromise: Promise<void> | null = null;

  private serverReadyHandlers = new Set<ServerReadyHandler>();
  private lastServerReady: ServerReadyState | null = null;

  private backgroundCommands = new Map<
    string,
    {
      abortController: AbortController;
      commandLine: string;
      pid: number | null;
      sessionId: string | null;
    }
  >();
  private backgroundExitPromises = new Map<
    string,
    Promise<BackgroundCommandExit>
  >();
  private backgroundLastExits = new Map<string, BackgroundCommandExit>();

  private syncedProjectFileContent = new Map<string, string>();
  private syncedProjectFilePaths = new Set<string>();

  setProjectKey(projectKey: string | null | undefined) {
    const normalizedProjectKey = normalizeProjectKey(projectKey);
    if (this.projectKey === normalizedProjectKey) {
      return;
    }

    if (this.sessionId) {
      this.teardown();
    }

    this.projectKey = normalizedProjectKey;
  }

  async ensureBooted(log?: RuntimeLogWriter): Promise<void> {
    if (this.booted && this.sessionId) {
      return;
    }

    if (this.bootPromise) {
      return this.bootPromise;
    }

    this.bootPromise = (async () => {
      try {
        this.sessionId = this.sessionId || generateSessionId();
        log?.("Starting Docker sandbox...");

        const response = await fetch("/api/sandbox/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: this.sessionId,
            runtime: "node",
            ...(this.projectKey ? { projectKey: this.projectKey } : {}),
          }),
        });

        if (!response.ok) {
          const error = await response
            .json()
            .catch(() => ({ error: "Unknown error" }));
          throw new Error(
            (error as { error?: string }).error || "Failed to create sandbox",
          );
        }

        this.booted = true;
        log?.("Docker sandbox ready.");
      } catch (error) {
        this.bootPromise = null;
        throw error;
      }
    })();

    return this.bootPromise;
  }

  onServerReady(
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

  clearServerReadyState() {
    this.lastServerReady = null;
  }

  getLastServerReady() {
    return this.lastServerReady;
  }

  private emitServerReady(port: number, url: string) {
    this.lastServerReady = { port, url };
    for (const handler of this.serverReadyHandlers) {
      handler({ port, url });
    }
  }

  private async resolvePreviewUrl(port: number): Promise<string | null> {
    if (!this.sessionId) return null;

    try {
      const response = await fetch(
        `/api/sandbox/port?sessionId=${encodeURIComponent(this.sessionId)}&port=${port}`,
      );
      if (!response.ok) return null;

      const data = (await response.json()) as { url?: string };
      return data.url || null;
    } catch {
      return null;
    }
  }

  async getPreviewUrlForPort(port: number): Promise<string | null> {
    return await this.resolvePreviewUrl(port);
  }

  async waitForServerReady(args?: {
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

  private async createResponseError(
    response: Response,
    fallbackMessage: string,
  ): Promise<RuntimeRequestError> {
    const rawBody = await response.text().catch(() => "");
    let message = `${fallbackMessage} (status ${response.status})`;

    if (rawBody.trim()) {
      try {
        const payload = JSON.parse(rawBody) as {
          error?: string;
          message?: string;
        };
        message = payload.error?.trim() || payload.message?.trim() || message;
      } catch {
        message = rawBody.trim().slice(0, 500) || fallbackMessage;
      }
    }

    return new RuntimeRequestError(message, response.status);
  }

  private isPayloadTooLargeError(error: unknown): boolean {
    if (error instanceof RuntimeRequestError) {
      return (
        error.status === 413 ||
        FILE_SYNC_PAYLOAD_TOO_LARGE_PATTERN.test(error.message)
      );
    }

    if (error instanceof Error) {
      return FILE_SYNC_PAYLOAD_TOO_LARGE_PATTERN.test(error.message);
    }

    return false;
  }

  private async postFileBatchToSandbox(args: {
    sessionId: string;
    files: Array<{ path: string; content: string }>;
    fallbackMessage: string;
  }): Promise<void> {
    const response = await fetch("/api/sandbox/files/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: args.sessionId,
        files: args.files,
      }),
    });

    if (!response.ok) {
      throw await this.createResponseError(response, args.fallbackMessage);
    }
  }

  private isMissingSessionError(error: unknown): boolean {
    if (error instanceof RuntimeRequestError) {
      return (
        error.status === 404 ||
        SESSION_NOT_FOUND_PATTERN.test(error.message) ||
        CONTAINER_NOT_FOUND_PATTERN.test(error.message)
      );
    }

    if (error instanceof Error) {
      return (
        SESSION_NOT_FOUND_PATTERN.test(error.message) ||
        CONTAINER_NOT_FOUND_PATTERN.test(error.message)
      );
    }

    return false;
  }

  private resetRuntimeStateForRecovery(options?: {
    abortBackgroundCommands?: boolean;
  }) {
    this.lastServerReady = null;
    this.booted = false;
    this.bootPromise = null;

    if (options?.abortBackgroundCommands ?? true) {
      for (const [, running] of this.backgroundCommands.entries()) {
        try {
          running.abortController.abort();
        } catch {

        }
      }

      this.backgroundCommands.clear();
      this.backgroundExitPromises.clear();
    }
  }

  private async recoverMissingSession(
    log?: RuntimeLogWriter,
    options?: { abortBackgroundCommands?: boolean },
  ): Promise<void> {
    if (this.sessionRecoveryPromise) {
      return this.sessionRecoveryPromise;
    }

    this.sessionRecoveryPromise = (async () => {
      const recoverableFiles: Array<{ path: string; content: string }> = [];

      for (const path of this.syncedProjectFilePaths) {
        const content = this.syncedProjectFileContent.get(path);
        if (typeof content === "string") {
          recoverableFiles.push({ path, content });
        }
      }

      this.resetRuntimeStateForRecovery(options);
      this.sessionId = generateSessionId();

      log?.("Sandbox session expired. Recreating sandbox...");
      await this.ensureBooted(log);

      if (!this.sessionId) {
        throw new Error("Failed to recreate sandbox session.");
      }

      if (recoverableFiles.length === 0) {
        log?.("Recovered sandbox session.");
        return;
      }

      const response = await fetch("/api/sandbox/files/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: this.sessionId,
          files: recoverableFiles,
        }),
      });

      if (!response.ok) {
        throw await this.createResponseError(
          response,
          "Failed to restore files after sandbox recovery",
        );
      }

      this.syncedProjectFilePaths = new Set(
        recoverableFiles.map((file) => file.path),
      );
      log?.(
        `Recovered sandbox session and restored ${recoverableFiles.length} file(s).`,
      );
    })();

    try {
      await this.sessionRecoveryPromise;
    } finally {
      this.sessionRecoveryPromise = null;
    }
  }

  private async executeWithSessionRetry<T>(args: {
    actionLabel: string;
    log?: RuntimeLogWriter;
    execute: (sessionId: string) => Promise<T>;
  }): Promise<T> {
    await this.ensureBooted(args.log);

    const currentSessionId = this.sessionId;
    if (!currentSessionId) {
      throw new Error("Sandbox session is not initialized.");
    }

    try {
      return await args.execute(currentSessionId);
    } catch (error) {
      if (!this.isMissingSessionError(error)) {
        throw error;
      }

      args.log?.(
        `Sandbox session was lost while ${args.actionLabel}; retrying once with a new session.`,
      );
      await this.recoverMissingSession(args.log);

      const recoveredSessionId = this.sessionId;
      if (!recoveredSessionId) {
        throw error;
      }

      return await args.execute(recoveredSessionId);
    }
  }

  async syncProjectFiles(args: {
    filesByPath: Map<string, string>;
    log?: RuntimeLogWriter;
  }) {
    await this.ensureBooted(args.log);

    const files: Array<{ path: string; content: string }> = [];
    const nextPaths = new Set<string>();

    for (const [rawPath, content] of args.filesByPath.entries()) {
      const normalizedPath = normalizePath(rawPath);
      if (!normalizedPath) continue;

      nextPaths.add(normalizedPath);

      if (this.syncedProjectFileContent.get(normalizedPath) === content) {
        continue;
      }

      files.push({ path: normalizedPath, content });
    }

    if (
      files.length === 0 &&
      this.syncedProjectFilePaths.size === nextPaths.size
    ) {
      return;
    }

    args.log?.(`Syncing ${files.length} file(s) to sandbox...`);

    await this.executeWithSessionRetry({
      actionLabel: "syncing project files",
      log: args.log,
      execute: async (sessionId) => {
        const batches = splitFileSyncBatches(files);

        for (const [batchIndex, batch] of batches.entries()) {
          try {
            await this.postFileBatchToSandbox({
              sessionId,
              files: batch,
              fallbackMessage: "File sync failed",
            });
          } catch (error) {
            if (batch.length <= 1) {
              throw error;
            }

            const errorReason = this.isPayloadTooLargeError(error)
              ? "exceeded payload limits"
              : `failed (${getErrorMessage(error)})`;

            args.log?.(
              `Sync batch ${batchIndex + 1}/${batches.length} ${errorReason}; retrying per file.`,
            );

            for (const file of batch) {
              const singleFileResponse = await fetch(
                "/api/sandbox/files/write",
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    sessionId,
                    filePath: file.path,
                    content: file.content,
                  }),
                },
              );

              if (!singleFileResponse.ok) {
                const singleFileError = await this.createResponseError(
                  singleFileResponse,
                  `File sync failed for ${file.path}`,
                );

                if (this.isPayloadTooLargeError(singleFileError)) {
                  throw new RuntimeRequestError(
                    `File sync failed for ${file.path}: payload too large (${file.content.length} chars).`,
                    413,
                  );
                }

                throw singleFileError;
              }
            }
          }
        }
      },
    });

    for (const file of files) {
      this.syncedProjectFileContent.set(file.path, file.content);
    }
    this.syncedProjectFilePaths = nextPaths;
  }

  async readFileIfExists(path: string): Promise<string | null> {
    const normalizedPath = normalizePath(path);
    if (!normalizedPath) {
      return null;
    }

    try {
      return await this.executeWithSessionRetry({
        actionLabel: `reading ${normalizedPath}`,
        execute: async (sessionId) => {
          const response = await fetch(
            `/api/sandbox/files/read?sessionId=${encodeURIComponent(sessionId)}&filePath=${encodeURIComponent(normalizedPath)}`,
          );

          if (response.status === 404) {
            const payload = (await response.json().catch(() => null)) as {
              error?: string;
              content?: string | null;
            } | null;
            const message = payload?.error?.trim() || "File not found";

            if (SESSION_NOT_FOUND_PATTERN.test(message)) {
              throw new RuntimeRequestError(message, response.status);
            }

            return null;
          }

          if (!response.ok) {
            throw await this.createResponseError(
              response,
              "Failed to read file",
            );
          }

          const data = (await response.json()) as { content?: string | null };
          return data.content ?? null;
        },
      });
    } catch {
      return null;
    }
  }

  async writeSandboxFile(args: {
    path: string;
    content: string;
    log?: RuntimeLogWriter;
  }) {
    const normalizedPath = normalizePath(args.path);
    if (!normalizedPath) {
      throw new Error("Sandbox file path is required.");
    }

    await this.executeWithSessionRetry({
      actionLabel: `writing ${normalizedPath}`,
      log: args.log,
      execute: async (sessionId) => {
        const response = await fetch("/api/sandbox/files/write", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            filePath: normalizedPath,
            content: args.content,
          }),
        });

        if (!response.ok) {
          throw await this.createResponseError(
            response,
            "Failed to write sandbox file",
          );
        }
      },
    });
  }

  async runCommand(args: {
    command: string;
    commandArgs?: string[];
    env?: Record<string, string>;
    log?: RuntimeLogWriter;
    timeoutMs?: number;
  }): Promise<number> {
    const fullCommand = [args.command, ...(args.commandArgs ?? [])].join(" ");

    return await this.executeWithSessionRetry({
      actionLabel: `running "${fullCommand}"`,
      log: args.log,
      execute: async (sessionId) => {
        const abortController = new AbortController();
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        if (args.timeoutMs && args.timeoutMs > 0) {
          timeoutId = setTimeout(() => {
            abortController.abort();
          }, args.timeoutMs);
        }

        try {
          const response = await fetch("/api/sandbox/exec", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId,
              command: fullCommand,
              env: args.env,
            }),
            signal: abortController.signal,
          });

          if (!response.ok) {
            throw await this.createResponseError(
              response,
              "Command execution failed",
            );
          }

          return await this.consumeSSEStream(response, args.log);
        } catch (error) {
          if (abortController.signal.aborted) {
            args.log?.(`Command timed out after ${args.timeoutMs}ms.`);
            return 1;
          }

          throw error;
        } finally {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
        }
      },
    });
  }

  async startBackgroundCommand(args: {
    key: string;
    command: string;
    commandArgs?: string[];
    env?: Record<string, string>;
    log?: RuntimeLogWriter;
  }) {
    if (this.backgroundCommands.has(args.key)) {
      args.log?.(`Background command (${args.key}) is already running.`);
      return;
    }

    const fullCommand = [args.command, ...(args.commandArgs ?? [])].join(" ");
    const commandWithPid = `(${fullCommand}) & pid=$!; echo ${BACKGROUND_PID_PREFIX}$pid; wait $pid`;
    const abortController = new AbortController();

    this.backgroundCommands.set(args.key, {
      abortController,
      commandLine: fullCommand,
      pid: null,
      sessionId: null,
    });
    this.backgroundLastExits.delete(args.key);

    this.syncedProjectFileContent.clear();
    this.syncedProjectFilePaths.clear();

    const exitPromise = (async (): Promise<BackgroundCommandExit> => {
      try {
        const exitCode = await this.executeWithSessionRetry({
          actionLabel: `starting background command (${args.key})`,
          log: args.log,
          execute: async (sessionId) => {
            const running = this.backgroundCommands.get(args.key);
            if (running) {
              running.sessionId = sessionId;
            }

            const response = await fetch("/api/sandbox/exec", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sessionId,
                command: commandWithPid,
                env: args.env,
              }),
              signal: abortController.signal,
            });

            if (!response.ok) {
              throw await this.createResponseError(
                response,
                "Failed to start command",
              );
            }

            const handleLogLine = (line: string) => {
              if (line.startsWith(BACKGROUND_PID_PREFIX)) {
                const pidText = line.slice(BACKGROUND_PID_PREFIX.length).trim();
                const pid = Number.parseInt(pidText, 10);
                if (Number.isFinite(pid)) {
                  const active = this.backgroundCommands.get(args.key);
                  if (active) {
                    active.pid = pid;
                  }
                }
                return;
              }

              args.log?.(line);
            };

            return await this.consumeSSEStream(response, handleLogLine);
          },
        });

        return { code: exitCode, errorMessage: null, at: Date.now() };
      } catch (error) {
        if (abortController.signal.aborted) {
          return {
            code: null,
            errorMessage: "Stopped manually.",
            at: Date.now(),
          };
        }
        return {
          code: null,
          errorMessage: getErrorMessage(error),
          at: Date.now(),
        };
      } finally {
        this.backgroundCommands.delete(args.key);
        this.syncedProjectFileContent.clear();
        this.syncedProjectFilePaths.clear();
      }
    })();

    this.backgroundExitPromises.set(args.key, exitPromise);

    void exitPromise.then((exit) => {
      this.backgroundExitPromises.delete(args.key);
      this.backgroundLastExits.set(args.key, exit);

      if (exit.errorMessage) {
        args.log?.(
          `Background command (${args.key}) failed: ${exit.errorMessage}`,
        );
      } else {
        args.log?.(
          `Background command (${args.key}) exited with code ${exit.code}.`,
        );
      }
    });
  }

  stopBackgroundCommand(args: { key: string; log?: RuntimeLogWriter }) {
    const running = this.backgroundCommands.get(args.key);
    if (!running) {
      return false;
    }

    running.abortController.abort();
    void this.requestBackgroundCommandStop({
      key: args.key,
      sessionId: running.sessionId,
      pid: running.pid,
      log: args.log,
    });
    this.backgroundCommands.delete(args.key);
    this.syncedProjectFileContent.clear();
    this.syncedProjectFilePaths.clear();
    args.log?.(`Stopped background command (${args.key}).`);
    return true;
  }

  isBackgroundCommandRunning(key: string) {
    return this.backgroundCommands.has(key);
  }

  private async requestBackgroundCommandStop(args: {
    key: string;
    sessionId: string | null;
    pid: number | null;
    log?: RuntimeLogWriter;
  }) {
    if (!args.sessionId || !args.pid || !Number.isFinite(args.pid)) {
      return;
    }

    const command = `if kill -0 ${args.pid} 2>/dev/null; then kill ${args.pid} 2>/dev/null || true; fi`;

    try {
      const response = await fetch("/api/sandbox/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: args.sessionId,
          command,
        }),
      });

      if (response.ok) {
        await this.consumeSSEStream(response);
      }
    } catch (error) {
      args.log?.(
        `Failed to stop background command (${args.key}): ${getErrorMessage(error)}`,
      );
    }
  }

  getBackgroundCommandLastExit(key: string) {
    return this.backgroundLastExits.get(key) ?? null;
  }

  async waitForBackgroundCommandExit(args: {
    key: string;
    timeoutMs?: number;
  }) {
    const runningExitPromise = this.backgroundExitPromises.get(args.key);
    if (!runningExitPromise) {
      return this.backgroundLastExits.get(args.key) ?? null;
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

  async applyOperation(args: {
    operation: AiPipelineOperation;
    readFileContentByPath: (path: string) => string | undefined;
  }) {
    const { operation, readFileContentByPath } = args;

    if (operation.type === "create_folder") {

      return;
    }

    if (
      operation.type === "run_command" ||
      operation.type === "start_background_command"
    ) {

      return;
    }

    if (!this.sessionId) return;

    if (operation.type === "delete_path") {
      await this.executeWithSessionRetry({
        actionLabel: `deleting ${normalizePath(operation.path)}`,
        execute: async (sessionId) => {
          const response = await fetch("/api/sandbox/exec", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId,
              command: `rm -rf /workspace/${normalizePath(operation.path)}`,
            }),
          });

          if (!response.ok) {
            throw await this.createResponseError(
              response,
              "Failed to delete path",
            );
          }
        },
      });

      this.syncedProjectFileContent.clear();
      this.syncedProjectFilePaths.clear();
      return;
    }

    if (operation.type === "rename_path") {
      const source = normalizePath(operation.path);
      const target = normalizePath(operation.newPath);
      const parentDir = getParentPath(operation.newPath);

      let command = "";
      if (parentDir) {
        command += `mkdir -p /workspace/${parentDir} && `;
      }
      command += `mv /workspace/${source} /workspace/${target}`;

      await this.executeWithSessionRetry({
        actionLabel: `renaming ${source} to ${target}`,
        execute: async (sessionId) => {
          const response = await fetch("/api/sandbox/exec", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId,
              command,
            }),
          });

          if (!response.ok) {
            throw await this.createResponseError(
              response,
              "Failed to rename path",
            );
          }
        },
      });

      this.syncedProjectFileContent.clear();
      this.syncedProjectFilePaths.clear();
      return;
    }

    const content = readFileContentByPath(operation.path);
    if (content === undefined) {
      throw new Error(`Missing content snapshot for ${operation.path}`);
    }

    const normalizedPath = normalizePath(operation.path);
    await this.executeWithSessionRetry({
      actionLabel: `writing ${normalizedPath}`,
      execute: async (sessionId) => {
        const response = await fetch("/api/sandbox/files/write", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            filePath: normalizedPath,
            content,
          }),
        });

        if (!response.ok) {
          throw await this.createResponseError(
            response,
            "Failed to write file",
          );
        }
      },
    });

    this.syncedProjectFilePaths.add(normalizedPath);
    this.syncedProjectFileContent.set(normalizedPath, content);
  }

  teardown() {
    this.lastServerReady = null;

    for (const running of this.backgroundCommands.values()) {
      try {
        running.abortController.abort();
      } catch {

      }
    }
    this.backgroundCommands.clear();
    this.backgroundExitPromises.clear();
    this.backgroundLastExits.clear();

    if (this.sessionId) {
      const sessionId = this.sessionId;
      void fetch("/api/sandbox/kill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      }).catch(() => {

      });
    }

    this.booted = false;
    this.bootPromise = null;
    this.sessionId = null;
    this.sessionRecoveryPromise = null;
    this.syncedProjectFileContent.clear();
    this.syncedProjectFilePaths.clear();
  }

  private async consumeSSEStream(
    response: Response,
    log?: RuntimeLogWriter,
  ): Promise<number> {
    const reader = response.body?.getReader();
    if (!reader) return 1;

    const decoder = new TextDecoder();
    let exitCode = 0;
    let buffer = "";
    let detectedPort: number | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;

          try {
            const payload = JSON.parse(line.slice(6)) as {
              type: string;
              data: string;
            };

            if (payload.type === "stdout" || payload.type === "stderr") {
              const text = normalizeOutputChunk(payload.data);
              if (!text) continue;

              for (const outputLine of text.split("\n")) {
                const sanitized = stripAnsiControlSequences(outputLine).trim();
                if (!sanitized || isSpinnerFrame(sanitized)) continue;
                log?.(sanitized);

                if (detectedPort === null) {
                  const port = detectPortFromLine(outputLine);
                  if (port !== null) {
                    detectedPort = port;
                    void this.resolvePreviewUrl(port).then((url) => {
                      if (url) {
                        this.emitServerReady(port, url);
                      }
                    });
                  }
                }
              }
            } else if (payload.type === "exit") {
              exitCode = parseInt(payload.data, 10) || 0;
            }
          } catch {

          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return exitCode;
  }
}

const isRuntimeCompatible = (value: unknown): value is ProjectDockerRuntime => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.ensureBooted === "function" &&
    typeof record.setProjectKey === "function" &&
    typeof record.applyOperation === "function" &&
    typeof record.syncProjectFiles === "function" &&
    typeof record.runCommand === "function" &&
    typeof record.writeSandboxFile === "function" &&
    typeof record.startBackgroundCommand === "function" &&
    typeof record.waitForBackgroundCommandExit === "function" &&
    typeof record.getBackgroundCommandLastExit === "function" &&
    typeof record.stopBackgroundCommand === "function" &&
    typeof record.teardown === "function"
  );
};

declare global {
  var __orbitProjectDockerRuntime__:
    | { version: number; runtime: unknown }
    | undefined;
}

const resolveProjectDockerRuntime = () => {
  const existing = globalThis.__orbitProjectDockerRuntime__;

  if (
    existing?.version === DOCKER_RUNTIME_VERSION &&
    isRuntimeCompatible(existing.runtime)
  ) {
    return existing.runtime;
  }

  if (isRuntimeCompatible(existing?.runtime)) {
    existing.runtime.teardown();
  }

  const runtime = new ProjectDockerRuntime();
  globalThis.__orbitProjectDockerRuntime__ = {
    version: DOCKER_RUNTIME_VERSION,
    runtime,
  };

  return runtime;
};

export const projectWebcontainerRuntime = resolveProjectDockerRuntime();
