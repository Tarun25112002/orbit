import { inngest } from "@/inngest/client";
import { convex } from "@/lib/convex-client";
import { suggestionRuntime } from "@/lib/completion-runtime";
import { generateGeminiCompletion, GEMINI_MODEL_PREFERRED } from "@/lib/gemini";
import { classifyError } from "@/lib/errors";
import { withIngestSecret } from "@/lib/convex-ingest";
import { buildWebContextFromText } from "@/lib/web-context";
import {
  createSession,
  getSession,
  getContainer,
} from "@/lib/docker/session-manager";
import {
  syncFileToContainer,
  syncProjectToContainer,
} from "@/lib/docker/file-sync";
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

const GEMINI_MODEL = GEMINI_MODEL_PREFERRED;
const MAX_FILE_CONTEXT_CHARS = 30_000;
const MAX_FILE_CONTEXT_CHARS_PER_FILE = 8_000;
const MAX_CONTEXT_FILES = 20;
const MAX_HISTORY_MESSAGES = 10;
const SANDBOX_COMMAND_TIMEOUT_MS = 300_000;
const SANDBOX_MAX_OUTPUT_CHARS = Math.max(
  8_000,
  Number.parseInt(
    process.env.CONVERSATION_SANDBOX_MAX_OUTPUT_CHARS ?? "16000",
    10,
  ) || 16_000,
);
const SANDBOX_OUTPUT_MAX_BYTES = SANDBOX_MAX_OUTPUT_CHARS * 6;
const SANDBOX_BACKGROUND_STARTUP_TIMEOUT_MS = Math.max(
  1_000,
  Number.parseInt(
    process.env.CONVERSATION_BACKGROUND_STARTUP_TIMEOUT_MS ?? "12000",
    10,
  ) || 12_000,
);
const SANDBOX_INSTALL_TIMEOUT_MS = Math.max(
  SANDBOX_COMMAND_TIMEOUT_MS,
  Number.parseInt(
    process.env.CONVERSATION_SANDBOX_INSTALL_TIMEOUT_MS ?? "600000",
    10,
  ) || 600_000,
);
const SANDBOX_INSTALL_MAX_ATTEMPTS = Math.max(
  1,
  Number.parseInt(
    process.env.CONVERSATION_SANDBOX_INSTALL_MAX_ATTEMPTS ?? "3",
    10,
  ) || 3,
);
const SANDBOX_INSTALL_RETRY_BASE_MS = Math.max(
  500,
  Number.parseInt(
    process.env.CONVERSATION_SANDBOX_INSTALL_RETRY_BASE_MS ?? "1500",
    10,
  ) || 1_500,
);
const DOCKER_MUX_HEADER_BYTES = 8;
const DOCKER_MUX_MAX_FRAME_BYTES = 8 * 1024 * 1024;
const SANDBOX_SESSION_MISSING_PATTERN =
  /\b(session|container)\b[\s\S]*\bnot found\b|no such container/i;
const ALLOW_CLIENT_COMMAND_FALLBACK = /^(1|true)$/i.test(
  process.env.CONVERSATION_ALLOW_CLIENT_COMMAND_FALLBACK?.trim() ?? "",
);
const ENABLE_CONVERSATION_AI_TITLE = /^(1|true)$/i.test(
  process.env.CONVERSATION_ENABLE_AI_TITLE?.trim() ?? "",
);
const ENABLE_TRACE_HISTORY = !/^(0|false)$/i.test(
  process.env.CONVERSATION_ENABLE_TRACE_HISTORY?.trim() ?? "true",
);
const EXECUTABLE_ORCHESTRATION_INTENT_PATTERN =
  /\b(create|add|delete|remove|rename|move|update|edit|modify|write|rewrite|refactor|fix|implement|generate|scaffold|setup|build|install|uninstall|upgrade|downgrade|run|execute|command|terminal|dependency|dependencies|file|files|folder|folders|project|codebase|app)\b/i;
const EXPLICIT_EXECUTION_DIRECTIVE_PATTERN =
  /\b(do it|apply(?:\s+it)?|apply changes|make changes|edit files|update files|create files|run commands?|execute commands?|in (?:my|this|the) (?:project|workspace|repo|codebase)|for this project|step\s*by\s*step)\b/i;
const ANALYSIS_ONLY_REQUEST_PATTERN =
  /\b(how\s+do\s+i|how\s+to|what\s+is|why\s+is|can\s+you\s+explain|explain|describe|walk\s+me\s+through|show\s+me\s+how)\b/i;
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

const sanitizeCommandOutput = (value: string) => {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\uFFFD/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
};

const buildCommandOutputPreview = (output: string) => {
  const normalized = sanitizeCommandOutput(output);
  if (!normalized) {
    return "";
  }

  const lines = normalized
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return "";
  }

  const joined = lines.join("\n");
  if (joined.length <= SANDBOX_MAX_OUTPUT_CHARS && lines.length <= 20) {
    return joined;
  }

  const head = lines.slice(0, 8);
  const tail = lines.slice(-8);
  const omitted = Math.max(0, lines.length - head.length - tail.length);

  return [
    ...head,
    omitted > 0 ? `... [${omitted} lines omitted] ...` : "",
    ...tail,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, SANDBOX_MAX_OUTPUT_CHARS);
};

