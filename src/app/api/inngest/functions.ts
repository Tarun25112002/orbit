import { inngest } from "@/inngest/client";
import { convex } from "@/lib/convex-client";
import { suggestionRuntime } from "@/lib/completion-runtime";
import { generateGeminiCompletion, GEMINI_MODEL_DEFAULT } from "@/lib/gemini";
import { classifyError } from "@/lib/errors";
import { buildWebContextFromText } from "@/lib/web-context";
import {
  createSession,
  getSession,
  getContainer,
} from "@/lib/docker/session-manager";
import { syncProjectToContainer } from "@/lib/docker/file-sync";
import {
  type ConversationFileOperation,
  type ConversationFileOperationExecutionResult,
  type ConversationProjectFile,
  generateConversationTitle,
  runConversationAgentOrchestration,
} from "@/lib/conversation-agents";
import type {
  AiExecutionTrace,
  AiPipelineOperation,
  AiPipelineOperationResult,
} from "@/lib/ai-execution";
import { parseAiExecutionTrace } from "@/lib/ai-execution";
import {
  generateSuggestion,
  type ParsedSuggestionInput,
} from "@/lib/suggestion-engine";
import type { SuggestionMode } from "@/lib/code-suggestion";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

const GEMINI_MODEL = GEMINI_MODEL_DEFAULT;
const MAX_FILE_CONTEXT_CHARS = 3_000;
const MAX_FILE_CONTEXT_CHARS_PER_FILE = 1_000;
const MAX_CONTEXT_FILES = 4;
const MAX_HISTORY_MESSAGES = 4;
const SANDBOX_COMMAND_TIMEOUT_MS = 120_000;
const SANDBOX_MAX_OUTPUT_CHARS = 1_500;
const ENABLE_CONVERSATION_AI_TITLE = /^(1|true)$/i.test(
  process.env.CONVERSATION_ENABLE_AI_TITLE?.trim() ?? "",
);
const ENABLE_TRACE_HISTORY = !/^(0|false)$/i.test(
  process.env.CONVERSATION_ENABLE_TRACE_HISTORY?.trim() ?? "true",
);
const TITLE_SKIP_HEAVY_REQUEST_PATTERN =
  /\b(create|build|generate|scaffold|setup|implement|fix|refactor|rename|move|delete|update|install|dependency|dependencies|next(?:\.js|js)?|project|app|route|api)\b/i;
const FILE_CONTEXT_STOP_WORDS = new Set([
  "about",
  "after",
  "before",
  "build",
  "change",
  "create",
  "file",
  "files",
  "folder",
  "folders",
  "from",
  "into",
  "make",
  "next",
  "project",
  "route",
  "using",
  "with",
]);

type ProjectFileTreeNode = {
  name: string;
  type: "file" | "folder";
  parentId?: string | null;
  _id: string;
  content?: string;
};

const buildFileTree = (files: ProjectFileTreeNode[]): string => {
  const childrenMap = new Map<string | null, ProjectFileTreeNode[]>();

  for (const file of files) {
    const parentKey = file.parentId ?? null;
    if (!childrenMap.has(parentKey)) {
      childrenMap.set(parentKey, []);
    }
    childrenMap.get(parentKey)!.push(file);
  }

  const renderNode = (id: string | null, indent: number): string[] => {
    const children = childrenMap.get(id) ?? [];
    children.sort((a, b) => {
      if (a.type === "folder" && b.type === "file") return -1;
      if (a.type === "file" && b.type === "folder") return 1;
      return a.name.localeCompare(b.name);
    });

    const lines: string[] = [];
    for (const child of children) {
      const prefix = "  ".repeat(indent);
      const label = child.type === "folder" ? "[folder]" : "[file]";
      lines.push(`${prefix}${label} ${child.name}`);
      if (child.type === "folder") {
        lines.push(...renderNode(child._id, indent + 1));
      }
    }
    return lines;
  };

  return renderNode(null, 0).join("\n");
};

const buildProjectFilePaths = (files: ProjectFileTreeNode[]) => {
  const fileById = new Map(files.map((file) => [file._id, file]));
  const pathById = new Map<string, string>();
  const resolving = new Set<string>();

  const resolvePath = (fileId: string): string => {
    const cached = pathById.get(fileId);
    if (cached) {
      return cached;
    }

    const file = fileById.get(fileId);
    if (!file) {
      return fileId;
    }

    if (resolving.has(fileId)) {
      return file.name;
    }

    resolving.add(fileId);

    const parentPath = file.parentId ? resolvePath(file.parentId) : "";
    const resolvedPath = parentPath ? `${parentPath}/${file.name}` : file.name;

    pathById.set(fileId, resolvedPath);
    resolving.delete(fileId);

    return resolvedPath;
  };

  for (const file of files) {
    resolvePath(file._id);
  }

  return pathById;
};

