import { createAgent, gemini, type AgentResult } from "@inngest/agent-kit";
import {
  GEMINI_MODEL_DEFAULT,
  generateGeminiCompletion,
  getGeminiModelCooldownSeconds,
  isGeminiModelCoolingDown,
} from "@/lib/gemini";
import { classifyError } from "@/lib/errors";

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY?.trim() ||
  process.env.GOOGLE_API_KEY?.trim() ||
  undefined;

const SUPERVISOR_MODEL =
  process.env.CONVERSATION_SUPERVISOR_MODEL?.trim() || GEMINI_MODEL_DEFAULT;
const SPECIALIST_MODEL =
  process.env.CONVERSATION_SPECIALIST_MODEL?.trim() ||
  process.env.CONVERSATION_FAST_MODEL?.trim() ||
  GEMINI_MODEL_DEFAULT;
const SYNTHESIS_MODEL =
  process.env.CONVERSATION_SYNTHESIS_MODEL?.trim() || GEMINI_MODEL_DEFAULT;
const FILE_OPS_MODEL =
  process.env.CONVERSATION_FILE_OPS_MODEL?.trim() || SPECIALIST_MODEL;

const FILE_OPERATION_INTENT_PATTERN =
  /\b(create|add|delete|remove|rename|move|update|edit|modify|write|rewrite|refactor|fix|implement|make|generate|scaffold|setup|build)\b/i;
const FILE_OPERATION_PATH_HINT_PATTERN =
  /(?:\b(?:src|app|components|lib|convex|public)\/)|(?:\b[a-z0-9_-]+\.[a-z0-9]{1,8}\b)/i;
const CODE_GENERATION_INTENT_PATTERN =
  /\b(create|build|generate|scaffold|setup|implement|develop|write|add|new|from scratch|boilerplate|starter|component|page|route|endpoint|api|project|app)\b/i;
const CODE_UPDATE_INTENT_PATTERN =
  /\b(fix|update|modify|edit|refactor|improve|optimize|rename|move|delete|remove|patch|change|cleanup)\b/i;
const PLACEHOLDER_CONTENT_PATTERN =
  /\b(?:TODO|TBD)\b|<code here>|your code here/i;
const MAX_FILE_OPERATIONS_PER_RUN = Number.parseInt(
  process.env.CONVERSATION_MAX_FILE_OPERATIONS?.trim() || "40",
  10,
);
const MAX_PROJECT_FILE_INVENTORY = 220;
const MAX_STRUCTURED_TREE_ENTRIES = 220;
const STEPWISE_TASK_INTENT_PATTERN =
  /\b(step|steps|task|tasks|crud|create|read|update|delete|rename|move|folder|file)\b/i;

const createGeminiModel = (
  model: string,
  args?: {
    temperature?: number;
    maxOutputTokens?: number;
  },
) =>
  gemini({
    model,
    apiKey: GEMINI_API_KEY,
    defaultParameters: {
      generationConfig: {
        temperature: args?.temperature,
        maxOutputTokens: args?.maxOutputTokens,
      },
    },
  });

type SpecialistKey =
  | "architecture"
  | "code_quality"
  | "implementation"
  | "web_context";

type ConversationIntent = "analysis" | "code_generation" | "code_update";

type AgentAssignment = {
  agent: SpecialistKey;
  task: string;
};

type ConversationOrchestrationInput = {
  message: string;
  projectContext: string;
  history: string;
  webContext?: string;
  projectFiles?: ConversationProjectFile[];
  executeFileOperation?: ConversationFileOperationExecutor;
  loadProjectFilesAfterOperations?: ConversationProjectFilesLoader;
};

export type ConversationProjectFile = {
  path: string;
  type: "file" | "folder";
  content?: string;
};