const createExecOutputCollector = (maxBytes: number) => {
  const chunks: Buffer[] = [];
  let totalLength = 0;
  let pending = Buffer.alloc(0);
  let parseAsMux = true;

  const appendChunk = (chunk: Buffer) => {
    if (chunk.length === 0 || totalLength >= maxBytes) {
      return;
    }

    const remaining = maxBytes - totalLength;
    const nextChunk =
      chunk.length <= remaining ? chunk : chunk.subarray(0, remaining);
    chunks.push(nextChunk);
    totalLength += nextChunk.length;
  };

  const push = (chunk: Buffer) => {
    if (!parseAsMux) {
      appendChunk(chunk);
      return;
    }

    pending = Buffer.concat([pending, chunk]);

    while (pending.length >= DOCKER_MUX_HEADER_BYTES) {
      const streamType = pending[0];
      const hasReservedZeroes =
        pending[1] === 0 && pending[2] === 0 && pending[3] === 0;
      const frameSize = pending.readUInt32BE(4);

      const looksLikeHeader =
        (streamType === 0 || streamType === 1 || streamType === 2) &&
        hasReservedZeroes &&
        frameSize >= 0 &&
        frameSize <= DOCKER_MUX_MAX_FRAME_BYTES;

      if (!looksLikeHeader) {
        parseAsMux = false;
        appendChunk(pending);
        pending = Buffer.alloc(0);
        return;
      }

      const fullFrameSize = DOCKER_MUX_HEADER_BYTES + frameSize;
      if (pending.length < fullFrameSize) {
        return;
      }

      appendChunk(pending.subarray(DOCKER_MUX_HEADER_BYTES, fullFrameSize));
      pending = pending.subarray(fullFrameSize);
    }
  };

  const finish = () => {
    if (pending.length > 0) {
      appendChunk(pending);
      pending = Buffer.alloc(0);
    }

    return sanitizeCommandOutput(Buffer.concat(chunks).toString("utf-8"));
  };

  return {
    push,
    finish,
  };
};

const isSandboxSessionMissingError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const statusCode =
    typeof (error as { statusCode?: number }).statusCode === "number"
      ? (error as { statusCode?: number }).statusCode
      : undefined;

  return statusCode === 404 || SANDBOX_SESSION_MISSING_PATTERN.test(message);
};

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
    const outputCollector = createExecOutputCollector(SANDBOX_OUTPUT_MAX_BYTES);
    let timedOut = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      try {
        execStream.destroy();
      } catch {

      }
      resolve({ exitCode: 1, output: "Command timed out." });
    }, args.timeoutMs ?? SANDBOX_COMMAND_TIMEOUT_MS);

    execStream.on("data", (chunk: Buffer) => {
      outputCollector.push(chunk);
    });

    execStream.on("end", () => {
      if (timedOut) return;
      clearTimeout(timeoutId);

      exec
        .inspect()
        .then((info) => {
          const output = outputCollector
            .finish()
            .slice(0, SANDBOX_MAX_OUTPUT_CHARS);
          resolve({ exitCode: info.ExitCode ?? 0, output });
        })
        .catch(() => {
          const output = outputCollector
            .finish()
            .slice(0, SANDBOX_MAX_OUTPUT_CHARS);
          resolve({ exitCode: 1, output });
        });
    });

    execStream.on("error", () => {
      if (timedOut) return;
      clearTimeout(timeoutId);
      const output = outputCollector
        .finish()
        .slice(0, SANDBOX_MAX_OUTPUT_CHARS);
      resolve({ exitCode: 1, output });
    });
  });
};

const ensureSandboxForProject = async (args: {
  projectId: Id<"projects">;
  projectFiles: ConversationProjectFile[];
}): Promise<string> => {
  const sessionId = `inngest-${args.projectId}`;
  const syncStartedDirtyVersion = getSandboxDirtyVersion(args.projectId);

  const existing = getSession(sessionId);
  if (!existing) {
    await createSession(sessionId, "node", {
      projectKey: String(args.projectId),
    });
  }

  const filesToSync = args.projectFiles
    .filter(
      (
        file,
      ): file is ConversationProjectFile & { type: "file"; content: string } =>
        file.type === "file" && typeof file.content === "string",
    )
    .map((file) => ({ path: file.path, content: file.content }));

  if (filesToSync.length > 0) {
    await syncProjectToContainer(sessionId, filesToSync);
  }

  markSandboxCleanAfterFullSync(args.projectId, syncStartedDirtyVersion);

  return sessionId;
};

const activeSandboxSessions = new Map<string, string>();
const sandboxNeedsResync = new Map<string, boolean>();
const sandboxDirtyVersions = new Map<string, number>();

const getSandboxDirtyVersion = (projectId: Id<"projects">) =>
  sandboxDirtyVersions.get(projectId) ?? 0;

const markSandboxDirty = (projectId: Id<"projects">) => {
  sandboxDirtyVersions.set(projectId, getSandboxDirtyVersion(projectId) + 1);
  sandboxNeedsResync.set(projectId, true);
};

const markSandboxCleanAfterFullSync = (
  projectId: Id<"projects">,
  syncedDirtyVersion: number,
) => {
  if (getSandboxDirtyVersion(projectId) === syncedDirtyVersion) {
    sandboxNeedsResync.set(projectId, false);
  }
};

const markSandboxCleanAfterIncrementalSync = (
  projectId: Id<"projects">,
  syncStartedDirtyVersion: number,
) => {
  if (
    sandboxNeedsResync.get(projectId) !== true &&
    getSandboxDirtyVersion(projectId) === syncStartedDirtyVersion
  ) {
    sandboxNeedsResync.set(projectId, false);
  }
};

