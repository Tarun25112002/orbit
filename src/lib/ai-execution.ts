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

  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return null;
  }

  return segments.join("/");
};

const parseOperation = (value: unknown): AiPipelineOperation | null => {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }

  const type = value.type.trim().toLowerCase();
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

const parseOperationResult = (value: unknown): AiPipelineOperationResult | null => {
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

export const parseAiExecutionTrace = (value: unknown): AiExecutionTrace | null => {
  if (!isRecord(value)) {
    return null;
  }

  const operations = Array.isArray(value.operations)
    ? value.operations
        .map((operation) => parseOperation(operation))
        .filter((operation): operation is AiPipelineOperation => operation !== null)
    : [];

  const operationResults = Array.isArray(value.operationResults)
    ? value.operationResults
        .map((result) => parseOperationResult(result))
        .filter((result): result is AiPipelineOperationResult => result !== null)
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