export type ConversationFileOperation =
  | {
      type: "create_file";
      path: string;
      content: string;
      overwrite?: boolean;
    }
  | {
      type: "create_folder";
      path: string;
    }
  | {
      type: "update_file";
      path: string;
      content: string;
      createIfMissing?: boolean;
    }
  | {
      type: "delete_path";
      path: string;
    }
  | {
      type: "rename_path";
      path: string;
      newPath: string;
      createMissingParents?: boolean;
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

export type ConversationFileOperationExecutionResult = {
  status: "applied" | "skipped" | "failed";
  message: string;
};

export type ConversationFileOperationExecutor = (
  operation: ConversationFileOperation,
) => Promise<ConversationFileOperationExecutionResult>;

export type ConversationProjectFilesLoader = () => Promise<
  ConversationProjectFile[]
>;

type ConversationFileOperationResult = {
  operation: ConversationFileOperation;
  status: "applied" | "skipped" | "failed";
  message: string;
};

type SpecialistReport = {
  agent: SpecialistKey;
  task: string;
  content: string;
};

const SUPERVISOR_SYSTEM_PROMPT = [
  "You are the main Orbit AI supervisor.",
  "Read the user's request and assign focused work to specialist agents.",
  "Return JSON only, with this shape:",
  '{"assignments":[{"agent":"architecture","task":"short task"}],"reason":"short reason"}',
  "Available agents:",
  "- architecture: explains codebase structure, flow, dependencies, and design.",
  "- code_quality: finds bugs, edge cases, risks, and test gaps.",
  "- implementation: proposes concrete code changes, examples, and next steps.",
  "- web_context: uses scraped URL/web context when the user references external docs, articles, or pages.",
  "Pick only useful agents. Prefer 2-3 agents for normal requests and 1 agent for narrow requests.",
].join("\n");

const ARCHITECTURE_SYSTEM_PROMPT = [
  "You are Orbit's architecture specialist.",
  "Focus on project structure, data flow, API boundaries, and how the code fits together.",
  "Return concise findings that another agent can synthesize into a final user answer.",
].join("\n");

const CODE_QUALITY_SYSTEM_PROMPT = [
  "You are Orbit's code-quality specialist.",
  "Focus on correctness, regressions, edge cases, and verification.",
  "Be specific and avoid generic advice.",
].join("\n");

const IMPLEMENTATION_SYSTEM_PROMPT = [
  "You are Orbit's implementation specialist.",
  "Focus on concrete code changes, APIs, examples, and practical next steps.",
  "Prefer local project patterns over new abstractions.",
].join("\n");

const WEB_CONTEXT_SYSTEM_PROMPT = [
  "You are Orbit's web-context specialist.",
  "Use only the supplied scraped web context for external facts.",
  "Call out when the web context is absent or insufficient.",
].join("\n");

const SYNTHESIS_SYSTEM_PROMPT = [
  "You are Orbit AI, an intelligent coding assistant embedded in the Orbit code editor.",
  "Synthesize the specialist reports into one helpful response for the user.",
  "Do not mention internal orchestration unless it is directly useful.",
  "Be concise, accurate, and practical. Use markdown when helpful.",
  "For implementation or file-change requests, always return this structure:",
  "Project Structure:",
  "- folder/",
  "  - subfolder/",
  "    - file.ext",
  "",
  "Files: (or Updated Files: for change requests)",
  "// full/path/to/file.ext",
  "```language",
  "full file content",
  "```",
  "",
  "Always provide complete runnable code with valid imports/exports and no placeholder text.",
].join("\n");

const TITLE_SYSTEM_PROMPT = [
  "Create a short title for a coding assistant conversation.",
  "Return only the title, no quotes, no punctuation at the end.",
  "Use 3 to 6 words.",
].join("\n");

const FILE_OPS_PLANNER_SYSTEM_PROMPT = [
  "You plan deterministic file operations for an IDE assistant.",
  "Only return JSON. Do not include prose outside JSON.",
  "If the user did not request code/file changes, return an empty operations array.",
  "If the user asked to implement, build, fix, create, or modify code, you MUST return one or more operations.",
  "Plan operations in explicit execution order (step-by-step).",
  "Prefer modifying existing files over creating duplicate files.",
  "When generating code, produce complete runnable files (including imports/exports and required config/dependencies).",
  "Never use placeholders like TODO, TBD, or <code here>.",
  "If the request is a change to existing code, modify only the relevant files.",
  "Use forward-slash relative paths like src/app/page.ts.",
  "CRUD mapping:",
  "- Create -> create_folder/create_file",
  "- Update -> update_file",
  "- Delete -> delete_path",
  "- Rename/Move -> rename_path",
  "Read/analyze tasks should not fabricate write operations.",
  "Allowed operation types:",
  "- create_file: { type, path, content, overwrite? }",
  "- create_folder: { type, path }",
  "- update_file: { type, path, content, createIfMissing? }",
  "- delete_path: { type, path }",
  "- rename_path: { type, path, newPath, createMissingParents? }",
  "- run_command: { type, command, commandArgs? }",
  "- start_background_command: { type, key, command, commandArgs? }",
  "Each operation may include optional metadata fields like step/reason; these are ignored by execution but useful for planning clarity.",
  "JSON shape:",
  '{"operations":[{"type":"update_file","path":"src/example.ts","content":"..."}]}',
  "Commands must be deterministic and non-interactive.",
  "Use command operations for install/build/test/dev-server tasks only; source file edits must be represented as file operations.",
  "Do not emit operations that require assumptions you cannot justify from the request/context.",
  "Keep operation count minimal and practical.",
].join("\n");

const SPECIALIST_SYSTEM_PROMPTS: Record<SpecialistKey, string> = {
  architecture: ARCHITECTURE_SYSTEM_PROMPT,
  code_quality: CODE_QUALITY_SYSTEM_PROMPT,
  implementation: IMPLEMENTATION_SYSTEM_PROMPT,
  web_context: WEB_CONTEXT_SYSTEM_PROMPT,
};

const supervisorAgent = createAgent({
  name: "conversation_supervisor",
  description: "Plans which specialist agents should answer a user request.",
  model: createGeminiModel(SUPERVISOR_MODEL, {
    temperature: 0.1,
    maxOutputTokens: 900,
  }),
  system: SUPERVISOR_SYSTEM_PROMPT,
});

const architectureAgent = createAgent({
  name: "architecture",
  description:
    "Understands codebase structure and explains how pieces connect.",
  model: createGeminiModel(SPECIALIST_MODEL, {
    temperature: 0.2,
    maxOutputTokens: 1800,
  }),
  system: ARCHITECTURE_SYSTEM_PROMPT,
});

const codeQualityAgent = createAgent({
  name: "code_quality",
  description: "Reviews code for bugs, edge cases, and missing tests.",
  model: createGeminiModel(SPECIALIST_MODEL, {
    temperature: 0.15,
    maxOutputTokens: 1800,
  }),
  system: CODE_QUALITY_SYSTEM_PROMPT,
});

const implementationAgent = createAgent({
  name: "implementation",
  description: "Turns requests into concrete implementation guidance.",
  model: createGeminiModel(SPECIALIST_MODEL, {
    temperature: 0.25,
    maxOutputTokens: 2200,
  }),
  system: IMPLEMENTATION_SYSTEM_PROMPT,
});

const webContextAgent = createAgent({
  name: "web_context",
  description: "Extracts relevant facts from scraped URL context.",
  model: createGeminiModel(SPECIALIST_MODEL, {
    temperature: 0.1,
    maxOutputTokens: 1800,
  }),
  system: WEB_CONTEXT_SYSTEM_PROMPT,
});

const synthesisAgent = createAgent({
  name: "conversation_synthesizer",
  description: "Combines specialist findings into the final assistant answer.",
  model: createGeminiModel(SYNTHESIS_MODEL, {
    temperature: 0.35,
    maxOutputTokens: 5000,
  }),
  system: SYNTHESIS_SYSTEM_PROMPT,
});

const titleAgent = createAgent({
  name: "conversation_title",
  description: "Creates short conversation titles.",
  model: createGeminiModel(SPECIALIST_MODEL, {
    temperature: 0.2,
    maxOutputTokens: 40,
  }),
  system: TITLE_SYSTEM_PROMPT,
});

const fileOperationsPlannerAgent = createAgent({
  name: "conversation_file_operations_planner",
  description:
    "Plans concrete file operations for explicit code-edit requests.",
  model: createGeminiModel(FILE_OPS_MODEL, {
    temperature: 0.1,
    maxOutputTokens: 6_000,
  }),
  system: FILE_OPS_PLANNER_SYSTEM_PROMPT,
});

const specialistAgents = {
  architecture: architectureAgent,
  code_quality: codeQualityAgent,
  implementation: implementationAgent,
  web_context: webContextAgent,
} satisfies Record<SpecialistKey, typeof architectureAgent>;

const textFromContent = (content: unknown) => {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "object" &&
        part !== null &&
        "text" in part &&
        typeof part.text === "string"
          ? part.text
          : "",
      )
      .join("");
  }

  return "";
};