const buildConversationProjectFiles = (
  files: ProjectFileTreeNode[],
): ConversationProjectFile[] => {
  const pathById = buildProjectFilePaths(files);

  return files
    .map((file) => ({
      path: pathById.get(file._id) ?? file.name,
      type: file.type,
      content: file.type === "file" ? (file.content ?? "") : undefined,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
};

const tokenizeContextQuery = (value: string) => {
  const tokens = value
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter((token) => !FILE_CONTEXT_STOP_WORDS.has(token));

  return Array.from(new Set(tokens)).slice(0, 64);
};

const truncateFileContextContent = (content: string) => {
  if (content.length <= MAX_FILE_CONTEXT_CHARS_PER_FILE) {
    return content;
  }

  return `${content.slice(0, MAX_FILE_CONTEXT_CHARS_PER_FILE)}\n/* ...truncated for context... */`;
};

const scoreProjectFileForContext = (
  file: ConversationProjectFile,
  queryTokens: string[],
) => {
  if (file.type !== "file" || !file.content) {
    return -1;
  }

  const lowerPath = file.path.toLowerCase();
  const fileName = lowerPath.split("/").at(-1) ?? lowerPath;

  let score = 0;
  for (const token of queryTokens) {
    if (lowerPath.includes(token)) {
      score += 8;
    }

    if (fileName.includes(token)) {
      score += 3;
    }
  }

  return score;
};

const buildRelevantProjectFileContext = (args: {
  files: ConversationProjectFile[];
  query: string;
}) => {
  const queryTokens = tokenizeContextQuery(args.query);
  const rankedFiles = args.files
    .filter(
      (
        file,
      ): file is ConversationProjectFile & { type: "file"; content: string } =>
        file.type === "file" && typeof file.content === "string",
    )
    .map((file) => ({
      file,
      score: scoreProjectFileForContext(file, queryTokens),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.file.path.localeCompare(right.file.path);
    });

  const selectedBlocks: string[] = [];
  let totalChars = 0;

  for (const candidate of rankedFiles) {
    if (selectedBlocks.length >= MAX_CONTEXT_FILES) {
      break;
    }

    const content = truncateFileContextContent(candidate.file.content);
    if (!content.trim()) {
      continue;
    }

    if (totalChars + content.length > MAX_FILE_CONTEXT_CHARS) {
      continue;
    }

    selectedBlocks.push(`--- ${candidate.file.path} ---\n${content}`);
    totalChars += content.length;
  }

  return selectedBlocks;
};

/**
 * Execute a shell command inside a Docker container and capture output.
 * Returns the exit code and captured stdout/stderr text.
 */
const execCommandInContainer = async (args: {
  sessionId: string;
  command: string;
  timeoutMs?: number;
}): Promise<{ exitCode: number; output: string }> => {
  const container = getContainer(args.sessionId);
  if (!container) {
    throw new Error(`Sandbox session ${args.sessionId} not found`);
  }

  const exec = await container.exec({
    Cmd: ["/bin/sh", "-c", args.command],
    AttachStdout: true,
    AttachStderr: true,
    WorkingDir: "/workspace",
  });

  const execStream = await exec.start({ Detach: false, Tty: false });

  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let totalLength = 0;
    const maxBytes = SANDBOX_MAX_OUTPUT_CHARS * 2;
    let timedOut = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      try {
        execStream.destroy();
      } catch {
        // Best effort
      }
      resolve({ exitCode: 1, output: "Command timed out." });
    }, args.timeoutMs ?? SANDBOX_COMMAND_TIMEOUT_MS);

    execStream.on("data", (chunk: Buffer) => {
      if (totalLength < maxBytes) {
        chunks.push(chunk);
        totalLength += chunk.length;
      }
    });

    execStream.on("end", () => {
      if (timedOut) return;
      clearTimeout(timeoutId);

      exec
        .inspect()
        .then((info) => {
          const output = Buffer.concat(chunks)
            .toString("utf-8")
            .slice(0, SANDBOX_MAX_OUTPUT_CHARS);
          resolve({ exitCode: info.ExitCode ?? 0, output });
        })
        .catch(() => {
          const output = Buffer.concat(chunks)
            .toString("utf-8")
            .slice(0, SANDBOX_MAX_OUTPUT_CHARS);
          resolve({ exitCode: 1, output });
        });
    });

    execStream.on("error", () => {
      if (timedOut) return;
      clearTimeout(timeoutId);
      const output = Buffer.concat(chunks)
        .toString("utf-8")
        .slice(0, SANDBOX_MAX_OUTPUT_CHARS);
      resolve({ exitCode: 1, output });
    });
  });
};

