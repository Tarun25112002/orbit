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
  /\b(create|add|delete|remove|rename|move|update|edit|modify|write|rewrite|refactor|fix|implement|make|generate|scaffold|setup|build|install|uninstall|upgrade|downgrade|run|execute|command|terminal|dependency|dependencies)\b/i;
const FILE_OPERATION_PATH_HINT_PATTERN =
  /(?:\b(?:src|app|components|lib|convex|public)\/)|(?:\b[a-z0-9_-]+\.[a-z0-9]{1,8}\b)/i;
const CODE_GENERATION_INTENT_PATTERN =
  /\b(create|build|generate|scaffold|setup|implement|develop|write|add|new|from scratch|boilerplate|starter|component|page|route|endpoint|api|project|app|install|dependency|dependencies|run|execute)\b/i;
const CODE_UPDATE_INTENT_PATTERN =
  /\b(fix|update|modify|edit|refactor|improve|optimize|rename|move|delete|remove|patch|change|cleanup|install|uninstall|upgrade|downgrade|dependency|dependencies|run|execute|command|terminal)\b/i;
const COMMAND_OPERATION_INTENT_PATTERN =
  /\b(run|execute|install|uninstall|upgrade|downgrade|command|commands|terminal|script|scripts|dependency|dependencies|package\.json|npm|pnpm|yarn|bun)\b/i;
const PLACEHOLDER_CONTENT_PATTERN =
  /\b(?:TODO|TBD)\b|<code here>|your code here/i;
const MAX_FILE_OPERATIONS_PER_RUN = Number.parseInt(
  process.env.CONVERSATION_MAX_FILE_OPERATIONS?.trim() || "40",
  10,
);
const MAX_PROJECT_FILE_INVENTORY = 220;
const MAX_STRUCTURED_TREE_ENTRIES = 220;
const STEPWISE_TASK_INTENT_PATTERN =
  /\b(step|steps|task|tasks|crud|create|read|update|delete|rename|move|folder|file|install|dependency|dependencies|run|execute|command|terminal)\b/i;
const COMMAND_CHAINING_TOKEN_PATTERN = /^(?:&&|\|\||[|;])$/;
const DISALLOWED_COMMAND_SEQUENCE_PATTERN =
  /\b(?:git\s+reset\s+--hard|git\s+checkout\s+--|rm\s+-rf|rmdir\s+\/s|del\s+\/(?:s|q|f)|mkfs|format|shutdown|reboot)\b/i;
const ENABLE_FILE_OPS_PLANNER = !/^(0|false)$/i.test(
  process.env.CONVERSATION_ENABLE_FILE_OPS_PLANNER?.trim() ?? "",
);

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
  "You are Implementation Specialist - PRIMARY role.",
  "Write working code that can run.",
  "For file ops: create complete files with proper imports/exports.",
  "For framework tasks (Next.js/React/auth/API): create all needed frontend + backend files.",
  "Include package updates for new dependencies.",
  "Output: working code only, no TODOs.",
].join("\n");

const WEB_CONTEXT_SYSTEM_PROMPT = [
  "Use provided web context only.",
  "Reference external docs only when provided in input.",
].join("\n");

const SYNTHESIS_SYSTEM_PROMPT = [
  "You are the final response synthesizer for Orbit AI — an agentic coding assistant.",
  "Your job is to write the user-facing response AFTER operations have already been applied.",
  "",
  "CRITICAL RULES:",
  "- If file operations were applied, speak in PAST TENSE: 'I created…', 'I updated…', 'I installed…'",
  "- Do NOT dump full file contents. The files are already in the user's project.",
  "- Instead, briefly describe WHAT was done, WHY, and how to use it.",
  "- List the key files created/modified with one-line descriptions.",
  "- If commands were queued (npm install, dev server), confirm they are running.",
  "- If NO operations were applied, provide a helpful coding answer with code examples.",
  "- Be concise and actionable.",
].join("\n");

const TITLE_SYSTEM_PROMPT = "Create 3-6 word conversation title.";