const textFromAgentResult = (result: AgentResult) =>
  result.output
    .map((message) =>
      message.type === "text" ? textFromContent(message.content) : "",
    )
    .filter(Boolean)
    .join("\n")
    .trim();

const buildFallbackAgentPrompt = (systemPrompt: string, prompt: string) =>
  [systemPrompt, "", "Task input:", prompt].join("\n");

const runAgentTextWithFallback = async (args: {
  agent: { run: (prompt: string) => Promise<AgentResult> };
  prompt: string;
  systemPrompt: string;
  model: string;
  label: string;
}) => {
  let primaryError: unknown;
  const targetModel = args.model.trim();
  const skipPrimary = isGeminiModelCoolingDown(targetModel);

  if (skipPrimary) {
    const retryIn = getGeminiModelCooldownSeconds(targetModel);
    primaryError = new Error(
      `Primary agent call skipped for ${targetModel} due to cooldown (${retryIn}s remaining).`,
    );
  } else {
    try {
      const primaryResult = await args.agent.run(args.prompt);
      const primaryText = textFromAgentResult(primaryResult).trim();
      if (primaryText) {
        return primaryText;
      }

      primaryError = new Error("Primary agent returned empty content.");
    } catch (error) {
      primaryError = error;
    }
  }

  try {
    const fallback = await generateGeminiCompletion({
      model: targetModel,
      messages: [
        {
          role: "user",
          content: buildFallbackAgentPrompt(args.systemPrompt, args.prompt),
        },
      ],
    });

    const fallbackText = fallback.content.trim();
    if (fallbackText) {
      return fallbackText;
    }

    throw new Error("Fallback model returned empty content.");
  } catch (fallbackError) {
    const primaryMessage =
      primaryError instanceof Error
        ? primaryError.message
        : String(primaryError ?? "unknown");
    const fallbackMessage =
      fallbackError instanceof Error
        ? fallbackError.message
        : String(fallbackError);

    const wrapped = new Error(
      `${args.label} failed. primary=${primaryMessage}; fallback=${fallbackMessage}`,
    );

    if (typeof fallbackError === "object" && fallbackError !== null) {
      const fallbackRecord = fallbackError as Record<string, unknown>;

      if (typeof fallbackRecord.status === "number") {
        (wrapped as Error & { status?: number }).status = fallbackRecord.status;
      }

      if (typeof fallbackRecord.statusCode === "number") {
        (wrapped as Error & { statusCode?: number }).statusCode =
          fallbackRecord.statusCode;
      }

      if (typeof fallbackRecord.retryAfterSeconds === "number") {
        (wrapped as Error & { retryAfterSeconds?: number }).retryAfterSeconds =
          fallbackRecord.retryAfterSeconds;
      }
    }

    throw wrapped;
  }
};

const extractJsonObject = (value: string) => {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced ?? value;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return raw.slice(start, end + 1);
};

const toRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;

const normalizeOperationPath = (rawPath: string) => {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return null;
  }

  const normalizedSlashes = trimmed
    .replace(/\\/g, "/")
    .replace(/^\//, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");

  const withoutCurrentDir = normalizedSlashes.startsWith("./")
    ? normalizedSlashes.slice(2)
    : normalizedSlashes;

  if (!withoutCurrentDir) {
    return null;
  }

  const segments = withoutCurrentDir
    .split("/")
    .map((segment) => segment.trim());

  if (
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return null;
  }

  return segments.join("/");
};

const parseOptionalBoolean = (value: unknown) =>
  typeof value === "boolean" ? value : undefined;

const parseCommandArgs = (value: unknown) => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const args = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 40);

  return args.length > 0 ? args : undefined;
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

const getParentPath = (path: string) => {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
};

const expandPathAncestors = (path: string) => {
  const segments = path.split("/").filter(Boolean);
  const ancestors: string[] = [];

  for (let index = 0; index < segments.length; index += 1) {
    ancestors.push(segments.slice(0, index + 1).join("/"));
  }

  return ancestors;
};

const collectKnownFoldersFromProject = (
  files: ConversationProjectFile[] = [],
) => {
  const folders = new Set<string>();

  for (const file of files) {
    if (file.type === "folder") {
      for (const ancestor of expandPathAncestors(file.path)) {
        folders.add(ancestor);
      }
      continue;
    }

    const parent = getParentPath(file.path);
    if (!parent) {
      continue;
    }

    for (const ancestor of expandPathAncestors(parent)) {
      folders.add(ancestor);
    }
  }

  return folders;
};