/**
 * Ensure a sandbox session exists for a project and sync its files.
 * Returns the sessionId to use for subsequent command execution.
 */
const ensureSandboxForProject = async (args: {
  projectId: Id<"projects">;
  projectFiles: ConversationProjectFile[];
}): Promise<string> => {
  const sessionId = `inngest-${args.projectId}`;

  // Create session if it doesn't already exist
  const existing = getSession(sessionId);
  if (!existing) {
    await createSession(sessionId, "node");
  }

  // Sync project files into the container
  const filesToSync = args.projectFiles
    .filter(
      (file): file is ConversationProjectFile & { type: "file"; content: string } =>
        file.type === "file" && typeof file.content === "string" && file.content.length > 0,
    )
    .map((file) => ({ path: file.path, content: file.content }));

  if (filesToSync.length > 0) {
    await syncProjectToContainer(sessionId, filesToSync);
  }

  return sessionId;
};

/** Track sandbox session IDs created during Inngest execution for cleanup. */
const activeSandboxSessions = new Map<string, string>();

const executeConversationFileOperation = async (args: {
  projectId: Id<"projects">;
  operation: ConversationFileOperation;
  projectFiles?: ConversationProjectFile[];
}): Promise<ConversationFileOperationExecutionResult> => {
  const { projectId, operation } = args;

  try {
    if (operation.type === "run_command" || operation.type === "start_background_command") {
      const fullCommand = [
        operation.command,
        ...(operation.commandArgs ?? []),
      ].join(" ");
      const label =
        operation.type === "start_background_command"
          ? `background command (${operation.key})`
          : "command";

      try {
        // Ensure sandbox exists (lazy-create on first command)
        let sessionId = activeSandboxSessions.get(projectId);
        if (!sessionId) {
          sessionId = await ensureSandboxForProject({
            projectId: projectId as Id<"projects">,
            projectFiles: args.projectFiles ?? [],
          });
          activeSandboxSessions.set(projectId, sessionId);
        }

        const result = await execCommandInContainer({
          sessionId,
          command: fullCommand,
          timeoutMs: SANDBOX_COMMAND_TIMEOUT_MS,
        });

        const outputPreview = result.output.trim().slice(0, SANDBOX_MAX_OUTPUT_CHARS);
        const exitLabel = result.exitCode === 0 ? "succeeded" : `failed (exit ${result.exitCode})`;

        return {
          status: result.exitCode === 0 ? "applied" : "failed",
          message: `Executed ${label}: ${fullCommand} — ${exitLabel}.${outputPreview ? `\n${outputPreview}` : ""}`,
          commandOutput: outputPreview || undefined,
          commandExitCode: result.exitCode,
        };
      } catch (sandboxError) {
        // If Docker isn't available, fall back to queueing for client-side execution
        console.warn("conversation.sandbox.exec.fallback", {
          projectId,
          command: fullCommand,
          error:
            sandboxError instanceof Error
              ? sandboxError.message
              : String(sandboxError),
        });

        return {
          status: "applied",
          message: `Queued ${label} for client-side execution: ${fullCommand}`,
        };
      }
    }

    if (operation.type === "create_file") {
      const result = await convex.mutation(api.system.agentCreateFileByPath, {
        projectId,
        path: operation.path,
        content: operation.content,
        overwrite: operation.overwrite,
      });

      return {
        status: "applied",
        message:
          result.action === "created"
            ? `Created file ${result.path}.`
            : `Updated file ${result.path}.`,
      };
    }

    if (operation.type === "create_folder") {
      const result = await convex.mutation(api.system.agentCreateFolderByPath, {
        projectId,
        path: operation.path,
      });

      return {
        status: result.action === "created" ? "applied" : "skipped",
        message:
          result.action === "created"
            ? `Created folder ${result.path}.`
            : `Folder ${result.path} already exists.`,
      };
    }

    if (operation.type === "update_file") {
      const result = await convex.mutation(api.system.agentUpdateFileByPath, {
        projectId,
        path: operation.path,
        content: operation.content,
        createIfMissing: operation.createIfMissing,
      });

      return {
        status: "applied",
        message:
          result.action === "created"
            ? `Created file ${result.path}.`
            : `Updated file ${result.path}.`,
      };
    }

    if (operation.type === "delete_path") {
      const result = await convex.mutation(api.system.agentDeletePath, {
        projectId,
        path: operation.path,
      });

      if (result.status === "missing") {
        return {
          status: "skipped",
          message: `Path ${result.path} was not found.`,
        };
      }

      const nestedCount = result.deletedCount - 1;

      return {
        status: "applied",
        message:
          nestedCount > 0
            ? `Deleted ${result.deletedType} ${result.path} and ${nestedCount} nested item(s).`
            : `Deleted ${result.deletedType} ${result.path}.`,
      };
    }

    const result = await convex.mutation(api.system.agentRenamePath, {
      projectId,
      path: operation.path,
      newPath: operation.newPath,
      createMissingParents: operation.createMissingParents,
    });

    if (result.status === "unchanged") {
      return {
        status: "skipped",
        message: `Path ${result.path} is already named ${result.newPath}.`,
      };
    }

    return {
      status: "applied",
      message: `Renamed ${result.path} to ${result.newPath}.`,
    };
  } catch (error) {
    const classified = classifyError(error);
    return {
      status: "failed",
      message: classified.message,
    };
  }
};