const loadLatestProjectFilesForSandbox = async (
  projectId: Id<"projects">,
): Promise<ConversationProjectFile[]> => {
  const latestFiles = await convex.query(
    api.system.getProjectFiles,
    withIngestSecret({ projectId }),
  );

  const latestFileNodes: ProjectFileTreeNode[] = latestFiles.map((file) => ({
    name: file.name,
    type: file.type,
    parentId: file.parentId ?? null,
    _id: file._id,
    content: file.content,
  }));

  return buildConversationProjectFiles(latestFileNodes);
};

const normalizeSandboxPath = (path: string) =>
  path.trim().replace(/\\/g, "/").replace(/^\/+/g, "");

const toWorkspacePath = (path: string) =>
  `/workspace/${normalizeSandboxPath(path)}`;

const quoteForShell = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;

const buildShellCommand = (command: string, commandArgs: string[] = []) =>
  [command, ...commandArgs].map((part) => quoteForShell(part)).join(" ");

const NPM_STABLE_INSTALL_FLAGS = [
  "--legacy-peer-deps",
  "--no-audit",
  "--no-fund",
  "--no-progress",
  "--loglevel=error",
];
const NPM_STABLE_CI_FLAGS = [
  "--no-audit",
  "--no-fund",
  "--no-progress",
  "--loglevel=error",
];
const INSTALL_NETWORK_ERROR_PATTERN =
  /ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|network|fetch failed|socket hang up|temporary failure|certificate|tls/i;
const INSTALL_PEER_DEP_ERROR_PATTERN =
  /ERESOLVE|peer dep|conflicting peer dependency/i;
const INSTALL_COMMAND_NOT_FOUND_PATTERN =
  /\b(not found|command not found|ENOENT)\b/i;
const NPM_CI_DESYNC_PATTERN =
  /npm ci[\s\S]*?(package-lock\.json|package\.json)[\s\S]*?(sync|missing|out of date|out-of-date)/i;
const INSTALL_TIMEOUT_PATTERN = /timed out|timeout/i;

const normalizeNpmInstallArgs = (args: string[]) => {
  const normalized = args.length > 0 ? [...args] : ["install"];
  const mode = normalized[0]?.trim().toLowerCase();
  const flags = mode === "ci" ? NPM_STABLE_CI_FLAGS : NPM_STABLE_INSTALL_FLAGS;
  const existingFlags = new Set(
    normalized.map((arg) => arg.trim().toLowerCase()),
  );

  for (const flag of flags) {
    if (!existingFlags.has(flag)) {
      normalized.push(flag);
    }
  }

  return normalized;
};

const isDependencyInstallCommand = (operation: ConversationFileOperation) => {
  if (operation.type !== "run_command") {
    return false;
  }

  const command = operation.command.trim().toLowerCase();
  const args =
    operation.commandArgs
      ?.map((arg) => arg.trim().toLowerCase())
      .filter(Boolean) ?? [];

  if (command === "yarn") {
    return args.length === 0 || args[0] === "install";
  }

  if (command === "npm" || command === "pnpm" || command === "bun") {
    if (args.length === 0) {
      return command === "npm";
    }
    return args[0] === "install" || args[0] === "i" || args[0] === "ci";
  }

  return false;
};

const normalizeInstallCommandSpec = (operation: ConversationFileOperation) => {
  if (
    operation.type !== "run_command" ||
    !isDependencyInstallCommand(operation)
  ) {
    return null;
  }

  const command = operation.command.trim();
  const commandLower = command.toLowerCase();
  const args = operation.commandArgs ?? [];

  if (commandLower === "npm") {
    return {
      command,
      commandArgs: normalizeNpmInstallArgs(args),
    };
  }

  return {
    command,
    commandArgs: args,
  };
};