const FILE_OPS_PLANNER_SYSTEM_PROMPT = [
  "You are Orbit AI's file operations planner. You are a REAL AGENT. Your JSON output is PARSED AND EXECUTED",
  "IMMEDIATELY — files are created, commands are run, and the dev server starts. You are NOT writing instructions",
  "for a human; you are programming a build system.",
  "",
  "═══════════════════════════════════════════════════",
  "OPERATION TYPES",
  "═══════════════════════════════════════════════════",
  "",
  "FILE OPERATIONS:",
  '  create_file   → {"type":"create_file","path":"<path>","content":"<full file content>"}',
  '  update_file   → {"type":"update_file","path":"<path>","content":"<full new file content>"}',
  '  create_folder → {"type":"create_folder","path":"<path>"}',
  '  delete_path   → {"type":"delete_path","path":"<path>"}',
  '  rename_path   → {"type":"rename_path","path":"<old>","newPath":"<new>"}',
  "",
  "COMMAND OPERATIONS:",
  '  run_command              → {"type":"run_command","command":"npm","commandArgs":["install"]}',
  '  start_background_command → {"type":"start_background_command","key":"dev-server","command":"npm","commandArgs":["run","dev"]}',
  "",
  "═══════════════════════════════════════════════════",
  "CRITICAL RULES",
  "═══════════════════════════════════════════════════",
  "",
  "1. COMPLETE CODE ONLY: Every create_file/update_file MUST contain the FULL, FINAL, RUNNABLE file content.",
  "   No placeholders. No `// TODO`. No `// add your code here`. No `...` ellipsis. Every file must work AS-IS.",
  "",
  "2. COMMANDS: Put the binary name in `command` and args in `commandArgs` array.",
  "   NEVER use shell chaining (&&, ||, ;, |). Use SEPARATE run_command operations instead.",
  "",
  "3. DEPENDENCY INSTALL: After creating/updating package.json, ALWAYS include:",
  '   {"type":"run_command","command":"npm","commandArgs":["install"]}',
  "",
  "4. DEV SERVER: To start the development server, ALWAYS use key 'dev-server':",
  '   {"type":"start_background_command","key":"dev-server","command":"npm","commandArgs":["run","dev"]}',
  "",
  "5. UPDATE = FULL REPLACE: When using update_file, include the COMPLETE new file content, not a diff.",
  "",
  "6. ORDER MATTERS: Operations execute sequentially. Create package.json BEFORE run_command npm install.",
  "   Create config files BEFORE source files that depend on them.",
  "",
  "═══════════════════════════════════════════════════",
  "FRAMEWORK SCAFFOLDING GUIDES",
  "═══════════════════════════════════════════════════",
  "",
  "▸ NEXT.JS (App Router):",
  "  Required files:",
  "  - package.json (next, react, react-dom + any extras like tailwindcss)",
  "  - next.config.mjs or next.config.ts",
  "  - tsconfig.json (with 'jsx': 'preserve', paths, etc.)",
  "  - src/app/layout.tsx (root layout with <html>, <body>)",
  "  - src/app/page.tsx (home page)",
  "  - src/app/globals.css (global styles or Tailwind directives)",
  "  Optional: src/app/api/*/route.ts for API routes, src/components/ for shared components",
  "  Config: postcss.config.mjs + tailwind.config.ts if using Tailwind",
  "",
  "▸ VITE + REACT:",
  "  Required files:",
  "  - package.json (vite, react, react-dom, @vitejs/plugin-react)",
  "  - vite.config.ts (import react plugin)",
  "  - tsconfig.json",
  "  - index.html (with <div id='root'> and <script type='module' src='/src/main.tsx'>)",
  "  - src/main.tsx (ReactDOM.createRoot render)",
  "  - src/App.tsx (main component)",
  "  - src/App.css or src/index.css",
  "",
  "▸ NODE.JS / EXPRESS BACKEND:",
  "  Required files:",
  "  - package.json (express, typescript, ts-node, @types/express, @types/node)",
  "  - tsconfig.json",
  "  - src/index.ts or src/server.ts (entry point with express app setup)",
  "",
  "▸ FULL-STACK (Next.js with API routes):",
  "  - All Next.js files above PLUS",
  "  - src/app/api/<resource>/route.ts files for RESTful endpoints",
  "  - src/lib/ for shared utilities, database connections, types",
  "",
  "═══════════════════════════════════════════════════",
  "CODE QUALITY REQUIREMENTS",
  "═══════════════════════════════════════════════════",
  "",
  "- Use TypeScript (.tsx/.ts) for all React/Next.js projects",
  "- Use proper imports (named imports, not require())",
  "- Include 'use client' directive for client components in Next.js App Router",
  "- Handle loading states, error states, and empty states in UI components",
  "- Use semantic HTML elements",
  "- Include proper TypeScript types/interfaces (no `any`)",
  "- For styling: use CSS modules, Tailwind CSS, or inline CSS — be consistent",
  "- API routes: proper error handling, status codes, JSON responses",
  "- Always export default for page/layout components in Next.js",
  "",
  "═══════════════════════════════════════════════════",
  "OUTPUT FORMAT",
  "═══════════════════════════════════════════════════",
  "",
  'Return ONLY valid JSON. No markdown. No explanations. No ```json fences.',
  '{"operations":[...]}',
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
    maxOutputTokens: 8_000,
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
    maxOutputTokens: 32_000,
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
  const objectStart = raw.indexOf("{");
  const arrayStart = raw.indexOf("[");

  if (objectStart === -1 && arrayStart === -1) {
    return null;
  }

  const shouldUseObjectRoot =
    objectStart !== -1 && (arrayStart === -1 || objectStart < arrayStart);

  if (shouldUseObjectRoot) {
    const end = raw.lastIndexOf("}");
    if (end === -1 || end <= objectStart) {
      return null;
    }

    return raw.slice(objectStart, end + 1);
  }

  const end = raw.lastIndexOf("]");
  if (end === -1 || end <= arrayStart) {
    return null;
  }

  return raw.slice(arrayStart, end + 1);
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

const normalizeOperationType = (
  value: unknown,
): ConversationFileOperation["type"] | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  switch (normalized) {
    case "create_file":
    case "add_file":
    case "new_file":
    case "write_file":
      return "create_file";
    case "create_folder":
    case "create_dir":
    case "create_directory":
    case "add_folder":
    case "mkdir":
      return "create_folder";
    case "update_file":
    case "edit_file":
    case "modify_file":
    case "rewrite_file":
    case "patch_file":
    case "replace_file":
      return "update_file";
    case "delete_path":
    case "delete_file":
    case "delete_folder":
    case "remove_path":
    case "remove_file":
    case "remove_folder":
      return "delete_path";
    case "rename_path":
    case "move_path":
    case "rename_file":
    case "move_file":
    case "rename_folder":
    case "move_folder":
      return "rename_path";
    case "run_command":
    case "command":
    case "execute_command":
    case "run_shell":
    case "shell_command":
      return "run_command";
    case "start_background_command":
    case "background_command":
    case "start_background":
    case "run_background_command":
      return "start_background_command";
    default:
      return null;
  }
};