const ensureFolderOperationsForWrites = (
  operations: ConversationFileOperation[],
  projectFiles: ConversationProjectFile[] = [],
) => {
  const existingFolders = collectKnownFoldersFromProject(projectFiles);
  const plannedFolders = new Set<string>();
  const normalized: ConversationFileOperation[] = [];

  const markFolderKnown = (folderPath: string) => {
    if (!folderPath) {
      return;
    }

    for (const ancestor of expandPathAncestors(folderPath)) {
      existingFolders.add(ancestor);
      plannedFolders.add(ancestor);
    }
  };

  for (const operation of operations) {
    if (operation.type === "create_folder") {
      const folderPath = operation.path;
      const missingAncestors = expandPathAncestors(folderPath).filter(
        (ancestor) =>
          !existingFolders.has(ancestor) && !plannedFolders.has(ancestor),
      );

      for (const ancestor of missingAncestors) {
        normalized.push({
          type: "create_folder",
          path: ancestor,
        });
        markFolderKnown(ancestor);
      }

      normalized.push(operation);
      markFolderKnown(folderPath);
      continue;
    }

    const writeTargetPath =
      operation.type === "create_file" || operation.type === "update_file"
        ? operation.path
        : operation.type === "rename_path"
          ? operation.newPath
          : "";

    const parentPath = writeTargetPath ? getParentPath(writeTargetPath) : "";
    if (parentPath) {
      const missingAncestors = expandPathAncestors(parentPath).filter(
        (ancestor) =>
          !existingFolders.has(ancestor) && !plannedFolders.has(ancestor),
      );

      for (const ancestor of missingAncestors) {
        normalized.push({
          type: "create_folder",
          path: ancestor,
        });
        markFolderKnown(ancestor);
      }
    }

    normalized.push(operation);
  }

  return normalized;
};

const parseFileOperation = (
  value: unknown,
): ConversationFileOperation | null => {
  const record = toRecord(value);
  if (!record) {
    return null;
  }

  const type =
    typeof record.type === "string" ? record.type.trim().toLowerCase() : "";

  if (type === "run_command") {
    const command =
      typeof record.command === "string" ? record.command.trim() : "";

    if (!command) {
      return null;
    }

    return {
      type: "run_command",
      command,
      commandArgs: parseCommandArgs(record.commandArgs),
    };
  }

  if (type === "start_background_command") {
    const command =
      typeof record.command === "string" ? record.command.trim() : "";
    const key = normalizeCommandKey(record.key);

    if (!command || !key) {
      return null;
    }

    return {
      type: "start_background_command",
      key,
      command,
      commandArgs: parseCommandArgs(record.commandArgs),
    };
  }

  const path =
    typeof record.path === "string"
      ? normalizeOperationPath(record.path)
      : null;

  if (!path) {
    return null;
  }

  if (type === "create_folder") {
    return {
      type: "create_folder",
      path,
    };
  }

  if (type === "delete_path") {
    return {
      type: "delete_path",
      path,
    };
  }

  if (type === "create_file") {
    if (typeof record.content !== "string") {
      return null;
    }

    return {
      type: "create_file",
      path,
      content: record.content,
      overwrite: parseOptionalBoolean(record.overwrite) ?? true,
    };
  }

  if (type === "update_file") {
    if (typeof record.content !== "string") {
      return null;
    }

    return {
      type: "update_file",
      path,
      content: record.content,
      createIfMissing: parseOptionalBoolean(record.createIfMissing) ?? true,
    };
  }

  if (type === "rename_path") {
    const newPath =
      typeof record.newPath === "string"
        ? normalizeOperationPath(record.newPath)
        : null;

    if (!newPath) {
      return null;
    }

    return {
      type: "rename_path",
      path,
      newPath,
      createMissingParents:
        parseOptionalBoolean(record.createMissingParents) ?? true,
    };
  }

  return null;
};

const parseFileOperationPlan = (
  value: unknown,
): ConversationFileOperation[] => {
  const record = toRecord(value);
  if (!record) {
    return [];
  }

  const rawOperations = Array.isArray(record.operations)
    ? record.operations
    : Array.isArray(record.steps)
      ? record.steps.map((step) => {
          const stepRecord = toRecord(step);
          if (!stepRecord) {
            return step;
          }

          if ("operation" in stepRecord && stepRecord.operation !== undefined) {
            return stepRecord.operation;
          }

          return stepRecord;
        })
      : [];

  const operations = rawOperations
    .map((operation) => parseFileOperation(operation))
    .filter(
      (operation): operation is ConversationFileOperation => operation !== null,
    )
    .slice(0, MAX_FILE_OPERATIONS_PER_RUN);

  return operations;
};

const inferConversationIntent = (message: string): ConversationIntent => {
  const hasGenerationIntent = CODE_GENERATION_INTENT_PATTERN.test(message);
  const hasUpdateIntent = CODE_UPDATE_INTENT_PATTERN.test(message);

  if (hasUpdateIntent && !hasGenerationIntent) {
    return "code_update";
  }

  if (hasGenerationIntent) {
    return "code_generation";
  }

  if (FILE_OPERATION_PATH_HINT_PATTERN.test(message)) {
    return "code_update";
  }

  return "analysis";
};

const validateFileOperationPlan = (operations: ConversationFileOperation[]) => {
  const issues: string[] = [];

  for (const operation of operations) {
    if (operation.type === "run_command") {
      if (!operation.command.trim()) {
        issues.push("run_command has an empty command.");
      }
      continue;
    }

    if (operation.type === "start_background_command") {
      if (!operation.command.trim()) {
        issues.push(
          `start_background_command (${operation.key}) has an empty command.`,
        );
      }
      continue;
    }

    if (operation.type !== "create_file" && operation.type !== "update_file") {
      continue;
    }

    if (!operation.content.trim()) {
      issues.push(
        `${operation.type} ${operation.path} has empty content; full file content is required.`,
      );
    }

    if (PLACEHOLDER_CONTENT_PATTERN.test(operation.content)) {
      issues.push(
        `${operation.type} ${operation.path} contains placeholder text (TODO/TBD/code here).`,
      );
    }
  }

  return Array.from(new Set(issues));
};

const buildProjectFileInventory = (files: ConversationProjectFile[] = []) => {
  if (files.length === 0) {
    return "(empty project)";
  }

  return files
    .slice(0, MAX_PROJECT_FILE_INVENTORY)
    .map((file) =>
      file.type === "folder" ? `[folder] ${file.path}` : `[file] ${file.path}`,
    )
    .join("\n");
};