export const orbit = inngest.createFunction(
  { id: "orbit-generate", triggers: [{ event: "orbit/generate" }] },
  async ({ event, step }) => {
    const { prompt } = event.data as { prompt: string };

    const webContext = await step.run("scrape-web-context", async () => {
      return await buildWebContextFromText(prompt);
    });

    const finalPrompt = webContext.markdown
      ? `Web context from referenced URLs:\n${webContext.markdown}\n\nQuestion: ${prompt}`
      : prompt;

    return await step.run("generate-text", async () => {
      const completion = await generateGeminiCompletion({
        model: GEMINI_MODEL,
        messages: [{ role: "user", content: finalPrompt }],
      });

      return {
        model: GEMINI_MODEL,
        content: completion.content,
      };
    });
  },
);

type CodeCompletionRequestedEvent = {
  requestId: string;
  fingerprint: string;
  mode: SuggestionMode;
  input: ParsedSuggestionInput;
};

type ConversationMessageRequestedEvent = {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  message: string;
  activeFilePath?: string;
  activeFolderPath?: string;
  userId: string;
};

type OrchestrationOperationResult = {
  operation: ConversationFileOperation;
  status: "applied" | "skipped" | "failed";
  message: string;
};

const toAiPipelineOperation = (
  operation: ConversationFileOperation,
): AiPipelineOperation => {
  if (operation.type === "run_command") {
    return {
      type: "run_command",
      command: operation.command,
      commandArgs: operation.commandArgs,
    };
  }

  if (operation.type === "start_background_command") {
    return {
      type: "start_background_command",
      key: operation.key,
      command: operation.command,
      commandArgs: operation.commandArgs,
    };
  }

  if (operation.type === "rename_path") {
    return {
      type: "rename_path",
      path: operation.path,
      newPath: operation.newPath,
    };
  }

  return {
    type: operation.type,
    path: operation.path,
  };
};

const toAiPipelineOperationResult = (
  result: OrchestrationOperationResult,
): AiPipelineOperationResult => ({
  operation: toAiPipelineOperation(result.operation),
  status: result.status,
  message: result.message,
});

const buildConversationExecutionTrace = (args: {
  operations: ConversationFileOperation[];
  operationResults: OrchestrationOperationResult[];
}): AiExecutionTrace => ({
  version: 1,
  generatedAt: Date.now(),
  operations: args.operations.map((operation) =>
    toAiPipelineOperation(operation),
  ),
  operationResults: args.operationResults.map((result) =>
    toAiPipelineOperationResult(result),
  ),
});

const isReasoningDetailsValidatorMismatch = (error: unknown) => {
  const message =
    error instanceof Error ? error.message : String(error ?? "unknown-error");

  return (
    message.includes("ArgumentValidationError") &&
    message.includes("reasoningDetails")
  );
};

