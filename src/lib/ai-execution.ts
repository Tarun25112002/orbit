export type AiPipelineOperation =
  | {
      type: "create_file";
      path: string;
    }
  | {
      type: "create_folder";
      path: string;
    }
  | {
      type: "update_file";
      path: string;
    }
  | {
      type: "delete_path";
      path: string;
    }
  | {
      type: "rename_path";
      path: string;
      newPath: string;
    }
  | {
      type: "run_command";
      command: string;
      commandArgs?: string[];
    }
  | {
      type: "start_background_command";
      key: string;
      command: string;
      commandArgs?: string[];
    };

export type AiPipelineOperationStatus = "applied" | "skipped" | "failed";

export type AiPipelineOperationResult = {
  operation: AiPipelineOperation;
  status: AiPipelineOperationStatus;
  message: string;
};

export type AiExecutionTrace = {
  version: 1;
  generatedAt: number;
  operations: AiPipelineOperation[];
  operationResults: AiPipelineOperationResult[];
};

export const ORBIT_AI_EXECUTION_TRACE_EVENT = "orbit:ai-execution-trace";

export type OrbitAiExecutionTraceEventDetail = {
  assistantMessageId: string;
  trace: AiExecutionTrace;
};

const MAX_TRACE_OPERATIONS = 200;
const MAX_TRACE_RESULTS = 200;
const MAX_PATH_LENGTH = 512;
const MAX_COMMAND_LENGTH = 128;
const MAX_COMMAND_ARGS = 40;
const MAX_COMMAND_ARG_LENGTH = 256;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const normalizePath = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\/+/g, "/");

  if (!normalized) {
    return null;
  }

  if (normalized.length > MAX_PATH_LENGTH) {
    return null;
  }

  const segments = normalized.split("/");
  if (
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return null;
  }

  return segments.join("/");
};

const tokenizeCommandLine = (value: string) => {
  const matches = value.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return matches.map((token) => token.replace(/^("|')|("|')$/g, ""));
};

const sanitizeCommandToken = (value: string, maxLength: number) => {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    return null;
  }

  if (/[\r\n\u0000]/.test(trimmed)) {
    return null;
  }

  return trimmed;
};

const parseCommandArgs = (value: unknown) => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const args = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => sanitizeCommandToken(item, MAX_COMMAND_ARG_LENGTH))
    .filter((item): item is string => item !== null)
    .slice(0, MAX_COMMAND_ARGS);

  return args.length > 0 ? args : undefined;
};

const normalizeCommandWithArgs = (
  rawCommand: unknown,
  rawCommandArgs: unknown,
) => {
  if (typeof rawCommand !== "string") {
    return null;
  }

  const commandParts = tokenizeCommandLine(rawCommand.trim());
  if (commandParts.length === 0) {
    return null;
  }

  const [commandPart, ...commandArgsFromCommand] = commandParts;
  const command = sanitizeCommandToken(commandPart, MAX_COMMAND_LENGTH);
  if (!command) {
    return null;
  }

  const parsedCommandArgs = parseCommandArgs(rawCommandArgs) ?? [];
  const mergedArgs = [...commandArgsFromCommand, ...parsedCommandArgs]
    .map((item) => sanitizeCommandToken(item, MAX_COMMAND_ARG_LENGTH))
    .filter((item): item is string => item !== null)
    .slice(0, MAX_COMMAND_ARGS);

  return {
    command,
    commandArgs: mergedArgs.length > 0 ? mergedArgs : undefined,
  };
};

const normalizeCommandKey = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");
  if (!normalized) {
    return null;
  }

  if (!/^[a-z0-9._-]{1,64}$/.test(normalized)) {
    return null;
  }

  return normalized;
};

const parseOperation = (value: unknown): AiPipelineOperation | null => {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }

  const type = value.type.trim().toLowerCase();

  if (type === "run_command") {
    const normalizedCommand = normalizeCommandWithArgs(
      value.command,
      value.commandArgs,
    );

    if (!normalizedCommand) {
      return null;
    }

    return {
      type: "run_command",
      command: normalizedCommand.command,
      commandArgs: normalizedCommand.commandArgs,
    };
  }

  if (type === "start_background_command") {
    const normalizedCommand = normalizeCommandWithArgs(
      value.command,
      value.commandArgs,
    );
    const key = normalizeCommandKey(value.key);

    if (!normalizedCommand || !key) {
      return null;
    }

    return {
      type: "start_background_command",
      key,
      command: normalizedCommand.command,
      commandArgs: normalizedCommand.commandArgs,
    };
  }

  const path = normalizePath(value.path);
  if (!path) {
    return null;
  }

  if (type === "create_file") {
    return {
      type: "create_file",
      path,
    };
  }

  if (type === "create_folder") {
    return {
      type: "create_folder",
      path,
    };
  }

  if (type === "update_file") {
    return {
      type: "update_file",
      path,
    };
  }

  if (type === "delete_path") {
    return {
      type: "delete_path",
      path,
    };
  }

  if (type === "rename_path") {
    const newPath = normalizePath(value.newPath);
    if (!newPath) {
      return null;
    }

    return {
      type: "rename_path",
      path,
      newPath,
    };
  }

  return null;
};

const parseStatus = (value: unknown): AiPipelineOperationStatus | null => {
  if (value === "applied" || value === "skipped" || value === "failed") {
    return value;
  }

  return null;
};

const parseOperationResult = (
  value: unknown,
): AiPipelineOperationResult | null => {
  if (!isRecord(value)) {
    return null;
  }

  const operation = parseOperation(value.operation);
  const status = parseStatus(value.status);

  if (!operation || !status) {
    return null;
  }

  return {
    operation,
    status,
    message: typeof value.message === "string" ? value.message : "",
  };
};

export const parseAiExecutionTrace = (
  value: unknown,
): AiExecutionTrace | null => {
  if (!isRecord(value)) {
    return null;
  }

  const operations = Array.isArray(value.operations)
    ? value.operations
        .slice(0, MAX_TRACE_OPERATIONS)
        .map((operation) => parseOperation(operation))
        .filter(
          (operation): operation is AiPipelineOperation => operation !== null,
        )
    : [];

  const operationResults = Array.isArray(value.operationResults)
    ? value.operationResults
        .slice(0, MAX_TRACE_RESULTS)
        .map((result) => parseOperationResult(result))
        .filter(
          (result): result is AiPipelineOperationResult => result !== null,
        )
    : [];

  const generatedAt =
    typeof value.generatedAt === "number" && Number.isFinite(value.generatedAt)
      ? value.generatedAt
      : Date.now();

  if (operations.length === 0 && operationResults.length === 0) {
    return null;
  }

  return {
    version: 1,
    generatedAt,
    operations,
    operationResults,
  };
};