const tokenizeCommandLine = (value: string) => {
  const matches = value.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];

  return matches.map((token) => token.replace(/^("|')|("|')$/g, ""));
};

const parseCommandSpec = (args: {
  commandValue: unknown;
  commandArgsValue: unknown;
}) => {
  const rawCommand =
    typeof args.commandValue === "string" ? args.commandValue.trim() : "";

  if (!rawCommand) {
    return null;
  }

  const commandTokens = tokenizeCommandLine(rawCommand);
  if (commandTokens.length === 0) {
    return null;
  }

  const explicitArgs = parseCommandArgs(args.commandArgsValue) ?? [];
  const [command, ...inlineArgs] = commandTokens;
  const mergedArgs = [...inlineArgs, ...explicitArgs].slice(0, 40);

  return {
    command,
    commandArgs: mergedArgs.length > 0 ? mergedArgs : undefined,
  };
};

const getStringField = (
  record: Record<string, unknown>,
  keys: string[],
): string | null => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return null;
};

const unwrapOperationContainer = (value: unknown): unknown => {
  const record = toRecord(value);
  if (!record) {
    return value;
  }

  const nested =
    ("operation" in record ? record.operation : undefined) ??
    ("action" in record ? record.action : undefined) ??
    ("payload" in record ? record.payload : undefined);

  if (nested === undefined) {
    return record;
  }

  return nested;
};

const collectOperationCandidates = (value: unknown): unknown[] => {
  if (Array.isArray(value)) {
    return value.map((candidate) => unwrapOperationContainer(candidate));
  }

  const record = toRecord(value);
  if (!record) {
    return [];
  }

  const candidates: unknown[] = [];

  const pushCollection = (collection: unknown) => {
    if (!Array.isArray(collection)) {
      return;
    }

    for (const item of collection) {
      candidates.push(unwrapOperationContainer(item));
    }
  };

  pushCollection(record.operations);
  pushCollection(record.steps);
  pushCollection(record.actions);

  const planRecord = toRecord(record.plan);
  if (planRecord) {
    pushCollection(planRecord.operations);
    pushCollection(planRecord.steps);
    pushCollection(planRecord.actions);
  }

  const batchRecord = toRecord(record.batch);
  if (batchRecord) {
    pushCollection(batchRecord.operations);
    pushCollection(batchRecord.steps);
    pushCollection(batchRecord.actions);
  }

  const dataRecord = toRecord(record.data);
  if (dataRecord) {
    pushCollection(dataRecord.operations);
    pushCollection(dataRecord.steps);
    pushCollection(dataRecord.actions);
  }

  if (
    candidates.length === 0 &&
    (normalizeOperationType(record.type) !== null ||
      normalizeOperationType(record.operation) !== null ||
      normalizeOperationType(record.action) !== null ||
      toRecord(record.operation) !== null ||
      toRecord(record.action) !== null)
  ) {
    candidates.push(unwrapOperationContainer(record));
  }

  return candidates;
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

const detectPackageManagerForInstall = (
  operations: ConversationFileOperation[],
  projectFiles: ConversationProjectFile[] = [],
) => {
  const hasPath = (path: string) =>
    operations.some(
      (operation) =>
        (operation.type === "create_file" ||
          operation.type === "update_file") &&
        operation.path === path,
    ) || projectFiles.some((file) => file.path === path);

  if (hasPath("pnpm-lock.yaml")) {
    return "pnpm" as const;
  }

  if (hasPath("yarn.lock")) {
    return "yarn" as const;
  }

  if (hasPath("bun.lock") || hasPath("bun.lockb")) {
    return "bun" as const;
  }

  return "npm" as const;
};

const hasPackageJsonMutation = (operations: ConversationFileOperation[]) =>
  operations.some(
    (operation) =>
      (operation.type === "create_file" || operation.type === "update_file") &&
      operation.path === "package.json",
  );

const hasDependencyInstallCommand = (
  operations: ConversationFileOperation[],
) => {
  return operations.some((operation) => {
    if (operation.type !== "run_command") {
      return false;
    }

    const command = operation.command.trim().toLowerCase();
    const firstArg = operation.commandArgs?.[0]?.trim().toLowerCase();
    if (!firstArg) {
      return false;
    }

    if (command === "npm") {
      return firstArg === "install" || firstArg === "i" || firstArg === "ci";
    }

    if (command === "pnpm" || command === "yarn" || command === "bun") {
      return firstArg === "install";
    }

    return false;
  });
};

const ensureDependencyInstallOperation = (
  operations: ConversationFileOperation[],
  projectFiles: ConversationProjectFile[] = [],
) => {
  if (!hasPackageJsonMutation(operations)) {
    return operations;
  }

  if (hasDependencyInstallCommand(operations)) {
    return operations;
  }

  const command = detectPackageManagerForInstall(operations, projectFiles);

  return [
    ...operations,
    {
      type: "run_command",
      command,
      commandArgs: ["install"],
    } satisfies ConversationFileOperation,
  ];
};

const parseFileOperation = (
  value: unknown,
): ConversationFileOperation | null => {
  const record = toRecord(value);
  if (!record) {
    return null;
  }

  const type = normalizeOperationType(
    record.type ?? record.operation ?? record.action,
  );

  if (!type) {
    return null;
  }

  if (type === "run_command") {
    const commandSpec = parseCommandSpec({
      commandValue:
        record.command ?? record.cmd ?? record.shell ?? record.script,
      commandArgsValue:
        record.commandArgs ?? record.args ?? record.arguments ?? record.params,
    });

    if (!commandSpec) {
      return null;
    }

    return {
      type: "run_command",
      ...commandSpec,
    };
  }

  if (type === "start_background_command") {
    const commandSpec = parseCommandSpec({
      commandValue:
        record.command ?? record.cmd ?? record.shell ?? record.script,
      commandArgsValue:
        record.commandArgs ?? record.args ?? record.arguments ?? record.params,
    });
    const key = normalizeCommandKey(
      record.key ?? record.name ?? record.id ?? "background-command",
    );

    if (!commandSpec || !key) {
      return null;
    }

    return {
      type: "start_background_command",
      key,
      ...commandSpec,
    };
  }

  const path = normalizeOperationPath(
    getStringField(record, [
      "path",
      "filePath",
      "filepath",
      "folderPath",
      "directoryPath",
      "dirPath",
      "targetPath",
    ]) ?? "",
  );

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
    const content =
      typeof record.content === "string"
        ? record.content
        : typeof record.fileContent === "string"
          ? record.fileContent
          : typeof record.value === "string"
            ? record.value
            : null;

    if (typeof content !== "string") {
      return null;
    }

    return {
      type: "create_file",
      path,
      content,
      overwrite: parseOptionalBoolean(record.overwrite) ?? true,
    };
  }

  if (type === "update_file") {
    const content =
      typeof record.content === "string"
        ? record.content
        : typeof record.fileContent === "string"
          ? record.fileContent
          : typeof record.value === "string"
            ? record.value
            : null;

    if (typeof content !== "string") {
      return null;
    }

    return {
      type: "update_file",
      path,
      content,
      createIfMissing: parseOptionalBoolean(record.createIfMissing) ?? true,
    };
  }

  if (type === "rename_path") {
    const newPath = normalizeOperationPath(
      getStringField(record, [
        "newPath",
        "toPath",
        "destinationPath",
        "targetPath",
      ]) ?? "",
    );

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
  const rawOperations = collectOperationCandidates(value);

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

  if (COMMAND_OPERATION_INTENT_PATTERN.test(message)) {
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

      const commandParts = [
        operation.command,
        ...(operation.commandArgs ?? []),
      ];
      if (
        commandParts.some((part) =>
          COMMAND_CHAINING_TOKEN_PATTERN.test(part.trim()),
        )
      ) {
        issues.push(
          "run_command must not include shell chaining tokens (&&, ||, ;, |). Use separate operations.",
        );
      }

      if (DISALLOWED_COMMAND_SEQUENCE_PATTERN.test(commandParts.join(" "))) {
        issues.push("run_command contains a disallowed destructive command.");
      }

      continue;
    }

    if (operation.type === "start_background_command") {
      if (!operation.command.trim()) {
        issues.push(
          `start_background_command (${operation.key}) has an empty command.`,
        );
      }

      const commandParts = [
        operation.command,
        ...(operation.commandArgs ?? []),
      ];
      if (
        commandParts.some((part) =>
          COMMAND_CHAINING_TOKEN_PATTERN.test(part.trim()),
        )
      ) {
        issues.push(
          `start_background_command (${operation.key}) must not include shell chaining tokens.`,
        );
      }

      if (DISALLOWED_COMMAND_SEQUENCE_PATTERN.test(commandParts.join(" "))) {
        issues.push(
          `start_background_command (${operation.key}) contains a disallowed destructive command.`,
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

    // Only reject truly empty placeholder files (< 50 chars and only TODO/TBD)
    // Do NOT reject real code files that happen to contain TODO comments
    const trimmedContent = operation.content.trim();
    if (
      trimmedContent.length < 50 &&
      /^(?:\/\/\s*)?(?:TODO|TBD)(?:\s|:|\.|$)/i.test(trimmedContent)
    ) {
      issues.push(
        `${operation.type} ${operation.path} appears to be placeholder-only content.`,
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

const PLANNER_KEY_FILE_PATTERNS = [
  "package.json",
  "tsconfig.json",
  "next.config.ts",
  "next.config.js",
  "next.config.mjs",
  "vite.config.ts",
  "vite.config.js",
  "tailwind.config.ts",
  "tailwind.config.js",
  "postcss.config.mjs",
  "postcss.config.js",
] as const;

const MAX_PLANNER_KEY_FILE_CHARS = 3_000;

const buildPlannerKeyFileContext = (
  files: ConversationProjectFile[] = [],
) => {
  const blocks: string[] = [];

  for (const pattern of PLANNER_KEY_FILE_PATTERNS) {
    const file = files.find(
      (f) => f.type === "file" && (f.path === pattern || f.path.endsWith(`/${pattern}`)),
    );

    if (!file?.content) {
      continue;
    }

    const content =
      file.content.length > MAX_PLANNER_KEY_FILE_CHARS
        ? `${file.content.slice(0, MAX_PLANNER_KEY_FILE_CHARS)}\n/* ...truncated... */`
        : file.content;

    blocks.push(`--- ${file.path} ---\n${content}`);
  }

  return blocks;
};

const buildFileOperationPlannerPrompt = (
  input: ConversationOrchestrationInput,
) => {
  const fileInventory = buildProjectFileInventory(input.projectFiles);
  const keyFileBlocks = buildPlannerKeyFileContext(input.projectFiles);
  const hasPackageJson = input.projectFiles?.some(
    (f) => f.path === "package.json" || f.path.endsWith("/package.json"),
  );

  return [
    "TASK (will be executed immediately — your output creates real files and runs real commands):",
    input.message,
    "",
    input.history ? `CONVERSATION HISTORY:\n${input.history.slice(0, 1500)}` : "",
    "",
    "EXISTING PROJECT FILES:",
    fileInventory,
    "",
    ...(keyFileBlocks.length > 0
      ? ["EXISTING KEY FILE CONTENTS:", ...keyFileBlocks, ""]
      : []),
    hasPackageJson
      ? "package.json EXISTS — use update_file with the FULL updated content to add dependencies"
      : "NO package.json — create one with create_file including all needed dependencies",
    "",
    "PROJECT CONTEXT:",
    input.projectContext?.slice(0, 6000) || "(empty project)",
    "",
    "REMINDERS:",
    "- Your output is EXECUTED, not displayed. Include COMPLETE file contents.",
    "- After changing package.json: {\"type\":\"run_command\",\"command\":\"npm\",\"commandArgs\":[\"install\"]}",
    "- To start dev server: {\"type\":\"start_background_command\",\"key\":\"dev-server\",\"command\":\"npm\",\"commandArgs\":[\"run\",\"dev\"]}",
    "- Create ALL files needed for the task. Do not leave gaps or TODOs.",
    "",
    "Return ONLY valid JSON: {\"operations\":[...]}",
  ].filter(Boolean).join("\n");
};

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
  if (!ENABLE_FILE_OPS_PLANNER) {
    return false;
  }

  if (COMMAND_OPERATION_INTENT_PATTERN.test(input.message)) {
    return true;
  }

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

const runFileOpsPlannerDirect = async (
  prompt: string,
  label: string,
): Promise<string> => {
  console.info(`conversation.planner.${label}.call`, {
    promptLength: prompt.length,
  });

  const result = await generateGeminiCompletion({
    model: FILE_OPS_MODEL,
    messages: [
      { role: "user", content: `${FILE_OPS_PLANNER_SYSTEM_PROMPT}\n\n${prompt}` },
    ],
    maxTokens: 32_000,
    temperature: 0.1,
  });

  console.info(`conversation.planner.${label}.response`, {
    model: result.model,
    outputLength: result.content.length,
    outputPreview: result.content.slice(0, 500),
  });

  return result.content;
};

const planConversationFileOperations = async (
  input: ConversationOrchestrationInput,
) => {
  if (!input.executeFileOperation) {
    console.info("conversation.planner.skip", { reason: "no-execute-handler" });
    return {
      operations: [] as ConversationFileOperation[],
      plannerOutput: "",
    };
  }

  if (!shouldPlanFileOperations(input)) {
    console.info("conversation.planner.skip", {
      reason: "intent-skip",
      message: input.message.slice(0, 100),
    });
    return {
      operations: [] as ConversationFileOperation[],
      plannerOutput: "intent-skip",
    };
  }

  const extractOperations = (output: string): ConversationFileOperation[] => {
    // Strip markdown code fences that the model sometimes wraps JSON in
    const cleaned = output
      .replace(/^```(?:json)?\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "")
      .trim();

    const plannerJson = extractJsonObject(cleaned);
    if (!plannerJson) {
      console.warn("conversation.planner.json-extract-failed", {
        outputLength: output.length,
        outputPreview: output.slice(0, 500),
        cleanedPreview: cleaned.slice(0, 500),
      });
      return [];
    }

    try {
      const parsed = JSON.parse(plannerJson) as unknown;
      const ops = parseFileOperationPlan(parsed);
      console.info("conversation.planner.parsed", {
        jsonLength: plannerJson.length,
        operationCount: ops.length,
        types: ops.map((o) => o.type),
      });
      return ops;
    } catch (parseError) {
      console.warn("conversation.planner.json-parse-failed", {
        jsonLength: plannerJson.length,
        jsonPreview: plannerJson.slice(0, 300),
        error: parseError instanceof Error ? parseError.message : String(parseError),
      });
      return [];
    }
  };

  try {
    console.info("conversation.planner.start", {
      message: input.message.slice(0, 100),
      projectFileCount: input.projectFiles?.length ?? 0,
    });

    const plannerPrompt = buildFileOperationPlannerPrompt(input);
    const plannerOutput = await runFileOpsPlannerDirect(plannerPrompt, "primary");

    const operations = ensureDependencyInstallOperation(
      ensureFolderOperationsForWrites(
        extractOperations(plannerOutput),
        input.projectFiles,
      ),
      input.projectFiles,
    ).slice(0, MAX_FILE_OPERATIONS_PER_RUN);
    const issues = validateFileOperationPlan(operations);

    console.info("conversation.planner.result", {
      operationCount: operations.length,
      issueCount: issues.length,
      issues: issues.slice(0, 5),
      types: operations.map((o) => o.type),
    });

    if (operations.length > 0 && issues.length === 0) {
      return {
        operations,
        plannerOutput,
      };
    }

    const retryIssues =
      operations.length === 0 ? ["No valid operations were returned."] : issues;

    console.info("conversation.planner.retry", { retryIssues });

    const retryPrompt = buildFileOperationPlannerRetryPrompt(
      input,
      plannerOutput,
      retryIssues,
    );
    const retryOutput = await runFileOpsPlannerDirect(retryPrompt, "retry");

    const retryOperations = ensureDependencyInstallOperation(
      ensureFolderOperationsForWrites(
        extractOperations(retryOutput),
        input.projectFiles,
      ),
      input.projectFiles,
    ).slice(0, MAX_FILE_OPERATIONS_PER_RUN);
    const retryValidationIssues = validateFileOperationPlan(retryOperations);

    console.info("conversation.planner.retry-result", {
      operationCount: retryOperations.length,
      issueCount: retryValidationIssues.length,
      issues: retryValidationIssues.slice(0, 5),
    });

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
    console.error("conversation.planner.error", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack?.slice(0, 500) : undefined,
    });
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
    if (!executeFileOperation) {
      const isCommandOperation =
        operation.type === "run_command" ||
        operation.type === "start_background_command";

      results.push({
        operation,
        status: isCommandOperation ? "applied" : "skipped",
        message: isCommandOperation
          ? "Queued for WebContainer runtime execution."
          : "No execution handler is available.",
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

  const appliedCount = args.operationResults.filter(
    (r) => r.status === "applied",
  ).length;
  const failedCount = args.operationResults.filter(
    (r) => r.status === "failed",
  ).length;

  const hasInstallCommand = args.operationResults.some(
    (r) =>
      r.status === "applied" &&
      r.operation.type === "run_command" &&
      (r.operation.command === "npm" ||
        r.operation.command === "pnpm" ||
        r.operation.command === "yarn" ||
        r.operation.command === "bun") &&
      r.operation.commandArgs?.some(
        (arg) => arg === "install" || arg === "i" || arg === "ci",
      ),
  );

  const hasDevServer = args.operationResults.some(
    (r) =>
      r.status === "applied" &&
      r.operation.type === "start_background_command",
  );

  // Build summary header
  const summaryParts: string[] = [];
  if (args.changedFiles.length > 0) {
    const verb = args.intent === "code_update" ? "Updated" : "Created";
    summaryParts.push(
      `${verb} ${args.changedFiles.length} file${args.changedFiles.length === 1 ? "" : "s"}`,
    );
  }
  if (args.folderEntries.length > 0) {
    summaryParts.push(
      `${args.folderEntries.length} folder${args.folderEntries.length === 1 ? "" : "s"}`,
    );
  }
  if (hasInstallCommand) {
    summaryParts.push("installed dependencies");
  }
  if (hasDevServer) {
    summaryParts.push("started dev server");
  }

  const sections: string[] = [];

  // Header confirming actions
  if (summaryParts.length > 0) {
    sections.push(`\u2705 **Done** \u2014 ${summaryParts.join(", ")}.`);
    sections.push("");
  }

  // Project structure
  sections.push("**Project Structure:**", ...structureLines, "");

  // File list with brief descriptions (no full code dumps)
  if (args.changedFiles.length > 0) {
    const label =
      args.intent === "code_update"
        ? "**Files Modified:**"
        : "**Files Created:**";
    sections.push(label);
    for (const file of args.changedFiles) {
      sections.push(`- \`${file.path}\``);
    }
    sections.push("");
  }

  // Command operations
  const commandOps = args.operationResults.filter(
    (result) =>
      result.status === "applied" &&
      (result.operation.type === "run_command" ||
        result.operation.type === "start_background_command"),
  );

  if (commandOps.length > 0) {
    sections.push("**Commands Executed:**");
    for (const result of commandOps) {
      sections.push(
        `- \u2705 ${describeFileOperation(result.operation)}`,
      );
    }
    sections.push("");
  }

  // Failures
  if (failedCount > 0) {
    const failedOps = args.operationResults.filter(
      (r) => r.status === "failed",
    );
    sections.push("**\u26a0\ufe0f Issues:**");
    for (const result of failedOps) {
      sections.push(
        `- \u274c ${describeFileOperation(result.operation)}: ${result.message}`,
      );
    }
    sections.push("");
  }

  // Summary stats
  if (appliedCount > 0) {
    sections.push(
      `*${appliedCount} operation${appliedCount === 1 ? "" : "s"} applied successfully${failedCount > 0 ? `, ${failedCount} failed` : ""}.*`,
    );
  }

  return sections.join("\n");
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
) => {
  const hasAppliedOperations = operationResults.some(
    (result) => result.status === "applied",
  );

  const operationInstructions = hasAppliedOperations
    ? [
        "",
        "IMPORTANT: File operations were ALREADY APPLIED to the user's project.",
        "- Speak in PAST TENSE: 'I created...', 'I updated...', 'I installed...'",
        "- Do NOT dump full file contents \u2014 the files already exist in the project.",
        "- Briefly describe WHAT was done and HOW the user can use it.",
        "- List key files with one-line descriptions.",
        "- If commands were queued (npm install, dev server), confirm they are running.",
      ]
    : [
        "",
        "No file operations were applied. Write a helpful coding answer.",
        "Include code examples where relevant. Use markdown formatting.",
      ];

  return [
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
    ...operationInstructions,
    "",
    "Write the final answer for the user now.",
  ]
    .filter(Boolean)
    .join("\n");
};

export const runConversationAgentOrchestration = async (
  input: ConversationOrchestrationInput,
) => {
  const intent = inferConversationIntent(input.message);
  const fileOperationPlan = await planConversationFileOperations(input);
  const operationResults = await executePlannedFileOperations(
    fileOperationPlan.operations,
    input.executeFileOperation,
  );
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

  if (
    shouldUseStructuredCodeResponse({ intent, changedFiles, folderEntries })
  ) {
    return {
      content: buildStructuredCodeResponse({
        intent,
        changedFiles,
        folderEntries,
        projectFiles: postOperationProjectFiles,
        operationResults,
      }),
      assignments: [] as AgentAssignment[],
      reports: [] as SpecialistReport[],
      supervisorPlan: "supervisor-skipped-direct-file-ops-mode",
      operations: fileOperationPlan.operations,
      operationResults,
      fileOperationPlannerOutput: fileOperationPlan.plannerOutput,
    };
  }

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

  let content = "";

  if (useReducedAgentPlan && reports.length === 1) {
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