const updateAssistantMessage = async (args: {
  assistantMessageId: string;
  content: string;
  status: "completed" | "failed";
  reasoningDetails?: unknown;
}) => {
  const baseArgs = {
    messageId: args.assistantMessageId as Id<"messages">,
    content: args.content,
    status: args.status,
  };

  if (args.reasoningDetails === undefined) {
    return await convex.mutation(
      api.system.completeMessageIfProcessing,
      baseArgs,
    );
  }

  try {
    return await convex.mutation(api.system.completeMessageIfProcessing, {
      ...baseArgs,
      reasoningDetails: args.reasoningDetails,
    });
  } catch (error) {
    if (!isReasoningDetailsValidatorMismatch(error)) {
      throw error;
    }

    console.warn(
      "conversation.reasoning-details.validator-mismatch; retrying without reasoning details",
      {
        assistantMessageId: args.assistantMessageId,
      },
    );

    return await convex.mutation(
      api.system.completeMessageIfProcessing,
      baseArgs,
    );
  }
};

const isAssistantMessageCancelled = async (assistantMessageId: string) => {
  const assistantMessage = await convex.query(api.system.getMessageById, {
    messageId: assistantMessageId as Id<"messages">,
  });

  return assistantMessage?.status === "cancelled";
};

const shouldGenerateConversationTitle = (title: string) =>
  /^chat\s+\d+$/i.test(title.trim()) ||
  /^new conversation$/i.test(title.trim());

const shouldSkipAiTitleForMessage = (message: string) => {
  const trimmed = message.trim();
  if (!trimmed) {
    return true;
  }

  if (trimmed.length > 220) {
    return true;
  }

  return TITLE_SKIP_HEAVY_REQUEST_PATTERN.test(trimmed);
};

const normalizeEditorContextPath = (value: string | undefined) => {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "");

  if (!normalized) {
    return undefined;
  }

  if (
    normalized
      .split("/")
      .some((segment) => segment === ".." || segment === "." || !segment)
  ) {
    return undefined;
  }

  return normalized.slice(0, 512);
};

const getParentFolderPath = (path: string | undefined) => {
  if (!path) {
    return undefined;
  }

  const separatorIndex = path.lastIndexOf("/");
  if (separatorIndex <= 0) {
    return undefined;
  }

  return path.slice(0, separatorIndex);
};

const describeTraceOperation = (operation: AiPipelineOperation): string => {
  if (operation.type === "run_command") {
    const args = operation.commandArgs?.join(" ") ?? "";
    return `${operation.command}${args ? ` ${args}` : ""}`;
  }
  if (operation.type === "start_background_command") {
    const args = operation.commandArgs?.join(" ") ?? "";
    return `${operation.command}${args ? ` ${args}` : ""} (background: ${operation.key})`;
  }
  if (operation.type === "rename_path") {
    return `${operation.path} → ${operation.newPath}`;
  }
  return (operation as { path: string }).path ?? "unknown";
};

const buildExecutionTraceSummary = (
  reasoningDetails: unknown,
): string | null => {
  if (
    typeof reasoningDetails !== "object" ||
    reasoningDetails === null
  ) {
    return null;
  }

  const record = reasoningDetails as Record<string, unknown>;
  const trace = parseAiExecutionTrace(record.executionTrace);
  if (!trace || trace.operationResults.length === 0) {
    return null;
  }

  const lines: string[] = ["[Previous AI Actions]"];

  // Summarize file operations
  const fileOps = trace.operationResults.filter(
    (r) =>
      r.operation.type !== "run_command" &&
      r.operation.type !== "start_background_command",
  );
  const appliedFiles = fileOps.filter((r) => r.status === "applied");
  const failedFiles = fileOps.filter((r) => r.status === "failed");

  if (appliedFiles.length > 0) {
    const filePaths = appliedFiles
      .map((r) => describeTraceOperation(r.operation))
      .slice(0, 15);
    const suffix =
      appliedFiles.length > 15
        ? ` (+${appliedFiles.length - 15} more)`
        : "";
    lines.push(
      `- Created/modified ${appliedFiles.length} files: ${filePaths.join(", ")}${suffix}`,
    );
  }

  if (failedFiles.length > 0) {
    for (const f of failedFiles.slice(0, 5)) {
      lines.push(
        `- FAILED: ${f.operation.type} ${describeTraceOperation(f.operation)} — ${f.message.slice(0, 150)}`,
      );
    }
  }

  // Summarize command operations
  const commandOps = trace.operationResults.filter(
    (r) =>
      r.operation.type === "run_command" ||
      r.operation.type === "start_background_command",
  );

  for (const cmd of commandOps) {
    const cmdDesc = describeTraceOperation(cmd.operation);
    if (cmd.status === "applied") {
      lines.push(`- Ran: ${cmdDesc} → OK`);
    } else if (cmd.status === "failed") {
      lines.push(
        `- Ran: ${cmdDesc} → FAILED: ${cmd.message.slice(0, 200)}`,
      );
    } else if (cmd.status === "skipped") {
      lines.push(`- Skipped: ${cmdDesc} — ${cmd.message.slice(0, 100)}`);
    }
  }

  return lines.length > 1 ? lines.join("\n") : null;
};