const buildFileOperationPlannerPrompt = (
  input: ConversationOrchestrationInput,
) =>
  [
    "User request:",
    input.message,
    "",
    input.history ? `Conversation history:\n${input.history}` : "",
    "",
    "Known project files:",
    buildProjectFileInventory(input.projectFiles),
    "",
    "Project context:",
    input.projectContext,
    input.webContext
      ? ["", "Scraped web context:", input.webContext].join("\n")
      : "",
    "",
    "Requirements:",
    "- For create_file and update_file operations, include complete runnable file content.",
    "- Do not use TODO, TBD, or placeholder text.",
    "- For shell actions, prefer run_command/start_background_command operations with explicit commandArgs.",
    "- Commands must be non-interactive and should complete or start reliably in CI-like environments.",
    "- Do not depend on shell commands to create or edit source files; represent source edits with create_file/update_file operations.",
    "- If creating a new project/app, include all required folders/files for a runnable setup.",
    "- If user requested changes, touch only relevant files.",
    "",
    "Return JSON only with this shape:",
    '{"operations":[{"type":"update_file","path":"src/example.ts","content":"..."}]}',
  ]
    .filter(Boolean)
    .join("\n");

const buildFileOperationPlannerRetryPrompt = (
  input: ConversationOrchestrationInput,
  previousOutput: string,
  issues: string[] = [],
) =>
  [
    buildFileOperationPlannerPrompt(input),
    "",
    "Your previous response was empty or not valid JSON:",
    previousOutput || "(empty)",
    "",
    issues.length > 0
      ? [
          "Plan issues to fix:",
          ...issues.map((issue) => `- ${issue}`),
          "",
        ].join("\n")
      : "",
    "Return valid JSON only now.",
    "If the request involves implementation or editing, include at least one operation.",
    "Do not include markdown fences.",
  ]
    .filter(Boolean)
    .join("\n");

const shouldPlanFileOperations = (input: ConversationOrchestrationInput) => {
  const intent = inferConversationIntent(input.message);
  if (intent !== "analysis") {
    return true;
  }

  if (STEPWISE_TASK_INTENT_PATTERN.test(input.message)) {
    return true;
  }

  if (FILE_OPERATION_INTENT_PATTERN.test(input.message)) {
    return true;
  }

  if (FILE_OPERATION_PATH_HINT_PATTERN.test(input.message)) {
    return true;
  }

  return false;
};

const describeFileOperation = (operation: ConversationFileOperation) => {
  if (operation.type === "rename_path") {
    return `${operation.type} ${operation.path} -> ${operation.newPath}`;
  }

  if (operation.type === "run_command") {
    const args = operation.commandArgs?.join(" ") ?? "";
    return `run_command ${operation.command}${args ? ` ${args}` : ""}`;
  }

  if (operation.type === "start_background_command") {
    const args = operation.commandArgs?.join(" ") ?? "";
    return `start_background_command[${operation.key}] ${operation.command}${args ? ` ${args}` : ""}`;
  }

  return `${operation.type} ${operation.path}`;
};

const planConversationFileOperations = async (
  input: ConversationOrchestrationInput,
) => {
  if (!input.executeFileOperation) {
    return {
      operations: [] as ConversationFileOperation[],
      plannerOutput: "",
    };
  }

  if (!shouldPlanFileOperations(input)) {
    return {
      operations: [] as ConversationFileOperation[],
      plannerOutput: "intent-skip",
    };
  }

  const extractOperations = (output: string): ConversationFileOperation[] => {
    const plannerJson = extractJsonObject(output);
    if (!plannerJson) {
      return [];
    }

    try {
      const parsed = JSON.parse(plannerJson) as unknown;
      return parseFileOperationPlan(parsed);
    } catch {
      return [];
    }
  };

  try {
    const plannerOutput = await runAgentTextWithFallback({
      agent: fileOperationsPlannerAgent,
      prompt: buildFileOperationPlannerPrompt(input),
      systemPrompt: FILE_OPS_PLANNER_SYSTEM_PROMPT,
      model: FILE_OPS_MODEL,
      label: "file-ops-planner",
    });
    const operations = ensureFolderOperationsForWrites(
      extractOperations(plannerOutput),
      input.projectFiles,
    ).slice(0, MAX_FILE_OPERATIONS_PER_RUN);
    const issues = validateFileOperationPlan(operations);

    if (operations.length > 0 && issues.length === 0) {
      return {
        operations,
        plannerOutput,
      };
    }

    const retryIssues =
      operations.length === 0 ? ["No valid operations were returned."] : issues;

    const retryOutput = await runAgentTextWithFallback({
      agent: fileOperationsPlannerAgent,
      prompt: buildFileOperationPlannerRetryPrompt(
        input,
        plannerOutput,
        retryIssues,
      ),
      systemPrompt: FILE_OPS_PLANNER_SYSTEM_PROMPT,
      model: FILE_OPS_MODEL,
      label: "file-ops-planner-retry",
    });
    const retryOperations = ensureFolderOperationsForWrites(
      extractOperations(retryOutput),
      input.projectFiles,
    ).slice(0, MAX_FILE_OPERATIONS_PER_RUN);
    const retryValidationIssues = validateFileOperationPlan(retryOperations);

    return {
      operations: retryValidationIssues.length === 0 ? retryOperations : [],
      plannerOutput:
        retryValidationIssues.length === 0
          ? retryOutput || plannerOutput
          : [
              retryOutput || plannerOutput,
              "",
              "Plan validation failed:",
              ...retryValidationIssues.map((issue) => `- ${issue}`),
            ].join("\n"),
    };
  } catch (error) {
    return {
      operations: [] as ConversationFileOperation[],
      plannerOutput: error instanceof Error ? error.message : "planner-error",
    };
  }
};