const withAddedFlag = (args: string[], flag: string) => {
  const existing = new Set(args.map((arg) => arg.trim().toLowerCase()));
  if (existing.has(flag.toLowerCase())) {
    return args;
  }

  return [...args, flag];
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const runInstallWithRetries = async (args: {
  run: (
    commandToRun: string,
    timeoutMs: number,
  ) => Promise<{
    exitCode: number;
    output: string;
  }>;
  command: string;
  commandArgs?: string[];
}) => {
  let command = args.command;
  let commandArgs = args.commandArgs ?? [];
  let attempts = 0;
  let lastResult: { exitCode: number; output: string } = {
    exitCode: 1,
    output: "",
  };
  const notes: string[] = [];

  while (attempts < SANDBOX_INSTALL_MAX_ATTEMPTS) {
    attempts += 1;
    const commandLine = buildShellCommand(command, commandArgs);

    lastResult = await args.run(commandLine, SANDBOX_INSTALL_TIMEOUT_MS);
    if (lastResult.exitCode === 0) {
      break;
    }

    const outputLower = lastResult.output.toLowerCase();
    const commandLower = command.trim().toLowerCase();
    const isTimeout = INSTALL_TIMEOUT_PATTERN.test(outputLower);
    const isNetworkError =
      INSTALL_NETWORK_ERROR_PATTERN.test(outputLower) || isTimeout;
    const isPeerDepError = INSTALL_PEER_DEP_ERROR_PATTERN.test(outputLower);
    const isCommandMissing =
      INSTALL_COMMAND_NOT_FOUND_PATTERN.test(outputLower) &&
      outputLower.includes(commandLower);

    if (commandLower !== "npm" && isCommandMissing) {
      notes.push(
        `Package manager '${command}' missing; retrying with npm install.`,
      );
      command = "npm";
      commandArgs = normalizeNpmInstallArgs(["install"]);
      continue;
    }

    if (commandLower === "npm") {
      const firstArg = commandArgs[0]?.trim().toLowerCase();
      if (firstArg === "ci" && NPM_CI_DESYNC_PATTERN.test(outputLower)) {
        notes.push(
          "npm ci failed due to lockfile mismatch; retrying with npm install.",
        );
        commandArgs = normalizeNpmInstallArgs(["install"]);
        continue;
      }

      if (isPeerDepError) {
        const nextArgs = withAddedFlag(commandArgs, "--force");
        if (nextArgs !== commandArgs) {
          notes.push(
            "Dependency resolution failed; retrying npm install with --force.",
          );
          commandArgs = nextArgs;
          continue;
        }
      }
    }

    if (isNetworkError && attempts < SANDBOX_INSTALL_MAX_ATTEMPTS) {
      const backoff = SANDBOX_INSTALL_RETRY_BASE_MS * attempts;
      notes.push(`Transient network error; retrying in ${backoff}ms.`);
      await sleep(backoff);
      continue;
    }

    break;
  }

  return {
    exitCode: lastResult.exitCode,
    output: lastResult.output,
    attempts,
    command,
    commandArgs,
    notes,
  };
};

const ORBIT_VALIDATE_COMMAND = "orbit-validate";

/**
 * Pre-dev validation for the AI sandbox. Must stay lightweight: running
 * `npm run build` or `vite build` here gates `start_background_command` for
 * the dev server (`gatedOnPreviousSuccess`), and those builds often fail on
 * WIP codegen even when `npm run dev` works — causing endless fixup loops.
 */
const buildSandboxValidationCommandScript = () =>
  [
    "if [ ! -f package.json ]; then echo 'No package.json found; skipping package validation.'; exit 0; fi",
    "validation_target=$(node -e \"const pkg=require('./package.json'); const s=pkg.scripts||{}; if (s.typecheck) process.stdout.write('typecheck'); else if (s.check) process.stdout.write('check'); else if (s.build) process.stdout.write('light'); else process.stdout.write('auto');\")",
    'case "$validation_target" in',
    "  typecheck) npm run typecheck ;;",
    "  check) npm run check ;;",
    "  light)",
    "    echo '[orbit-validate] pre-dev: skipping full build (use CI or npm run build manually).';",
    "    if [ -x node_modules/.bin/tsc ] && [ -f tsconfig.json ]; then node_modules/.bin/tsc --noEmit;",
    "    else echo '[orbit-validate] no tsc/tsconfig; nothing to validate before dev.'; exit 0; fi",
    "    ;;",
    "  auto)",
    "    if [ -x node_modules/.bin/tsc ] && [ -f tsconfig.json ]; then node_modules/.bin/tsc --noEmit;",
    "    else echo '[orbit-validate] auto: no tsc; skipping (dev server will surface runtime errors).'; exit 0; fi",
    "    ;;",
    '  *) echo "Unknown validation target: $validation_target"; exit 1 ;;',
    "esac",
  ].join("\n");

const sanitizeBackgroundCommandKey = (value: string) => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 64);

  return normalized || "background-command";
};

const buildBackgroundCommandScript = (args: {
  key: string;
  command: string;
}) => {
  const key = sanitizeBackgroundCommandKey(args.key);
  const stateDir = "/workspace/.orbit/background";
  const pidFile = `${stateDir}/${key}.pid`;
  const logFile = `${stateDir}/${key}.log`;
  const startupSeconds = Math.max(
    1,
    Math.ceil(SANDBOX_BACKGROUND_STARTUP_TIMEOUT_MS / 1000),
  );

  return [
    `mkdir -p ${quoteForShell(stateDir)}`,
    `if [ -f ${quoteForShell(pidFile)} ] && kill -0 "$(cat ${quoteForShell(pidFile)})" 2>/dev/null; then kill "$(cat ${quoteForShell(pidFile)})" 2>/dev/null || true; sleep 1; fi`,
    `: > ${quoteForShell(logFile)}`,
    `nohup sh -lc ${quoteForShell(args.command)} > ${quoteForShell(logFile)} 2>&1 < /dev/null &`,
    `pid=$!`,
    `printf "%s" "$pid" > ${quoteForShell(pidFile)}`,
    `echo "Started background command '${key}' with pid $pid."`,
    `sleep ${startupSeconds}`,
    `if kill -0 "$pid" 2>/dev/null; then echo "--- startup log ---"; tail -n 120 ${quoteForShell(logFile)} 2>/dev/null || true; exit 0; fi`,
    `wait "$pid"; code=$?`,
    `echo "--- startup log ---"`,
    `tail -n 160 ${quoteForShell(logFile)} 2>/dev/null || true`,
    `exit "$code"`,
  ].join("; ");
};

const getParentPath = (path: string) => {
  const normalized = normalizeSandboxPath(path);
  const separatorIndex = normalized.lastIndexOf("/");
  if (separatorIndex <= 0) {
    return "";
  }

  return normalized.slice(0, separatorIndex);
};

const execContainerShell = async (args: {
  sessionId: string;
  command: string;
}) => {
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

  const stream = await exec.start({ Detach: false, Tty: false });
  await new Promise<void>((resolve, reject) => {
    stream.on("end", resolve);
    stream.on("error", reject);
    stream.resume();
  });

  const info = await exec.inspect();
  if ((info.ExitCode ?? 0) !== 0) {
    throw new Error(
      `Container command failed (exit ${info.ExitCode ?? 1}): ${args.command}`,
    );
  }
};