const buildConversationHistoryBlock = (
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    status?: string;
    _id: string;
    reasoning_details?: unknown;
  }>,
  userMessageId: string,
  assistantMessageId: string,
) => {
  const historyMessages = messages
    .filter((historyMessage) => {
      if (!historyMessage.content) return false;
      if (historyMessage.status === "processing") return false;
      if (historyMessage.status === "failed") return false;
      if (historyMessage.status === "cancelled") return false;
      if (historyMessage._id === userMessageId) return false;
      if (historyMessage._id === assistantMessageId) return false;
      return true;
    })
    .slice(-MAX_HISTORY_MESSAGES);

  return historyMessages
    .map((historyMessage) => {
      const role = historyMessage.role === "assistant" ? "Assistant" : "User";
      const contentBlock = `${role}: ${historyMessage.content}`;

      // Append execution trace summary for assistant messages (if available and enabled)
      if (
        ENABLE_TRACE_HISTORY &&
        historyMessage.role === "assistant" &&
        historyMessage.reasoning_details
      ) {
        const traceSummary = buildExecutionTraceSummary(
          historyMessage.reasoning_details,
        );
        if (traceSummary) {
          return `${contentBlock}\n\n${traceSummary}`;
        }
      }

      return contentBlock;
    })
    .join("\n\n");
};

const generateFallbackConversationReply = async (args: {
  systemContext: string;
  history: string;
  message: string;
  webContext?: string;
}) => {
  const fallbackPrompt = [
    args.systemContext,
    args.history ? ["", "Conversation history:", args.history].join("\n") : "",
    args.webContext
      ? ["", "Web context from referenced URLs:", args.webContext].join("\n")
      : "",
    "",
    "User request:",
    args.message,
    "",
    "Return a concise, practical coding answer.",
  ]
    .filter(Boolean)
    .join("\n");

  return await generateGeminiCompletion({
    model: GEMINI_MODEL,
    messages: [{ role: "user", content: fallbackPrompt }],
  });
};