const executePlannedFileOperations = async (
  operations: ConversationFileOperation[],
  executeFileOperation?: ConversationFileOperationExecutor,
): Promise<ConversationFileOperationResult[]> => {
  if (operations.length === 0) {
    return [];
  }

  const results: ConversationFileOperationResult[] = [];

  for (const operation of operations) {
    if (
      operation.type === "run_command" ||
      operation.type === "start_background_command"
    ) {
      results.push({
        operation,
        status: "applied",
        message: "Queued for WebContainer runtime execution.",
      });
      continue;
    }

    if (!executeFileOperation) {
      results.push({
        operation,
        status: "skipped",
        message: "No execution handler is available.",
      });
      continue;
    }

    try {
      const execution = await executeFileOperation(operation);
      results.push({
        operation,
        status: execution.status,
        message: execution.message.trim() || "No details returned.",
      });
    } catch (error) {
      results.push({
        operation,
        status: "failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return results;
};

const buildFileOperationSummary = (
  operationResults: ConversationFileOperationResult[],
) => {
  if (operationResults.length === 0) {
    return "No pipeline operations were executed.";
  }

  return operationResults
    .map(
      (result) =>
        `- ${result.status.toUpperCase()}: ${describeFileOperation(result.operation)} (${result.message})`,
    )
    .join("\n");
};

type StructuredTreeEntry = {
  path: string;
  type: "file" | "folder";
};

type StructuredChangedFile = {
  path: string;
  content: string;
};

type StructuredFolderEntry = {
  path: string;
};

type StructuredTreeNode = {
  folders: Map<string, StructuredTreeNode>;
  files: Set<string>;
};

const getCodeBlockLanguage = (path: string) => {
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";

  switch (extension) {
    case "ts":
      return "ts";
    case "tsx":
      return "tsx";
    case "js":
      return "js";
    case "jsx":
      return "jsx";
    case "json":
      return "json";
    case "css":
      return "css";
    case "scss":
      return "scss";
    case "html":
      return "html";
    case "md":
      return "md";
    case "yml":
    case "yaml":
      return "yaml";
    case "sh":
      return "bash";
    default:
      return "text";
  }
};

const formatFileCodeBlock = (path: string, content: string) => {
  const language = getCodeBlockLanguage(path);
  const normalizedContent = content.replace(/\r\n/g, "\n").trimEnd();
  const fence = normalizedContent.includes("```") ? "~~~~" : "```";

  return [`// ${path}`, `${fence}${language}`, normalizedContent, fence].join(
    "\n",
  );
};

const isPathRelated = (leftPath: string, rightPath: string) =>
  leftPath === rightPath ||
  leftPath.startsWith(`${rightPath}/`) ||
  rightPath.startsWith(`${leftPath}/`);

const collectStructuredChangedFiles = (
  operationResults: ConversationFileOperationResult[],
) => {
  const changedByPath = new Map<string, StructuredChangedFile>();

  for (const result of operationResults) {
    if (result.status !== "applied") {
      continue;
    }

    if (
      result.operation.type === "create_file" ||
      result.operation.type === "update_file"
    ) {
      changedByPath.set(result.operation.path, {
        path: result.operation.path,
        content: result.operation.content,
      });
      continue;
    }

    if (result.operation.type === "rename_path") {
      const existing = changedByPath.get(result.operation.path);
      if (existing) {
        changedByPath.delete(result.operation.path);
        changedByPath.set(result.operation.newPath, {
          ...existing,
          path: result.operation.newPath,
        });
      }
    }
  }

  return Array.from(changedByPath.values()).sort((left, right) =>
    left.path.localeCompare(right.path),
  );
};

const collectStructuredFolderEntries = (
  operationResults: ConversationFileOperationResult[],
) => {
  const folderEntries = new Map<string, StructuredFolderEntry>();

  for (const result of operationResults) {
    if (result.status !== "applied") {
      continue;
    }

    if (result.operation.type === "create_folder") {
      folderEntries.set(result.operation.path, {
        path: result.operation.path,
      });
    }
  }

  return Array.from(folderEntries.values()).sort((left, right) =>
    left.path.localeCompare(right.path),
  );
};

const buildStructuredTreeEntries = (args: {
  changedFiles: StructuredChangedFile[];
  folderEntries: StructuredFolderEntry[];
  projectFiles: ConversationProjectFile[];
}): StructuredTreeEntry[] => {
  const anchorPaths = new Set([
    ...args.changedFiles.map((file) => file.path),
    ...args.folderEntries.map((entry) => entry.path),
  ]);
  const changedEntries: StructuredTreeEntry[] = args.changedFiles.map(
    (file) => ({
      path: file.path,
      type: "file",
    }),
  );
  const folderTreeEntries: StructuredTreeEntry[] = args.folderEntries.map(
    (entry) => ({
      path: entry.path,
      type: "folder",
    }),
  );

  const anchorEntries = [...changedEntries, ...folderTreeEntries];

  if (args.projectFiles.length === 0) {
    return anchorEntries;
  }

  const projectEntries: StructuredTreeEntry[] = args.projectFiles.map(
    (file) => ({
      path: file.path,
      type: file.type,
    }),
  );

  const relatedEntries = projectEntries.filter((entry) =>
    Array.from(anchorPaths).some((anchorPath) =>
      isPathRelated(entry.path, anchorPath),
    ),
  );

  if (relatedEntries.length > 0) {
    return relatedEntries.slice(0, MAX_STRUCTURED_TREE_ENTRIES);
  }

  return anchorEntries.slice(0, MAX_STRUCTURED_TREE_ENTRIES);
};

const buildProjectStructureLines = (entries: StructuredTreeEntry[]) => {
  const normalizedEntries = entries
    .map((entry) => {
      const normalizedPath = normalizeOperationPath(entry.path);
      return normalizedPath ? { path: normalizedPath, type: entry.type } : null;
    })
    .filter((entry): entry is StructuredTreeEntry => entry !== null);

  if (normalizedEntries.length === 0) {
    return ["- (empty)"];
  }

  const root: StructuredTreeNode = {
    folders: new Map(),
    files: new Set(),
  };

  for (const entry of normalizedEntries) {
    const segments = entry.path.split("/");
    let node = root;

    if (entry.type === "folder") {
      for (const segment of segments) {
        let nextNode = node.folders.get(segment);
        if (!nextNode) {
          nextNode = {
            folders: new Map(),
            files: new Set(),
          };
          node.folders.set(segment, nextNode);
        }
        node = nextNode;
      }
      continue;
    }

    for (const segment of segments.slice(0, -1)) {
      let nextNode = node.folders.get(segment);
      if (!nextNode) {
        nextNode = {
          folders: new Map(),
          files: new Set(),
        };
        node.folders.set(segment, nextNode);
      }
      node = nextNode;
    }

    const fileName = segments.at(-1);
    if (fileName) {
      node.files.add(fileName);
    }
  }

  const render = (node: StructuredTreeNode, depth: number): string[] => {
    const lines: string[] = [];
    const indent = "  ".repeat(depth);

    const folderNames = Array.from(node.folders.keys()).sort((left, right) =>
      left.localeCompare(right),
    );
    const fileNames = Array.from(node.files).sort((left, right) =>
      left.localeCompare(right),
    );

    for (const folderName of folderNames) {
      lines.push(`${indent}- ${folderName}/`);
      const child = node.folders.get(folderName);
      if (child) {
        lines.push(...render(child, depth + 1));
      }
    }

    for (const fileName of fileNames) {
      lines.push(`${indent}- ${fileName}`);
    }

    return lines;
  };

  const rendered = render(root, 0);
  return rendered.length > 0 ? rendered : ["- (empty)"];
};

const shouldUseStructuredCodeResponse = (args: {
  intent: ConversationIntent;
  changedFiles: StructuredChangedFile[];
  folderEntries: StructuredFolderEntry[];
}) =>
  (args.intent === "code_generation" || args.intent === "code_update") &&
  (args.changedFiles.length > 0 || args.folderEntries.length > 0);

const buildStructuredCodeResponse = (args: {
  intent: ConversationIntent;
  changedFiles: StructuredChangedFile[];
  folderEntries: StructuredFolderEntry[];
  projectFiles: ConversationProjectFile[];
  operationResults: ConversationFileOperationResult[];
}) => {
  const structureLines = buildProjectStructureLines(
    buildStructuredTreeEntries({
      changedFiles: args.changedFiles,
      folderEntries: args.folderEntries,
      projectFiles: args.projectFiles,
    }),
  );

  const fileBlocks = args.changedFiles.map((file) =>
    formatFileCodeBlock(file.path, file.content),
  );

  const nonFileOperations = args.operationResults
    .filter(
      (result) =>
        result.status === "applied" &&
        result.operation.type !== "create_file" &&
        result.operation.type !== "update_file",
    )
    .map(
      (result) =>
        `- ${describeFileOperation(result.operation)} (${result.message})`,
    );

  return [
    "Project Structure:",
    ...structureLines,
    "",
    args.intent === "code_update" ? "Updated Files:" : "Files:",
    "",
    ...fileBlocks,
    ...(nonFileOperations.length > 0
      ? ["", "Applied Non-File Operations:", ...nonFileOperations]
      : []),
  ].join("\n");
};

const normalizeAssignments = (
  value: unknown,
  input: ConversationOrchestrationInput,
): AgentAssignment[] => {
  const rawAssignments =
    typeof value === "object" &&
    value !== null &&
    "assignments" in value &&
    Array.isArray(value.assignments)
      ? value.assignments
      : [];

  const assignments = rawAssignments
    .map((assignment): AgentAssignment | null => {
      if (
        typeof assignment !== "object" ||
        assignment === null ||
        !("agent" in assignment)
      ) {
        return null;
      }

      const agent = assignment.agent;
      if (
        agent !== "architecture" &&
        agent !== "code_quality" &&
        agent !== "implementation" &&
        agent !== "web_context"
      ) {
        return null;
      }

      return {
        agent,
        task:
          "task" in assignment && typeof assignment.task === "string"
            ? assignment.task
            : `Help answer: ${input.message}`,
      };
    })
    .filter((assignment): assignment is AgentAssignment => Boolean(assignment));

  const deduped = new Map<SpecialistKey, AgentAssignment>();
  for (const assignment of assignments) {
    deduped.set(assignment.agent, assignment);
  }

  if (input.webContext?.trim() && !deduped.has("web_context")) {
    deduped.set("web_context", {
      agent: "web_context",
      task: "Extract the external facts that matter for the user's request.",
    });
  }

  if (deduped.size > 0) {
    return Array.from(deduped.values()).slice(0, 4);
  }

  const lowerMessage = input.message.toLowerCase();
  const fallback: AgentAssignment[] = [];

  if (/bug|error|fail|risk|test|debug|issue/.test(lowerMessage)) {
    fallback.push({
      agent: "code_quality",
      task: "Find likely bugs, edge cases, and verification steps.",
    });
  }

  if (/add|build|implement|create|change|fix|code/.test(lowerMessage)) {
    fallback.push({
      agent: "implementation",
      task: "Propose practical implementation details for the request.",
    });
  }

  if (/architecture|explain|flow|structure|how|connect/.test(lowerMessage)) {
    fallback.push({
      agent: "architecture",
      task: "Explain the relevant code structure and flow.",
    });
  }

  if (input.webContext?.trim()) {
    fallback.push({
      agent: "web_context",
      task: "Summarize the relevant scraped web context.",
    });
  }

  return fallback.length > 0
    ? fallback
    : [
        {
          agent: "implementation",
          task: "Answer the user with concrete, useful coding guidance.",
        },
        {
          agent: "code_quality",
          task: "Check the answer for risks and missing details.",
        },
      ];
};

const buildSpecialistPrompt = (
  input: ConversationOrchestrationInput,
  assignment: AgentAssignment,
) =>
  [
    "User request:",
    input.message,
    "",
    "Your assigned task:",
    assignment.task,
    "",
    input.history ? `Conversation history:\n${input.history}` : "",
    "",
    "Project and runtime context:",
    input.projectContext,
    input.webContext
      ? ["", "Scraped web context:", input.webContext].join("\n")
      : "",
    "",
    "Return focused findings for the synthesizer. Do not write the final user-facing answer unless your task requires it.",
  ]
    .filter(Boolean)
    .join("\n");

const buildSynthesisPrompt = (
  input: ConversationOrchestrationInput,
  reports: SpecialistReport[],
  operationResults: ConversationFileOperationResult[],
) =>
  [
    "User request:",
    input.message,
    "",
    input.history ? `Conversation history:\n${input.history}` : "",
    "",
    "Project and runtime context:",
    input.projectContext,
    input.webContext
      ? ["", "Scraped web context:", input.webContext].join("\n")
      : "",
    "",
    "Specialist reports:",
    reports
      .map(
        (report) =>
          `## ${report.agent}\nTask: ${report.task}\n${report.content}`,
      )
      .join("\n\n"),
    "",
    "Pipeline operation results:",
    buildFileOperationSummary(operationResults),
    "",
    "Write the final answer for the user now.",
    "If operations were applied, clearly list the changed paths and what changed.",
    "For code implementation responses, start with Project Structure, then Files/Updated Files with full file contents.",
  ]
    .filter(Boolean)
    .join("\n");

export const runConversationAgentOrchestration = async (
  input: ConversationOrchestrationInput,
) => {
  const useReducedAgentPlan = [
    SUPERVISOR_MODEL,
    SPECIALIST_MODEL,
    SYNTHESIS_MODEL,
    FILE_OPS_MODEL,
  ].some((model) => isGeminiModelCoolingDown(model.trim()));

  const supervisorPrompt = [
    "User request:",
    input.message,
    "",
    input.history ? `Conversation history:\n${input.history}` : "",
    "",
    "Project context:",
    input.projectContext,
    input.webContext ? `\nScraped web context:\n${input.webContext}` : "",
  ].join("\n");

  let supervisorText = "";
  let supervisorJson: string | null = null;
  let parsedPlan: unknown = null;

  if (useReducedAgentPlan) {
    supervisorText = "supervisor-skipped-due-to-gemini-cooldown";
    parsedPlan = {
      assignments: [
        {
          agent: "implementation",
          task: "Provide a direct, concise answer and include code when needed.",
        },
      ],
    };
  } else {
    try {
      supervisorText = await runAgentTextWithFallback({
        agent: supervisorAgent,
        prompt: supervisorPrompt,
        systemPrompt: SUPERVISOR_SYSTEM_PROMPT,
        model: SUPERVISOR_MODEL,
        label: "supervisor",
      });
      supervisorJson = extractJsonObject(supervisorText);

      if (supervisorJson) {
        try {
          parsedPlan = JSON.parse(supervisorJson);
        } catch {
          parsedPlan = null;
        }
      }
    } catch (error) {
      supervisorText =
        error instanceof Error
          ? `supervisor-error: ${error.message}`
          : "supervisor-error";
      parsedPlan = null;
    }
  }

  const assignments = normalizeAssignments(parsedPlan, input);

  const settledReports = await Promise.allSettled(
    assignments.map(async (assignment) => {
      const agent = specialistAgents[assignment.agent];
      const content = await runAgentTextWithFallback({
        agent,
        prompt: buildSpecialistPrompt(input, assignment),
        systemPrompt: SPECIALIST_SYSTEM_PROMPTS[assignment.agent],
        model: SPECIALIST_MODEL,
        label: `specialist:${assignment.agent}`,
      });

      return {
        agent: assignment.agent,
        task: assignment.task,
        content,
      };
    }),
  );

  const reports: SpecialistReport[] = settledReports.map(
    (reportResult, index) => {
      if (reportResult.status === "fulfilled") {
        return reportResult.value;
      }

      const fallbackAssignment = assignments[index];
      return {
        agent: fallbackAssignment?.agent ?? "implementation",
        task:
          fallbackAssignment?.task ??
          "Provide practical implementation guidance.",
        content: classifyError(reportResult.reason).message,
      };
    },
  );

  const fileOperationPlan = await planConversationFileOperations(input);
  const operationResults = await executePlannedFileOperations(
    fileOperationPlan.operations,
    input.executeFileOperation,
  );

  const intent = inferConversationIntent(input.message);
  const changedFiles = collectStructuredChangedFiles(operationResults);
  const folderEntries = collectStructuredFolderEntries(operationResults);

  let postOperationProjectFiles = input.projectFiles ?? [];
  if (
    operationResults.some((result) => result.status === "applied") &&
    input.loadProjectFilesAfterOperations
  ) {
    try {
      postOperationProjectFiles = await input.loadProjectFilesAfterOperations();
    } catch {
      postOperationProjectFiles = input.projectFiles ?? [];
    }
  }

  let content = "";

  if (
    shouldUseStructuredCodeResponse({ intent, changedFiles, folderEntries })
  ) {
    content = buildStructuredCodeResponse({
      intent,
      changedFiles,
      folderEntries,
      projectFiles: postOperationProjectFiles,
      operationResults,
    });
  } else if (useReducedAgentPlan && reports.length === 1) {
    const reducedContent = reports[0]?.content.trim() || "";
    content =
      operationResults.length > 0
        ? [
            reducedContent ||
              "Generated response under provider cooldown mode.",
            "",
            "Pipeline operation results:",
            buildFileOperationSummary(operationResults),
          ]
            .filter(Boolean)
            .join("\n")
        : reducedContent || "Generated response under provider cooldown mode.";
  } else {
    try {
      content = await runAgentTextWithFallback({
        agent: synthesisAgent,
        prompt: buildSynthesisPrompt(input, reports, operationResults),
        systemPrompt: SYNTHESIS_SYSTEM_PROMPT,
        model: SYNTHESIS_MODEL,
        label: "synthesis",
      });
    } catch (error) {
      const classified = classifyError(error);
      content =
        operationResults.length > 0
          ? [classified.message, buildFileOperationSummary(operationResults)]
              .filter(Boolean)
              .join("\n")
          : classified.message;
    }
  }

  return {
    content,
    assignments,
    reports,
    supervisorPlan: supervisorText,
    operations: fileOperationPlan.operations,
    operationResults,
    fileOperationPlannerOutput: fileOperationPlan.plannerOutput,
  };
};

export const generateConversationTitle = async (message: string) => {
  const title = await runAgentTextWithFallback({
    agent: titleAgent,
    prompt: ["Conversation starter:", message, "", "Title:"].join("\n"),
    systemPrompt: TITLE_SYSTEM_PROMPT,
    model: SPECIALIST_MODEL,
    label: "title",
  });

  return title
    .replace(/^["'`]+|["'`.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
};