const syncAppliedOperationToActiveSandbox = async (args: {
  projectId: Id<"projects">;
  operation: ConversationFileOperation;
}) => {
  const sessionId = activeSandboxSessions.get(args.projectId);
  if (!sessionId) {
    markSandboxDirty(args.projectId);
    return;
  }

  const syncStartedDirtyVersion = getSandboxDirtyVersion(args.projectId);

  try {
    if (
      args.operation.type === "create_file" ||
      args.operation.type === "update_file"
    ) {
      await syncFileToContainer(
        sessionId,
        args.operation.path,
        args.operation.content,
      );
      markSandboxCleanAfterIncrementalSync(
        args.projectId,
        syncStartedDirtyVersion,
      );
      return;
    }

    if (args.operation.type === "create_folder") {
      await execContainerShell({
        sessionId,
        command: `mkdir -p ${quoteForShell(toWorkspacePath(args.operation.path))}`,
      });
      markSandboxCleanAfterIncrementalSync(
        args.projectId,
        syncStartedDirtyVersion,
      );
      return;
    }

    if (args.operation.type === "delete_path") {
      await execContainerShell({
        sessionId,
        command: `rm -rf ${quoteForShell(toWorkspacePath(args.operation.path))}`,
      });
      markSandboxCleanAfterIncrementalSync(
        args.projectId,
        syncStartedDirtyVersion,
      );
      return;
    }

    if (args.operation.type === "rename_path") {
      const targetParent = getParentPath(args.operation.newPath);
      if (targetParent && args.operation.createMissingParents !== false) {
        await execContainerShell({
          sessionId,
          command: `mkdir -p ${quoteForShell(`/workspace/${targetParent}`)}`,
        });
      }

      await execContainerShell({
        sessionId,
        command: `mv ${quoteForShell(toWorkspacePath(args.operation.path))} ${quoteForShell(toWorkspacePath(args.operation.newPath))}`,
      });
      markSandboxCleanAfterIncrementalSync(
        args.projectId,
        syncStartedDirtyVersion,
      );
      return;
    }
  } catch (error) {
    console.warn("conversation.sandbox.sync-operation.failed", {
      projectId: args.projectId,
      operationType: args.operation.type,
      error: error instanceof Error ? error.message : String(error),
    });
    markSandboxDirty(args.projectId);
  }
};