export const conversationMessageRequested = inngest.createFunction(
  {
    id: "orbit-conversation-message-requested",
    triggers: [{ event: "orbit/conversation.message.requested" }],
    cancelOn: [
      {
        event: "orbit/conversation.message.cancelled",
        if: "async.data.assistantMessageId == event.data.assistantMessageId && async.data.userId == event.data.userId",
      },
    ],
    concurrency: {
      limit: Number.parseInt(
        process.env.CONVERSATION_PROCESSING_CONCURRENCY ?? "4",
        10,
      ),
    },
    retries: 0,
  },
  async ({ event, step }) => {
    const payload = event.data as ConversationMessageRequestedEvent;
    const {
      conversationId,
      userMessageId,
      assistantMessageId,
      message,
      activeFilePath,
      activeFolderPath,
    } = payload;

    const normalizedActiveFilePath = normalizeEditorContextPath(activeFilePath);
    const normalizedActiveFolderPath =
      normalizeEditorContextPath(activeFolderPath) ??
      getParentFolderPath(normalizedActiveFilePath);
    const executionTargetContextLines = [
      normalizedActiveFilePath
        ? `- Active editor file: ${normalizedActiveFilePath}`
        : "",
      normalizedActiveFolderPath
        ? `- Active editor folder: ${normalizedActiveFolderPath}`
        : "",
    ].filter(Boolean);
    const plannerMessage =
      executionTargetContextLines.length > 0
        ? [
            message,
            "",
            "Execution target hints from editor context:",
            ...executionTargetContextLines,
          ].join("\n")
        : message;

    try {
      const conversation = await step.run("load-conversation", async () => {
        return await convex.query(api.system.getConversationById, {
          conversationId: conversationId as Id<"conversations">,
        });
      });

      if (!conversation) {
        throw new Error("Conversation not found");
      }

      const wasAlreadyCancelled = await step.run(
        "check-cancelled-before-work",
        async () => isAssistantMessageCancelled(assistantMessageId),
      );
      if (wasAlreadyCancelled) {
        return {
          conversationId,
          assistantMessageId,
          status: "cancelled",
        };
      }

      const existingMessages = await step.run(
        "load-message-history",
        async () => {
          return await convex.query(api.system.getMessagesByConversation, {
            conversationId: conversationId as Id<"conversations">,
          });
        },
      );

      const projectFiles = await step.run("load-project-files", async () => {
        return await convex.query(api.system.getProjectFiles, {
          projectId: conversation.projectId,
        });
      });

      const projectFileNodes: ProjectFileTreeNode[] = projectFiles.map(
        (file) => ({
          name: file.name,
          type: file.type,
          parentId: file.parentId ?? null,
          _id: file._id,
          content: file.content,
        }),
      );

      const conversationProjectFiles =
        buildConversationProjectFiles(projectFileNodes);

      const projectPathIndex = conversationProjectFiles
        .map((file) =>
          file.type === "folder"
            ? `[folder] ${file.path}`
            : `[file] ${file.path}`,
        )
        .join("\n");

      const contextQuery = [
        plannerMessage,
        ...existingMessages
          .filter((historyMessage) => historyMessage._id !== assistantMessageId)
          .map((historyMessage) => historyMessage.content.trim())
          .filter(Boolean)
          .slice(-MAX_HISTORY_MESSAGES),
      ].join("\n");

      const projectContext = await step.run(
        "build-project-context",
        async () => {
          const fileTree = buildFileTree(projectFileNodes);

          const fileContents = buildRelevantProjectFileContext({
            files: conversationProjectFiles,
            query: contextQuery,
          });

          return { fileTree, fileContents };
        },
      );

      const webContext = await step.run(
        "scrape-message-web-context",
        async () => {
          return await buildWebContextFromText(message);
        },
      );

      const systemContext = [
        "You are Orbit AI, an intelligent coding assistant embedded in the Orbit code editor.",
        "You help developers write, debug, refactor, and understand code.",
        "Be concise, accurate, and helpful. Provide code examples when relevant.",
        "Use markdown formatting for code blocks, lists, and emphasis.",
        ...(executionTargetContextLines.length > 0
          ? ["", "Active editor context:", ...executionTargetContextLines]
          : []),
        "",
        "Project path index:",
        projectPathIndex || "(empty project)",
        "",
        "Project file structure:",
        projectContext.fileTree || "(empty project)",
        ...(projectContext.fileContents.length > 0
          ? ["", "Key project files:", ...projectContext.fileContents]
          : []),
      ].join("\n");

      const conversationHistory = buildConversationHistoryBlock(
        existingMessages,
        userMessageId,
        assistantMessageId,
      );
      const shouldTitleConversation =
        ENABLE_CONVERSATION_AI_TITLE &&
        shouldGenerateConversationTitle(conversation.title) &&
        !shouldSkipAiTitleForMessage(message) &&
        existingMessages.filter(
          (historyMessage) => historyMessage.role === "user",
        ).length <= 1;

      const titlePromise = shouldTitleConversation
        ? generateConversationTitle(message).catch(() => null)
        : Promise.resolve(null);

      const [generatedTitle, orchestration] = await Promise.all([
        titlePromise,
        (async () => {
          try {
            return await runConversationAgentOrchestration({
              message: plannerMessage,
              projectContext: systemContext,
              history: conversationHistory,
              webContext: webContext.markdown,
              projectFiles: conversationProjectFiles,
              executeFileOperation: async (operation) => {
                if (await isAssistantMessageCancelled(assistantMessageId)) {
                  return {
                    status: "skipped",
                    message: "Skipped because the response was cancelled.",
                  } satisfies ConversationFileOperationExecutionResult;
                }

                return await executeConversationFileOperation({
                  projectId: conversation.projectId,
                  operation,
                  projectFiles: conversationProjectFiles,
                });
              },
              loadProjectFilesAfterOperations: async () => {
                if (await isAssistantMessageCancelled(assistantMessageId)) {
                  return conversationProjectFiles;
                }

                const latestFiles = await convex.query(
                  api.system.getProjectFiles,
                  {
                    projectId: conversation.projectId,
                  },
                );

                const latestFileNodes: ProjectFileTreeNode[] = latestFiles.map(
                  (file) => ({
                    name: file.name,
                    type: file.type,
                    parentId: file.parentId ?? null,
                    _id: file._id,
                    content: file.content,
                  }),
                );

                return buildConversationProjectFiles(latestFileNodes);
              },
            });
          } catch (orchestrationError) {
            const classified = classifyError(orchestrationError);
            console.warn("conversation.orchestration.fallback", {
              assistantMessageId,
              conversationId,
              reason: classified.message,
              category: classified.category,
            });

            const fallback = await generateFallbackConversationReply({
              systemContext,
              history: conversationHistory,
              message,
              webContext: webContext.markdown,
            });

            return {
              content: fallback.content,
              assignments: [],
              reports: [],
              supervisorPlan: "fallback-direct-gemini",
              operations: [],
              operationResults: [],
              fileOperationPlannerOutput: `fallback due to: ${classified.message}`,
            };
          }
        })(),
      ]);

      console.info("conversation.orchestration.summary", {
        assistantMessageId,
        conversationId,
        assignments: orchestration.assignments.length,
        operationsPlanned: orchestration.operations.length,
        operationsApplied: orchestration.operationResults.filter(
          (result) => result.status === "applied",
        ).length,
        operationsFailed: orchestration.operationResults.filter(
          (result) => result.status === "failed",
        ).length,
        plannerOutputPreview: orchestration.fileOperationPlannerOutput
          .slice(0, 300)
          .trim(),
      });

      if (generatedTitle) {
        await step.run("save-conversation-title", async () => {
          await convex.mutation(api.system.updateConversationTitle, {
            conversationId: conversationId as Id<"conversations">,
            title: generatedTitle,
          });
        });
      }

      const wasCancelledBeforeSave = await step.run(
        "check-cancelled-before-save",
        async () => isAssistantMessageCancelled(assistantMessageId),
      );
      if (wasCancelledBeforeSave) {
        return {
          conversationId,
          assistantMessageId,
          status: "cancelled",
        };
      }

      const saved = await step.run("save-assistant-message", async () => {
        const executionTrace = buildConversationExecutionTrace({
          operations: orchestration.operations,
          operationResults:
            orchestration.operationResults as OrchestrationOperationResult[],
        });

        return await updateAssistantMessage({
          assistantMessageId,
          content: orchestration.content,
          status: "completed",
          reasoningDetails: {
            executionTrace,
          },
        });
      });

      console.info("conversation.orchestration.persisted", {
        assistantMessageId,
        conversationId,
        saved,
        operationsPlanned: orchestration.operations.length,
      });

      return {
        conversationId,
        assistantMessageId,
        assignments: orchestration.assignments,
        operations: orchestration.operations,
        operationResults: orchestration.operationResults,
        status: saved ? "completed" : "cancelled",
      };
    } catch (error) {
      const wasCancelledAfterError = await step.run(
        "check-cancelled-after-error",
        async () => isAssistantMessageCancelled(assistantMessageId),
      );
      if (wasCancelledAfterError) {
        return {
          conversationId,
          assistantMessageId,
          status: "cancelled",
        };
      }

      const classified = classifyError(error);

      try {
        await step.run("save-assistant-message-error", async () => {
          await updateAssistantMessage({
            assistantMessageId,
            content: classified.message,
            status: "failed",
          });
        });
      } catch (updateError) {
        console.error("conversation.message.error-save-failed", updateError);
      }

      throw error;
    }
  },
);