const executeConversationFileOperation = async (args: {
  projectId: Id<"projects">;
  operation: ConversationFileOperation;
  projectFiles?: ConversationProjectFile[];
}): Promise<ConversationFileOperationExecutionResult> => {
  const { projectId, operation } = args;

  try {
    if (
      operation.type === "run_command" ||
      operation.type === "start_background_command"
    ) {
      const installCommandSpec = normalizeInstallCommandSpec(operation);
      const commandSpec = installCommandSpec ?? {
        command: operation.command,
        commandArgs: operation.commandArgs,
      };
      const displayCommand = [
        commandSpec.command,
        ...(commandSpec.commandArgs ?? []),
      ].join(" ");
      const shellCommand = buildShellCommand(
        commandSpec.command,
        commandSpec.commandArgs ?? [],
      );
      const label =
        operation.type === "start_background_command"
          ? `background command (${operation.key})`
          : "command";

      const resolveCommandToRun = (override?: string) => {
        if (override) {
          return override;
        }

        if (operation.type === "start_background_command") {
          return buildBackgroundCommandScript({
            key: operation.key,
            command: shellCommand,
          });
        }

        if (operation.command === ORBIT_VALIDATE_COMMAND) {
          return buildSandboxValidationCommandScript();
        }

        return shellCommand;
      };

      const resolveTimeoutMs = (override?: number) =>
        override ??
        (operation.type === "start_background_command"
          ? SANDBOX_BACKGROUND_STARTUP_TIMEOUT_MS + 5_000
          : SANDBOX_COMMAND_TIMEOUT_MS);

      const runSandboxCommand = async (
        forceResync?: boolean,
        commandOverride?: string,
        timeoutOverride?: number,
      ) => {
        let sessionId = forceResync
          ? undefined
          : activeSandboxSessions.get(projectId);
        const needsResync =
          forceResync ||
          !sessionId ||
          sandboxNeedsResync.get(projectId) !== false;

        if (!sessionId || needsResync) {
          const latestProjectFiles =
            await loadLatestProjectFilesForSandbox(projectId);

          sessionId = await ensureSandboxForProject({
            projectId: projectId as Id<"projects">,
            projectFiles: latestProjectFiles,
          });
          activeSandboxSessions.set(projectId, sessionId);
          sandboxNeedsResync.set(projectId, false);
        }

        const commandToRun = resolveCommandToRun(commandOverride);

        return await execCommandInContainer({
          sessionId,
          command: commandToRun,
          timeoutMs: resolveTimeoutMs(timeoutOverride),
        });
      };

      const runSandboxCommandWithRecovery = async (
        commandOverride?: string,
        timeoutOverride?: number,
      ) => {
        let result: { exitCode: number; output: string } | null = null;
        let sandboxError: unknown = null;

        try {
          result = await runSandboxCommand(
            false,
            commandOverride,
            timeoutOverride,
          );
        } catch (error) {
          sandboxError = error;
        }

        if (
          !result &&
          sandboxError &&
          isSandboxSessionMissingError(sandboxError)
        ) {
          console.warn("conversation.sandbox.session.recover", {
            projectId,
            command: displayCommand,
          });

          activeSandboxSessions.delete(projectId);
          sandboxNeedsResync.set(projectId, true);

          try {
            result = await runSandboxCommand(
              true,
              commandOverride,
              timeoutOverride,
            );
          } catch (error) {
            sandboxError = error;
          }
        }

        if (result) {
          return result;
        }

        throw sandboxError ?? new Error("Unknown sandbox error");
      };

      if (operation.type === "run_command" && installCommandSpec) {
        let installResult: Awaited<
          ReturnType<typeof runInstallWithRetries>
        > | null = null;
        let sandboxError: unknown = null;

        try {
          installResult = await runInstallWithRetries({
            run: runSandboxCommandWithRecovery,
            command: installCommandSpec.command,
            commandArgs: installCommandSpec.commandArgs,
          });
        } catch (error) {
          sandboxError = error;
        }

        if (installResult) {
          const outputPreview = buildCommandOutputPreview(installResult.output);
          const exitLabel =
            installResult.exitCode === 0
              ? "succeeded"
              : `failed (exit ${installResult.exitCode})`;
          const attemptSuffix =
            installResult.attempts > 1
              ? ` after ${installResult.attempts} attempts`
              : "";
          const notesBlock =
            installResult.notes.length > 0
              ? `\n${installResult.notes.map((note) => `Note: ${note}`).join("\n")}`
              : "";
          const effectiveCommand = [
            installResult.command,
            ...(installResult.commandArgs ?? []),
          ].join(" ");

          return {
            status: installResult.exitCode === 0 ? "applied" : "failed",
            message: `Executed ${label}: ${effectiveCommand} — ${exitLabel}${attemptSuffix}.${outputPreview ? `\n${outputPreview}` : ""}${notesBlock}`,
            commandOutput: outputPreview || undefined,
            commandExitCode: installResult.exitCode,
          };
        }

        if (sandboxError) {
          console.warn("conversation.sandbox.exec.fallback", {
            projectId,
            command: displayCommand,
            error:
              sandboxError instanceof Error
                ? sandboxError.message
                : String(sandboxError),
          });

          if (!ALLOW_CLIENT_COMMAND_FALLBACK) {
            const message =
              sandboxError instanceof Error
                ? sandboxError.message
                : String(sandboxError);

            return {
              status: "failed",
              message: `Could not execute ${label} in the sandbox: ${message}`,
              commandOutput: message,
              commandExitCode: 1,
            };
          }

          return {
            status: "applied",
            message: `Queued ${label} for client-side execution: ${displayCommand}`,
          };
        }

        return {
          status: "failed",
          message: `Could not execute ${label}: unknown sandbox error`,
        };
      }

      let result: { exitCode: number; output: string } | null = null;
      let sandboxError: unknown = null;

      try {
        result = await runSandboxCommandWithRecovery();
      } catch (error) {
        sandboxError = error;
      }

      if (result) {
        const outputPreview = buildCommandOutputPreview(result.output);
        const exitLabel =
          result.exitCode === 0
            ? "succeeded"
            : `failed (exit ${result.exitCode})`;

        return {
          status: result.exitCode === 0 ? "applied" : "failed",
          message: `Executed ${label}: ${displayCommand} — ${exitLabel}.${outputPreview ? `\n${outputPreview}` : ""}`,
          commandOutput: outputPreview || undefined,
          commandExitCode: result.exitCode,
        };
      }

      if (sandboxError) {

        console.warn("conversation.sandbox.exec.fallback", {
          projectId,
          command: displayCommand,
          error:
            sandboxError instanceof Error
              ? sandboxError.message
              : String(sandboxError),
        });

        if (!ALLOW_CLIENT_COMMAND_FALLBACK) {
          const message =
            sandboxError instanceof Error
              ? sandboxError.message
              : String(sandboxError);

          return {
            status: "failed",
            message: `Could not execute ${label} in the sandbox: ${message}`,
            commandOutput: message,
            commandExitCode: 1,
          };
        }

        return {
          status: "applied",
          message: `Queued ${label} for client-side execution: ${displayCommand}`,
        };
      }

      return {
        status: "failed",
        message: `Could not execute ${label}: unknown sandbox error`,
      };
    }

    if (operation.type === "create_file") {
      const result = await convex.mutation(
        api.system.agentCreateFileByPath,
        withIngestSecret({
          projectId,
          path: operation.path,
          content: operation.content,
          overwrite: operation.overwrite,
        }),
      );

      await syncAppliedOperationToActiveSandbox({ projectId, operation });

      return {
        status: "applied",
        message:
          result.action === "created"
            ? `Created file ${result.path}.`
            : `Updated file ${result.path}.`,
      };
    }

    if (operation.type === "create_folder") {
      const result = await convex.mutation(
        api.system.agentCreateFolderByPath,
        withIngestSecret({
          projectId,
          path: operation.path,
        }),
      );

      if (result.action === "created") {
        await syncAppliedOperationToActiveSandbox({ projectId, operation });
      }

      return {
        status: result.action === "created" ? "applied" : "skipped",
        message:
          result.action === "created"
            ? `Created folder ${result.path}.`
            : `Folder ${result.path} already exists.`,
      };
    }

    if (operation.type === "update_file") {
      const result = await convex.mutation(
        api.system.agentUpdateFileByPath,
        withIngestSecret({
          projectId,
          path: operation.path,
          content: operation.content,
          createIfMissing: operation.createIfMissing,
        }),
      );

      await syncAppliedOperationToActiveSandbox({ projectId, operation });

      return {
        status: "applied",
        message:
          result.action === "created"
            ? `Created file ${result.path}.`
            : `Updated file ${result.path}.`,
      };
    }

    if (operation.type === "delete_path") {
      const result = await convex.mutation(
        api.system.agentDeletePath,
        withIngestSecret({
          projectId,
          path: operation.path,
        }),
      );

      if (result.status === "missing") {
        return {
          status: "skipped",
          message: `Path ${result.path} was not found.`,
        };
      }

      const nestedCount = result.deletedCount - 1;

      await syncAppliedOperationToActiveSandbox({ projectId, operation });

      return {
        status: "applied",
        message:
          nestedCount > 0
            ? `Deleted ${result.deletedType} ${result.path} and ${nestedCount} nested item(s).`
            : `Deleted ${result.deletedType} ${result.path}.`,
      };
    }

    const result = await convex.mutation(
      api.system.agentRenamePath,
      withIngestSecret({
        projectId,
        path: operation.path,
        newPath: operation.newPath,
        createMissingParents: operation.createMissingParents,
      }),
    );

    if (result.status === "unchanged") {
      return {
        status: "skipped",
        message: `Path ${result.path} is already named ${result.newPath}.`,
      };
    }

    await syncAppliedOperationToActiveSandbox({ projectId, operation });

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
  const baseArgs = withIngestSecret({
    messageId: args.assistantMessageId as Id<"messages">,
    content: args.content,
    status: args.status,
  });

  if (args.reasoningDetails === undefined) {
    return await convex.mutation(
      api.system.completeMessageIfProcessing,
      baseArgs,
    );
  }

  try {
    return await convex.mutation(
      api.system.completeMessageIfProcessing,
      withIngestSecret({
        messageId: args.assistantMessageId as Id<"messages">,
        content: args.content,
        status: args.status,
        reasoningDetails: args.reasoningDetails,
      }),
    );
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
  const assistantMessage = await convex.query(
    api.system.getMessageById,
    withIngestSecret({
      messageId: assistantMessageId as Id<"messages">,
    }),
  );

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

const shouldPreferExecutableOrchestration = (message: string) => {
  const trimmed = message.trim();
  if (!trimmed) {
    return false;
  }

  const hasExecutableIntent =
    EXECUTABLE_ORCHESTRATION_INTENT_PATTERN.test(trimmed) ||
    EXPLICIT_EXECUTION_DIRECTIVE_PATTERN.test(trimmed);

  if (!hasExecutableIntent) {
    return false;
  }

  const looksAnalysisOnly =
    ANALYSIS_ONLY_REQUEST_PATTERN.test(trimmed) &&
    !EXPLICIT_EXECUTION_DIRECTIVE_PATTERN.test(trimmed);

  return !looksAnalysisOnly;
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
  if (typeof reasoningDetails !== "object" || reasoningDetails === null) {
    return null;
  }

  const record = reasoningDetails as Record<string, unknown>;
  const trace = parseAiExecutionTrace(record.executionTrace);
  if (!trace || trace.operationResults.length === 0) {
    return null;
  }

  const lines: string[] = ["[Previous AI Actions]"];

  const fileOps = trace.operationResults.filter(
    (r) =>
      r.operation.type !== "run_command" &&
      r.operation.type !== "start_background_command",
  );
  const appliedFiles = fileOps.filter((r) => r.status === "applied");
  const failedFiles = fileOps.filter((r) => r.status === "failed");

  if (appliedFiles.length > 0) {
    lines.push(`Files created/modified (${appliedFiles.length} total):`);
    for (const f of appliedFiles.slice(0, 40)) {
      lines.push(
        `  - [${f.operation.type}] ${describeTraceOperation(f.operation)}`,
      );
    }
    if (appliedFiles.length > 40) {
      lines.push(`  ... and ${appliedFiles.length - 40} more files`);
    }
  }

  if (failedFiles.length > 0) {
    for (const f of failedFiles.slice(0, 10)) {
      lines.push(
        `- FAILED: ${f.operation.type} ${describeTraceOperation(f.operation)} — ${f.message.slice(0, 300)}`,
      );
    }
  }

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
      lines.push(`- Ran: ${cmdDesc} → FAILED: ${cmd.message.slice(0, 1200)}`);
    } else if (cmd.status === "skipped") {
      lines.push(`- Skipped: ${cmdDesc} — ${cmd.message.slice(0, 200)}`);
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
        return await convex.query(
          api.system.getConversationById,
          withIngestSecret({
            conversationId: conversationId as Id<"conversations">,
          }),
        );
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
          return await convex.query(
            api.system.getMessagesByConversation,
            withIngestSecret({
              conversationId: conversationId as Id<"conversations">,
            }),
          );
        },
      );

      const projectFiles = await step.run("load-project-files", async () => {
        return await convex.query(
          api.system.getProjectFiles,
          withIngestSecret({
            projectId: conversation.projectId,
          }),
        );
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
      const preferExecutableOrchestration =
        shouldPreferExecutableOrchestration(message);
      const sandboxWarmupPromise = preferExecutableOrchestration
        ? ensureSandboxForProject({
            projectId: conversation.projectId,
            projectFiles: conversationProjectFiles,
          })
            .then((sessionId) => {
              activeSandboxSessions.set(conversation.projectId, sessionId);
              console.info("conversation.sandbox.warmup.ready", {
                conversationId,
                projectId: conversation.projectId,
                sessionId,
              });
            })
            .catch((error) => {
              console.warn("conversation.sandbox.warmup.failed", {
                conversationId,
                projectId: conversation.projectId,
                error: error instanceof Error ? error.message : String(error),
              });
            })
        : null;

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
        : null;

      const runConversationOrchestration = async (args?: {
        message?: string;
        projectContext?: string;
        history?: string;
        webContext?: string;
      }) => {
        const streamAssistantProgress = async (content: string) => {
          try {
            await convex.mutation(
              api.system.streamMessageProgress,
              withIngestSecret({
                messageId: assistantMessageId as Id<"messages">,
                content,
              }),
            );
          } catch {

          }
        };

        return runConversationAgentOrchestration({
          message: args?.message ?? plannerMessage,
          projectContext: args?.projectContext ?? systemContext,
          history: args?.history ?? conversationHistory,
          webContext: args?.webContext ?? webContext.markdown,
          projectFiles: conversationProjectFiles,
          executeFileOperation: async (operation) => {
            if (await isAssistantMessageCancelled(assistantMessageId)) {
              return {
                status: "skipped",
                message: "Skipped because the response was cancelled.",
              } satisfies ConversationFileOperationExecutionResult;
            }

            if (
              sandboxWarmupPromise &&
              (operation.type === "run_command" ||
                operation.type === "start_background_command")
            ) {
              await sandboxWarmupPromise;
            }

            return await executeConversationFileOperation({
              projectId: conversation.projectId,
              operation,
              projectFiles: conversationProjectFiles,
            });
          },
          onPlanningProgress: async (status: string) => {
            await streamAssistantProgress(status);
          },
          onPipelineStatus: async (status: string) => {
            await streamAssistantProgress(status);
          },
          onOperationProgress: async (completedResults, totalOps) => {

            const lines: string[] = [
              `> ⚡ **Building project** (${completedResults.length}/${totalOps} operations)`,
              "",
            ];

            for (const result of completedResults) {
              const op = result.operation;
              const icon =
                result.status === "applied"
                  ? "✅"
                  : result.status === "failed"
                    ? "❌"
                    : "⏭️";

              let label: string;
              if (
                op.type === "run_command" ||
                op.type === "start_background_command"
              ) {
                const cmdArgs = op.commandArgs?.join(" ") ?? "";
                label = `\`${op.command}${cmdArgs ? ` ${cmdArgs}` : ""}\``;
              } else if (op.type === "rename_path") {
                label = `${op.type} \`${op.path}\` → \`${op.newPath}\``;
              } else {
                label = `${op.type} \`${op.path}\``;
              }

              lines.push(`- ${icon} ${label}`);
            }

            if (completedResults.length < totalOps) {
              lines.push(
                "",
                `⏳ *${totalOps - completedResults.length} remaining...*`,
              );
            }

            const progressContent = lines.join("\n");

            await streamAssistantProgress(progressContent);
          },
          loadProjectFilesAfterOperations: async () => {
            if (await isAssistantMessageCancelled(assistantMessageId)) {
              return conversationProjectFiles;
            }

            const latestFiles = await convex.query(
              api.system.getProjectFiles,
              withIngestSecret({
                projectId: conversation.projectId,
              }),
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
      };

      const orchestration = await (async () => {
        try {
          return await runConversationOrchestration();
        } catch (orchestrationError) {
          const classified = classifyError(orchestrationError);
          console.warn("conversation.orchestration.fallback", {
            assistantMessageId,
            conversationId,
            reason: classified.message,
            category: classified.category,
          });

          if (preferExecutableOrchestration) {
            try {
              console.info("conversation.orchestration.retry-executable", {
                assistantMessageId,
                conversationId,
                reason: classified.message,
              });

              return await runConversationOrchestration({
                message: [
                  plannerMessage,
                  "",
                  "Pipeline recovery directive: retry with the same full project context and conversation history. Preserve executable file operations and terminal validation.",
                ].join("\n"),
              });
            } catch (retryError) {
              const retryClassified = classifyError(retryError);
              console.warn(
                "conversation.orchestration.retry-executable.failed",
                {
                  assistantMessageId,
                  conversationId,
                  reason: retryClassified.message,
                  category: retryClassified.category,
                },
              );

              return {
                content: [
                  "I couldn't execute file operations for this request because the execution pipeline failed.",
                  `Reason: ${retryClassified.message}`,
                  "No files were changed. Please retry this prompt.",
                ].join("\n"),
                assignments: [],
                reports: [],
                supervisorPlan: "fallback-executable-required",
                operations: [],
                operationResults: [],
                fileOperationPlannerOutput: `fallback due to: ${classified.message}; executable-retry failed: ${retryClassified.message}`,
              };
            }
          }

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
      })();

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

      if (saved && titlePromise) {
        const generatedTitle = await titlePromise;
        if (generatedTitle) {
          await step.run("save-conversation-title", async () => {
            await convex.mutation(
              api.system.updateConversationTitle,
              withIngestSecret({
                conversationId: conversationId as Id<"conversations">,
                title: generatedTitle,
              }),
            );
          });
        }
      }

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
    } finally {

      try {
        await convex.mutation(
          api.system.completeMessageIfProcessing,
          withIngestSecret({
            messageId: assistantMessageId as Id<"messages">,
            content:
              "The AI pipeline encountered an unexpected issue. Please try again.",
            status: "failed",
          }),
        );
      } catch {

      }
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
      const classified = classifyError(error);
      suggestionRuntime.fail({
        requestId,
        error: Object.assign(
          new Error(classified.message),
          {
            statusCode:
              classified.category === "rate_limit" ||
              classified.category === "quota_exceeded"
                ? 429
                : classified.category === "auth"
                  ? 401
                  : classified.category === "validation"
                    ? 400
                    : classified.category === "timeout"
                      ? 504
                      : classified.category === "ai_unavailable"
                        ? 503
                        : 500,
            retryAfterSeconds: classified.retryAfterSeconds,
          },
        ),
      });
      return {
        status: "failed" as const,
        requestId,
        error: classified.message,
        retryable: classified.retryable,
        retryAfterSeconds: classified.retryAfterSeconds ?? null,
      };
    }
  },
);