export const codeCompletionRequested = inngest.createFunction(
  {
    id: "orbit-code-completion-requested",
    triggers: [{ event: "orbit/code-completion.requested" }],
    concurrency: {
      limit: Number.parseInt(
        process.env.SUGGESTION_PROCESSING_CONCURRENCY ?? "4",
        10,
      ),
    },
    rateLimit: {
      limit: Number.parseInt(
        process.env.SUGGESTION_PROCESSING_RATE_LIMIT ?? "180",
        10,
      ),
      period: "1m",
    },
    retries: 0,
  },
  async ({ event, step }) => {
    const payload = event.data as CodeCompletionRequestedEvent;
    const requestId = payload.requestId;

    suggestionRuntime.markProcessing(requestId);

    try {
      const generation = await step.run("generate-code-suggestion", () =>
        generateSuggestion(payload.mode, payload.input, {
          onRetry: ({ attempt, error }) => {
            suggestionRuntime.markRetrying(requestId, attempt, error.message);
          },
        }),
      );

      suggestionRuntime.complete({
        requestId,
        suggestion: generation.suggestion,
        model: generation.modelName,
        attempts: generation.attempts,
        latencyMs: generation.latencyMs,
      });

      return generation;
    } catch (error) {
      suggestionRuntime.fail({
        requestId,
        error,
      });
      throw error;
    }
  },
);
