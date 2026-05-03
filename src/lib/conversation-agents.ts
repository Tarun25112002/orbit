import { createAgent, gemini, type AgentResult } from "@inngest/agent-kit";
import {
  GEMINI_MODEL_DEFAULT,
  generateGeminiCompletion,
  getGeminiModelCooldownSeconds,
  getGeminiRateLimitMetadata,
  isGeminiModelCoolingDown,
  markGeminiModelRateLimited,
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
const FILE_OPS_FAST_MODEL =
  process.env.CONVERSATION_FILE_OPS_FAST_MODEL?.trim() ||
  process.env.CONVERSATION_FAST_MODEL?.trim() ||
  SPECIALIST_MODEL;
const PLANNER_MODEL_ROTATION = Array.from(
  new Set(
    [FILE_OPS_MODEL, SPECIALIST_MODEL, SUPERVISOR_MODEL]
      .map((model) => model.trim())
      .filter(Boolean),
  ),
);

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
const MAX_FILE_OPERATIONS_PER_RUN = Number.parseInt(
  process.env.CONVERSATION_MAX_FILE_OPERATIONS?.trim() || "120",
  10,
);
const MAX_PROJECT_FILE_INVENTORY = 500;
const MAX_STRUCTURED_TREE_ENTRIES = 500;
const STEPWISE_TASK_INTENT_PATTERN =
  /\b(step|steps|task|tasks|crud|create|read|update|delete|rename|move|folder|file|install|dependency|dependencies|run|execute|command|terminal)\b/i;
const COMMAND_CHAINING_TOKEN_PATTERN = /^(?:&&|\|\||[|;])$/;
const DISALLOWED_COMMAND_SEQUENCE_PATTERN =
  /\b(?:git\s+reset\s+--hard|git\s+checkout\s+--|rm\s+-rf|rmdir\s+\/s|del\s+\/(?:s|q|f)|mkfs|format|shutdown|reboot)\b/i;
const ENABLE_FILE_OPS_PLANNER = !/^(0|false)$/i.test(
  process.env.CONVERSATION_ENABLE_FILE_OPS_PLANNER?.trim() ?? "",
);
const ENABLE_AGENT_PRIMARY_CALL = /^(1|true)$/i.test(
  process.env.CONVERSATION_ENABLE_AGENT_PRIMARY?.trim() ?? "",
);
const FORCE_CHAINED_MODEL_FALLBACK = !/^(0|false)$/i.test(
  process.env.CONVERSATION_FORCE_CHAINED_MODEL_FALLBACK?.trim() ?? "true",
);

const parsePositiveInt = (value: string | undefined, fallback: number) => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

const FILE_OPS_PLANNER_MIN_OUTPUT_TOKENS = 8_192;
const FILE_OPS_PLANNER_MAX_OUTPUT_TOKENS = Math.max(
  FILE_OPS_PLANNER_MIN_OUTPUT_TOKENS,
  parsePositiveInt(
    process.env.CONVERSATION_FILE_OPS_MAX_OUTPUT_TOKENS?.trim(),
    65_536,
  ),
);
const MAX_PLANNER_CALLS_PER_REQUEST = parsePositiveInt(
  process.env.CONVERSATION_FILE_OPS_MAX_CALLS_PER_REQUEST?.trim(),
  15,
);
const FILE_OPS_PLANNER_MAX_RETRIES = parsePositiveInt(
  process.env.CONVERSATION_FILE_OPS_MAX_RETRIES?.trim(),
  3,
);
const FILE_OPS_PLANNER_CHUNK_MAX_RETRIES = parsePositiveInt(
  process.env.CONVERSATION_FILE_OPS_CHUNK_MAX_RETRIES?.trim(),
  2,
);
const ENABLE_COMPLEX_BUILD_CHUNKING = !/^(0|false)$/i.test(
  process.env.CONVERSATION_ENABLE_COMPLEX_BUILD_CHUNKING?.trim() ?? "true",
);
const MAX_COMPLEX_BUILD_CHUNKS = parsePositiveInt(
  process.env.CONVERSATION_COMPLEX_BUILD_MAX_CHUNKS?.trim(),
  8,
);
const MAX_FILE_OPERATIONS_PER_COMPLEX_RUN = parsePositiveInt(
  process.env.CONVERSATION_MAX_COMPLEX_FILE_OPERATIONS?.trim(),
  300,
);
const MAX_PLANNER_HISTORY_CHARS = parsePositiveInt(
  process.env.CONVERSATION_FILE_OPS_HISTORY_CHARS?.trim(),
  16_000,
);
const MAX_PLANNER_PROJECT_CONTEXT_CHARS = parsePositiveInt(
  process.env.CONVERSATION_FILE_OPS_PROJECT_CONTEXT_CHARS?.trim(),
  40_000,
);
const MAX_PLANNER_KEY_FILE_CHARS = parsePositiveInt(
  process.env.CONVERSATION_FILE_OPS_KEY_FILE_CHARS?.trim(),
  16_000,
);
const MAX_FIXUP_ITERATIONS = parsePositiveInt(
  process.env.CONVERSATION_MAX_FIXUP_ITERATIONS?.trim(),
  5,
);
const MAX_FIXUP_OUTPUT_CHARS = parsePositiveInt(
  process.env.CONVERSATION_FIXUP_MAX_OUTPUT_CHARS?.trim(),
  8_000,
);
const ENABLE_DEP_PREVALIDATION = !/^(0|false)$/i.test(
  process.env.CONVERSATION_ENABLE_DEP_PREVALIDATION?.trim() ?? "true",
);
const ENABLE_INSTALL_GATE = !/^(0|false)$/i.test(
  process.env.CONVERSATION_ENABLE_INSTALL_GATE?.trim() ?? "true",
);
const ENABLE_AUTONOMOUS_VALIDATION = !/^(0|false)$/i.test(
  process.env.CONVERSATION_ENABLE_AUTONOMOUS_VALIDATION?.trim() ?? "true",
);
const ENABLE_TRACE_HISTORY = !/^(0|false)$/i.test(
  process.env.CONVERSATION_ENABLE_TRACE_HISTORY?.trim() ?? "true",
);
const ORBIT_VALIDATE_COMMAND = "orbit-validate";
const VITE_SCAFFOLD_INTENT_PATTERN =
  /\b(create|scaffold|setup|generate|starter|boilerplate|from scratch|new|build|make)\b/i;
const VITE_BASIC_STARTER_INTENT_PATTERN =
  /\b(starter|boilerplate|template|minimal|basic|blank|empty|hello world)\b/i;
const END_TO_END_BUILD_INTENT_PATTERN =
  /\b(end[\s-]?to[\s-]?end|production(?:\s|-)?ready|complete\s+app|complete\s+project)\b/i;
const COMPLEX_BUILD_TRIGGER_PATTERN =
  /\b(build|create|scaffold|setup|generate|implement|develop|ship|deliver)\b/i;
const COMPLEX_BUILD_SCOPE_PATTERN =
  /\b(app|application|project|platform|dashboard|portal|tool|service|saas)\b/i;
const COMPLEX_BUILD_STACK_PATTERN =
  /\b(frontend|front-end|ui|ux|react|component|page|layout|css|tailwind|design|style|styling|form|table|chart|graph|animation|responsive)\b/i;
const COMPLEX_FEATURE_SCOPE_PATTERN =
  /\b(multi-page|routing|router|state management|redux|zustand|context|form validation|chart|graph|dashboard|table|data visualization|drag and drop|infinite scroll|pagination|search|filter|sort|modal|drawer|toast|notification|theme|dark mode|i18n|localization)\b/i;
const STRICT_EXECUTION_ACTION_PATTERN =
  /\b(do it|apply(?:\s+it)?|apply changes|make changes|edit files|update files|create files|scaffold|set\s*up|setup|run commands?|execute commands?|install dependencies|wire up|hook up)\b/i;
const PROJECT_SCOPED_EXECUTION_PATTERN =
  /\b(in (?:my|the|this) (?:project|workspace|repo|repository|codebase)|on this codebase|in your codebase|for this project)\b/i;
const EXECUTION_FRUSTRATION_PATTERN =
  /\b(not\s+execut(?:e|ing)|just\s+giv(?:e|ing)\s+code|only\s+giv(?:e|ing)\s+code|plain\s+code(?:\s+only)?|only\s+plain\s+code|not\s+(?:making|creating|writing)\s+files?|not\s+generat(?:e|ing)\s+files?|not\s+updat(?:e|ing)\s+files?|not\s+just\s+code|dont\s+just\s+give\s+code|don't\s+just\s+give\s+code)\b/i;
const FAST_EXECUTION_INTENT_PATTERN =
  /\b(immediate(?:ly)?|immediatly|immideately|right\s+away|asap|step\s*by\s*step|execute\s+now|start\s+execut(?:e|ing)|execute\s+pipeline|run\s+pipeline|pipeline\s+(?:first|execution))\b/i;
const FRONTEND_PLANNER_STYLE_HINT_PATTERN =
  /\b(ui|ux|frontend|front-end|react|vite|component|page|layout|css|tailwind|design|style|styling)\b/i;
const STRICT_FILE_OPS_GATE_ENABLED = !/^(0|false)$/i.test(
  process.env.CONVERSATION_STRICT_FILE_OPS_GATE?.trim() ?? "true",
);
const REQUIRE_EXECUTABLE_FOR_CODE_INTENT = !/^(0|false)$/i.test(
  process.env.CONVERSATION_REQUIRE_EXECUTABLE_FOR_CODE_INTENT?.trim() ?? "true",
);
const VITE_REQUIRED_SCAFFOLD_FILE_PATHS = [
  "package.json",
  "vite.config.ts",
  "tsconfig.json",
  "index.html",
  "src/main.tsx",
  "src/App.tsx",
] as const;

const isFastExecutionRequest = (input: ConversationOrchestrationInput) => {
  const message = input.message;

  if (EXECUTION_FRUSTRATION_PATTERN.test(message)) {
    return true;
  }

  if (!FAST_EXECUTION_INTENT_PATTERN.test(message)) {
    return false;
  }

  return (
    STRICT_EXECUTION_ACTION_PATTERN.test(message) ||
    FILE_OPERATION_INTENT_PATTERN.test(message) ||
    COMMAND_OPERATION_INTENT_PATTERN.test(message)
  );
};

const shouldUseFastPlannerMode = (input: ConversationOrchestrationInput) => {
  const message = input.message;

  // Fast mode ONLY for explicit urgency/frustration patterns — NOT for normal
  // project generation requests. Words like "create", "build", "file" appear in
  // virtually every real prompt and must NOT trigger fast (low-reasoning) mode.
  if (EXECUTION_FRUSTRATION_PATTERN.test(message)) {
    return true;
  }

  if (
    FAST_EXECUTION_INTENT_PATTERN.test(message) &&
    STRICT_EXECUTION_ACTION_PATTERN.test(message)
  ) {
    return true;
  }

  return false;
};

const inferCallBudget = (input: ConversationOrchestrationInput): number => {
  // Fast mode still gets a generous budget since it only triggers on explicit urgency
  if (shouldUseFastPlannerMode(input)) {
    return Math.min(5, MAX_PLANNER_CALLS_PER_REQUEST);
  }

  const message = input.message;
  const isComplex =
    ENABLE_COMPLEX_BUILD_CHUNKING &&
    (END_TO_END_BUILD_INTENT_PATTERN.test(message) ||
      (COMPLEX_BUILD_TRIGGER_PATTERN.test(message) &&
        COMPLEX_BUILD_SCOPE_PATTERN.test(message) &&
        (COMPLEX_BUILD_STACK_PATTERN.test(message) ||
          COMPLEX_FEATURE_SCOPE_PATTERN.test(message))));

  const isMedium =
    !isComplex &&
    CODE_GENERATION_INTENT_PATTERN.test(message) &&
    (COMPLEX_BUILD_SCOPE_PATTERN.test(message) ||
      FILE_OPERATION_PATH_HINT_PATTERN.test(message));

  if (isComplex) return MAX_PLANNER_CALLS_PER_REQUEST;
  if (isMedium) return Math.min(8, MAX_PLANNER_CALLS_PER_REQUEST);
  return Math.min(6, MAX_PLANNER_CALLS_PER_REQUEST);
};

const pickAvailableModel = (preferredModel: string): string => {
  const trimmed = preferredModel.trim();
  if (!isGeminiModelCoolingDown(trimmed)) {
    return trimmed;
  }

  for (const candidate of PLANNER_MODEL_ROTATION) {
    if (!isGeminiModelCoolingDown(candidate.trim())) {
      return candidate;
    }
  }

  return trimmed;
};

const pickPlannerModelForAttempt = (
  preferredModel: string,
  attemptIndex: number,
) => {
  const candidates = Array.from(
    new Set(
      [preferredModel, ...PLANNER_MODEL_ROTATION]
        .map((model) => model.trim())
        .filter(Boolean),
    ),
  );

  const candidate =
    candidates[Math.max(0, attemptIndex) % Math.max(1, candidates.length)] ??
    preferredModel;

  return pickAvailableModel(candidate);
};

const buildDeterministicChunks = (
  input: ConversationOrchestrationInput,
): PlannerChunk[] => {
  const message = input.message;
  const hasExistingPackageJson = input.projectFiles?.some(
    (f) =>
      f.type === "file" &&
      (f.path === "package.json" || f.path.endsWith("/package.json")),
  );

  const chunks: PlannerChunk[] = [];

  if (!hasExistingPackageJson) {
    chunks.push({
      title: "Project Foundation",
      goal: "Create package.json with all needed dependencies (vite, react, react-dom, @vitejs/plugin-react, tailwindcss, postcss, autoprefixer, typescript), config files (tsconfig.json, vite.config.ts, postcss.config.js, tailwind.config.js), index.html, and src/index.css with Tailwind directives. Include COMPLETE dependency list so npm install succeeds in one pass.",
    });
  }

  chunks.push({
    title: "Core Implementation",
    goal: `Implement the main application code: entry point (src/main.tsx), App component, pages, components, and core UI logic for: ${message.slice(0, 250)}. Write COMPLETE, RUNNABLE files with proper imports/exports. Use Tailwind CSS for all styling.`,
  });

  if (COMPLEX_FEATURE_SCOPE_PATTERN.test(message)) {
    chunks.push({
      title: "Features & Polish",
      goal: "Implement additional UI features (routing, state management, forms, data visualization, etc.), connect all components, add proper error handling, loading states, responsive layouts, and type safety.",
    });
  }

  return chunks.slice(0, MAX_COMPLEX_BUILD_CHUNKS);
};

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
  /** Called after each operation completes with the running results so far.
   *  Used to stream real-time progress to the user. */
  onOperationProgress?: (
    completed: ConversationFileOperationResult[],
    total: number,
  ) => Promise<void> | void;
  /** Called during LLM generation with real-time text updates.
   *  Used to stream progress indicating which file is currently being generated. */
  onPlanningProgress?: (status: string) => void;
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
      gatedOnPreviousSuccess?: boolean;
    }
  | {
      type: "start_background_command";
      key: string;
      command: string;
      commandArgs?: string[];
      gatedOnPreviousSuccess?: boolean;
    };

export type ConversationFileOperationExecutionResult = {
  status: "applied" | "skipped" | "failed";
  message: string;
  commandOutput?: string;
  commandExitCode?: number | null;
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
  commandOutput?: string;
  commandExitCode?: number | null;
};

type SpecialistReport = {
  agent: SpecialistKey;
  task: string;
  content: string;
};

type PlannerCallBudget = {
  used: number;
  max: number;
};

type PlannerChunk = {
  title: string;
  goal: string;
};

type PlannedFileOperationBatch = {
  operations: ConversationFileOperation[];
  plannerOutput: string;
  plannerCallCount: number;
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
  "You are Orbit's architecture specialist for frontend applications.",
  "Focus on component structure, state management, data flow, and how the UI fits together.",
  "All projects use Vite + React + TypeScript. No backend code is generated.",
  "Return concise findings that another agent can synthesize into a final user answer.",
].join("\n");

const CODE_QUALITY_SYSTEM_PROMPT = [
  "You are Orbit's code-quality specialist.",
  "Focus on correctness, regressions, edge cases, and verification.",
  "Be specific and avoid generic advice.",
].join("\n");

const IMPLEMENTATION_SYSTEM_PROMPT = [
  "You are Orbit's Implementation Specialist — the PRIMARY code-generation engine.",
  "",
  "IMPORTANT: You ONLY generate FRONTEND code. You use Vite + React + TypeScript exclusively.",
  "NEVER generate backend code, API routes, Express servers, database code, or server-side logic.",
  "For data, use mock data, localStorage, or browser APIs. NOT real backends.",
  "",
  "YOUR CODE MUST BE PRODUCTION-QUALITY:",
  "- Write COMPLETE, RUNNABLE files — never stubs, never TODOs, never placeholders.",
  "- For UI: create BEAUTIFUL, MODERN interfaces with polished styling.",
  "  Use vibrant gradients, responsive states, proper spacing, and modern fonts.",
  "  Every page must look like it was designed by a professional — not a plain HTML page.",
  "- For React: include proper state management, loading states, error boundaries,",
  "  responsive layouts, accessibility attributes, and semantic HTML.",
  "- Use Tailwind CSS for all styling. Include tailwindcss in dependencies.",
  "",
  "STYLING STANDARDS:",
  "- Use modern color palettes (not plain red/blue/green). Prefer HSL-based harmonious schemes.",
  "- Dark mode: use dark backgrounds (#0a0a0a to #1a1a2e) with subtle borders and glows.",
  "- Light mode: use soft whites (#fafafa to #f0f4f8) with gentle shadows.",
  "- Typography: use system font stacks or Google Fonts (Inter, Outfit, Plus Jakarta Sans).",
  "- Spacing: consistent padding/margins using 4px/8px grid system.",
  "- Border radius: use modern rounded corners (8-16px for cards, 6-8px for buttons).",
  "- Shadows: layered shadows for depth (0 1px 3px, 0 4px 12px patterns).",
  "",
  "COMPONENT QUALITY:",
  "- Each component must handle: loading, error, empty, and success states.",
  "- Forms: include validation, disabled states, loading indicators on submit.",
  "- Lists: include empty states, loading skeletons, and proper key props.",
  "- Navigation: active states, hover effects, mobile responsiveness.",
  "- Use React Router for multi-page navigation when needed.",
  "",
  "Write code that makes users say 'wow, this looks amazing' at first glance.",
  "Include ALL necessary files — pages, components, styles, types, utilities.",
  "Include package.json updates for any new dependencies.",
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
  "PLATFORM CONSTRAINT — FRONTEND ONLY",
  "═══════════════════════════════════════════════════",
  "",
  "You ONLY generate FRONTEND applications using Vite + React + TypeScript.",
  "NEVER generate:",
  "- Backend code (Express, Fastify, Hono, NestJS, etc.)",
  "- API routes or server endpoints",
  "- Database code (Prisma, MongoDB, PostgreSQL, etc.)",
  "- Server-side rendering (Next.js, Remix, etc.)",
  "- Authentication backends (passport, JWT servers, etc.)",
  "",
  "Instead, for data needs use:",
  "- Mock data / hardcoded JSON arrays",
  "- localStorage / sessionStorage for persistence",
  "- Browser APIs (fetch to public APIs, geolocation, etc.)",
  "- React state (useState, useReducer, Context, Zustand)",
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
  '  run_command              → {"type":"run_command","command":"npm","commandArgs":["install","--legacy-peer-deps","--no-audit","--no-fund","--no-progress","--loglevel=error"]}',
  '  start_background_command → {"type":"start_background_command","key":"dev-server","command":"npm","commandArgs":["run","dev"]}',
  "",
  "═══════════════════════════════════════════════════",
  "CRITICAL RULES",
  "═══════════════════════════════════════════════════",
  "",
  "1. COMPLETE CODE ONLY: Every create_file/update_file MUST contain the FULL, FINAL, RUNNABLE file content.",
  "   No placeholders. No `// TODO`. No `// add your code here`. No `...` ellipsis. Every file must work AS-IS.",
  "   Implement COMPLETE, FUNCTIONAL UI with real interactions, state management, and polished styling.",
  "",
  "2. COMMANDS: Put the binary name in `command` and args in `commandArgs` array.",
  "   NEVER use shell chaining (&&, ||, ;, |). Use SEPARATE run_command operations instead.",
  "",
  "3. DEPENDENCY INSTALL: After creating/updating package.json, ALWAYS include:",
  '   {"type":"run_command","command":"npm","commandArgs":["install","--legacy-peer-deps","--no-audit","--no-fund","--no-progress","--loglevel=error"]}',
  "",
  "4. DEV SERVER: To start the development server, ALWAYS use key 'dev-server':",
  '   {"type":"start_background_command","key":"dev-server","command":"npm","commandArgs":["run","dev"]}',
  "",
  "5. VALIDATION: After file/dependency changes, run a build check before the dev server:",
  '   {"type":"run_command","command":"npm","commandArgs":["run","build","--if-present"]}',
  "",
  "6. UPDATE = FULL REPLACE: When using update_file, include the COMPLETE new file content, not a diff.",
  "",
  "7. ORDER MATTERS: Operations execute sequentially. Create package.json BEFORE run_command npm install.",
  "   Create config files BEFORE source files that depend on them.",
  "",
  "═══════════════════════════════════════════════════",
  "VITE + REACT PROJECT STRUCTURE",
  "═══════════════════════════════════════════════════",
  "",
  "Every new project MUST include these files:",
  "  - package.json (vite, react, react-dom, @vitejs/plugin-react, tailwindcss, postcss, autoprefixer, typescript, @types/react, @types/react-dom)",
  "  - vite.config.ts (import react plugin from @vitejs/plugin-react)",
  "  - tsconfig.json (Vite-compatible: jsx 'react-jsx', module 'ESNext', moduleResolution 'bundler')",
  "  - tsconfig.node.json (for vite.config.ts)",
  "  - postcss.config.js (tailwindcss + autoprefixer plugins)",
  "  - tailwind.config.js (content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'])",
  "  - index.html (with <div id='root'> and <script type='module' src='/src/main.tsx'>)",
  "  - src/main.tsx (ReactDOM.createRoot render)",
  "  - src/App.tsx (main app component with routing if multi-page)",
  "  - src/index.css (Tailwind directives: @tailwind base; @tailwind components; @tailwind utilities;)",
  "",
  "  Optional but recommended:",
  "  - src/components/ — reusable UI components",
  "  - src/pages/ — page-level components (for React Router)",
  "  - src/hooks/ — custom React hooks",
  "  - src/lib/ — utility functions",
  "  - src/types/ — TypeScript type definitions",
  "",
  "  For multi-page apps, use react-router-dom:",
  "  - Add react-router-dom to dependencies",
  "  - Use BrowserRouter, Routes, Route in App.tsx",
  "  - Create page components in src/pages/",
  "",
  "═══════════════════════════════════════════════════",
  "CODE QUALITY & UI/UX REQUIREMENTS",
  "═══════════════════════════════════════════════════",
  "",
  "TYPESCRIPT:",
  "- Use TypeScript (.tsx/.ts) for ALL files",
  "- Use proper imports (named imports, not require())",
  "- Include proper TypeScript types/interfaces — NEVER use `any`",
  "",
  "STYLING — USE TAILWIND CSS:",
  "- Use Tailwind CSS utility classes for ALL styling.",
  "- NEVER create plain, unstyled HTML. Every page MUST look polished and professional.",
  "- Use modern design: gradients, subtle shadows, crisp state changes, rounded corners.",
  "- Color palette: use harmonious HSL-based colors, NOT plain red/blue/green.",
  "  Example dark theme: bg-slate-900, surface bg-slate-800, accent indigo-500/violet-500, text slate-200",
  "  Example light theme: bg-slate-50, surface white, accent indigo-600/violet-600, text slate-900",
  "- Typography: use font-sans (Inter) with proper font weights.",
  "- Spacing: use Tailwind spacing scale (p-2, p-4, p-6, p-8, etc.).",
  "- Buttons: bg-gradient-to-r, rounded-lg, hover:shadow-lg, px-5 py-2.5, font-medium.",
  "- Cards: bg-white dark:bg-slate-800, rounded-xl, shadow-sm, border border-slate-200, p-6.",
  "- Inputs: w-full, px-4 py-2.5, border border-slate-300, rounded-lg, focus:ring-2 focus:ring-indigo-500.",
  "- Layout: use flex/grid. Make responsive with sm:/md:/lg: prefixes.",
  "- Navigation: sticky top-0, backdrop-blur, border-b, flex items-center justify-between.",
  "- Empty states: flex flex-col items-center justify-center with icon + message + CTA button.",
  "- Loading: use animated skeleton placeholders or spinner.",
  "",
  "═══════════════════════════════════════════════════",
  "OUTPUT FORMAT",
  "═══════════════════════════════════════════════════",
  "",
  "Return ONLY valid JSON. No markdown. No explanations. No ```json fences.",
  '{"operations":[...]}',
  "",
  "═══════════════════════════════════════════════════",
  "TOKEN UTILIZATION & COMPLETENESS",
  "═══════════════════════════════════════════════════",
  "",
  "YOU HAVE A LARGE OUTPUT BUDGET. USE IT. Do NOT cut corners to save tokens.",
  "- Generate COMPLETE files with ALL imports, ALL functions, ALL styles, ALL exports.",
  "- A PARTIAL file that crashes is WORSE than fewer complete files.",
  "- If the project has 10 files, generate all 10. Do NOT generate 3 and leave 7 missing.",
  "- package.json MUST include ALL dependencies on the FIRST pass — missing deps cause npm install failures that waste fixup iterations.",
  "- For create_file: include the ENTIRE file content even if it is long (200+ lines is fine).",
  "- For update_file: include the FULL new file, not a partial patch.",
  "- When generating a full project: ALWAYS include config files (tsconfig.json, vite.config.ts, postcss.config.js, tailwind.config.js) — missing configs cause build failures.",
  "- ALWAYS end with npm install + dev server start for new projects.",
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
    maxOutputTokens: 4_000,
  }),
  system: ARCHITECTURE_SYSTEM_PROMPT,
});

const codeQualityAgent = createAgent({
  name: "code_quality",
  description: "Reviews code for bugs, edge cases, and missing tests.",
  model: createGeminiModel(SPECIALIST_MODEL, {
    temperature: 0.15,
    maxOutputTokens: 4_000,
  }),
  system: CODE_QUALITY_SYSTEM_PROMPT,
});

const implementationAgent = createAgent({
  name: "implementation",
  description: "Turns requests into concrete implementation guidance.",
  model: createGeminiModel(SPECIALIST_MODEL, {
    temperature: 0.25,
    maxOutputTokens: 32_000,
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
    maxOutputTokens: 12_000,
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
  reasoningEffort?: "low" | "medium" | "high";
}) => {
  let primaryError: unknown;
  const targetModel = args.model.trim();
  const skipPrimary =
    FORCE_CHAINED_MODEL_FALLBACK ||
    !ENABLE_AGENT_PRIMARY_CALL ||
    isGeminiModelCoolingDown(targetModel);

  if (skipPrimary) {
    if (FORCE_CHAINED_MODEL_FALLBACK) {
      primaryError = new Error(
        `Primary agent call bypassed for ${targetModel}; using strict chained model fallback.`,
      );
    } else if (!ENABLE_AGENT_PRIMARY_CALL) {
      primaryError = new Error(
        `Primary agent call disabled for ${targetModel}; using chained Gemini fallback.`,
      );
    } else {
      const retryIn = getGeminiModelCooldownSeconds(targetModel);
      primaryError = new Error(
        `Primary agent call skipped for ${targetModel} due to cooldown (${retryIn}s remaining).`,
      );
    }
  } else {
    try {
      const primaryResult = await args.agent.run(args.prompt);
      const primaryText = textFromAgentResult(primaryResult).trim();
      if (primaryText) {
        return primaryText;
      }

      primaryError = new Error("Primary agent returned empty content.");
    } catch (error) {
      const rateLimitMetadata = getGeminiRateLimitMetadata(error);
      if (rateLimitMetadata) {
        markGeminiModelRateLimited(
          targetModel,
          rateLimitMetadata.retryAfterSeconds,
        );
      }

      primaryError = error;
    }
  }

  try {
    const fallback = await generateGeminiCompletion({
      model: targetModel,
      system: args.systemPrompt,
      messages: [
        {
          role: "user",
          content: args.prompt,
        },
      ],
      ...(args.reasoningEffort
        ? { reasoningEffort: args.reasoningEffort }
        : {}),
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

/**
 * Attempt to repair common LLM JSON mistakes so JSON.parse succeeds.
 * Handles: trailing commas, missing closing braces/brackets, control chars.
 */
const repairJson = (value: string): string => {
  let repaired = value
    // Remove control characters that break JSON
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    // Remove trailing commas before closing braces/brackets
    .replace(/,\s*([\]}])/g, "$1")
    // Remove JavaScript-style comments
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  // Count unbalanced braces/brackets and add missing closers
  let braces = 0;
  let brackets = 0;
  let inString = false;
  let escape = false;

  for (const char of repaired) {
    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{") braces++;
    else if (char === "}") braces--;
    else if (char === "[") brackets++;
    else if (char === "]") brackets--;
  }

  // Close any unclosed strings
  if (inString) {
    repaired += '"';
  }

  // Add missing closing brackets/braces
  while (brackets > 0) {
    repaired += "]";
    brackets--;
  }
  while (braces > 0) {
    repaired += "}";
    braces--;
  }

  // Final trailing comma cleanup after repair
  repaired = repaired.replace(/,\s*([\]}])/g, "$1");

  return repaired;
};

/**
 * Try JSON.parse, falling back to repairJson + JSON.parse on failure.
 */
const safeJsonParse = (value: string): unknown | null => {
  try {
    return JSON.parse(value);
  } catch {
    try {
      const repaired = repairJson(value);
      const parsed = JSON.parse(repaired);
      console.info("conversation.planner.json-repaired", {
        originalLength: value.length,
        repairedLength: repaired.length,
      });
      return parsed;
    } catch {
      return null;
    }
  }
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

const DEV_SERVER_KEY = "dev-server";
const DEV_SERVER_KEY_PATTERN = /^dev[-_.]?server(?:[-_.].*)?$/i;

const normalizeCommandArgsForDetection = (commandArgs?: string[]) =>
  commandArgs?.map((arg) => arg.trim().toLowerCase()).filter(Boolean) ?? [];

const isLikelyDevServerCommandSpec = (args: {
  command: string;
  commandArgs?: string[];
}) => {
  const command = args.command.trim().toLowerCase();
  const commandArgs = normalizeCommandArgsForDetection(args.commandArgs);

  if (command === "npm") {
    return (
      (commandArgs[0] === "run" && commandArgs[1] === "dev") ||
      commandArgs[0] === "dev"
    );
  }

  if (command === "pnpm" || command === "bun") {
    return (
      (commandArgs[0] === "run" && commandArgs[1] === "dev") ||
      commandArgs[0] === "dev"
    );
  }

  if (command === "yarn") {
    return (
      commandArgs[0] === "dev" ||
      (commandArgs[0] === "run" && commandArgs[1] === "dev")
    );
  }

  if (command === "npx") {
    return (
      (commandArgs[0] === "next" && commandArgs[1] === "dev") ||
      (commandArgs[0] === "vite" && commandArgs[1] === "dev")
    );
  }

  if (command === "next" || command === "vite") {
    return commandArgs[0] === "dev";
  }

  return false;
};

const canonicalizeBackgroundCommandKey = (args: {
  key: string;
  command: string;
  commandArgs?: string[];
}) => {
  if (DEV_SERVER_KEY_PATTERN.test(args.key)) {
    return DEV_SERVER_KEY;
  }

  if (
    isLikelyDevServerCommandSpec({
      command: args.command,
      commandArgs: args.commandArgs,
    })
  ) {
    return DEV_SERVER_KEY;
  }

  return args.key;
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

      // Skip duplicate create_folder for folders already known or planned
      if (existingFolders.has(folderPath) || plannedFolders.has(folderPath)) {
        continue;
      }

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

const hasPackageJsonAvailable = (
  operations: ConversationFileOperation[],
  projectFiles: ConversationProjectFile[] = [],
) =>
  hasPackageJsonMutation(operations) ||
  projectFiles.some(
    (file) =>
      file.type === "file" &&
      (file.path === "package.json" || file.path.endsWith("/package.json")),
  );

const hasFilesystemMutation = (operations: ConversationFileOperation[]) =>
  operations.some(
    (operation) =>
      operation.type !== "run_command" &&
      operation.type !== "start_background_command",
  );

const isInstallLikeCommand = (operation: ConversationFileOperation) => {
  if (operation.type !== "run_command") {
    return false;
  }

  const command = operation.command.trim().toLowerCase();
  const args =
    operation.commandArgs
      ?.map((arg) => arg.trim().toLowerCase())
      .filter(Boolean) ?? [];

  if (command === "yarn") {
    if (args.length === 0) {
      return true;
    }

    const firstArg = args[0];
    return firstArg === "install";
  }

  if (command === "npm" || command === "pnpm" || command === "bun") {
    const firstArg = args[0];
    return firstArg === "install" || firstArg === "i" || firstArg === "ci";
  }

  return false;
};

const isPlainDependencyInstallCommand = (
  operation: ConversationFileOperation,
) => {
  if (!isInstallLikeCommand(operation) || operation.type !== "run_command") {
    return false;
  }

  const command = operation.command.trim().toLowerCase();
  const args =
    operation.commandArgs
      ?.map((arg) => arg.trim().toLowerCase())
      .filter(Boolean) ?? [];

  if (command === "yarn") {
    if (args.length === 0) {
      return true;
    }

    return args.slice(1).every((arg) => arg.startsWith("-"));
  }

  if (args.length === 0) {
    return false;
  }

  return args.slice(1).every((arg) => arg.startsWith("-"));
};

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

const shouldNormalizeNpmInstallOperation = (
  operation: ConversationFileOperation,
) => {
  if (operation.type !== "run_command") {
    return false;
  }

  const command = operation.command.trim().toLowerCase();
  if (command !== "npm") {
    return false;
  }

  const args = operation.commandArgs ?? [];
  if (args.length === 0) {
    return true;
  }

  const firstArg = args[0]?.trim().toLowerCase();
  return firstArg === "install" || firstArg === "i" || firstArg === "ci";
};

const normalizeInstallOperationForExecution = (
  operation: ConversationFileOperation,
) => {
  if (!shouldNormalizeNpmInstallOperation(operation)) {
    return operation;
  }

  return {
    ...operation,
    commandArgs: normalizeNpmInstallArgs(operation.commandArgs ?? []),
  } satisfies ConversationFileOperation;
};

const normalizeInstallOperationsForExecution = (
  operations: ConversationFileOperation[],
) =>
  operations.map((operation) =>
    normalizeInstallOperationForExecution(operation),
  );

const buildDefaultInstallOperation = (
  operations: ConversationFileOperation[],
  projectFiles: ConversationProjectFile[] = [],
): ConversationFileOperation => {
  const command = detectPackageManagerForInstall(operations, projectFiles);

  if (command === "npm") {
    return {
      type: "run_command",
      command,
      commandArgs: ["install", ...NPM_STABLE_INSTALL_FLAGS],
    };
  }

  return {
    type: "run_command",
    command,
    commandArgs: ["install"],
  };
};

const isManagedDevServerStartOperation = (
  operation: ConversationFileOperation,
) =>
  operation.type === "start_background_command" &&
  operation.key === DEV_SERVER_KEY;

const moveManagedDevServerStartToEnd = (
  operations: ConversationFileOperation[],
) => {
  const managedStarts = operations.filter((operation) =>
    isManagedDevServerStartOperation(operation),
  );

  if (managedStarts.length === 0) {
    return operations;
  }

  const withoutManagedStarts = operations.filter(
    (operation) => !isManagedDevServerStartOperation(operation),
  );

  const lastManagedStart = managedStarts[managedStarts.length - 1]!;

  // Gate the dev-server start on the previous operation (npm install) succeeding.
  const gatedDevServerStart: ConversationFileOperation =
    ENABLE_INSTALL_GATE && lastManagedStart.type === "start_background_command"
      ? { ...lastManagedStart, gatedOnPreviousSuccess: true }
      : lastManagedStart;

  return [...withoutManagedStarts, gatedDevServerStart];
};

const hasDependencyInstallCommand = (operations: ConversationFileOperation[]) =>
  operations.some((operation) => isPlainDependencyInstallCommand(operation));

const isBuildValidationCommand = (operation: ConversationFileOperation) => {
  if (operation.type !== "run_command") {
    return false;
  }

  const command = operation.command.trim().toLowerCase();
  const args =
    operation.commandArgs
      ?.map((arg) => arg.trim().toLowerCase())
      .filter(Boolean) ?? [];

  if (command === ORBIT_VALIDATE_COMMAND) {
    return true;
  }

  if (command === "npm" || command === "pnpm" || command === "bun") {
    return args[0] === "run" && args[1] === "build";
  }

  if (command === "yarn") {
    return args[0] === "build" || (args[0] === "run" && args[1] === "build");
  }

  return command === "vite" || command === "tsc";
};

const buildAutonomousValidationOperation = (): ConversationFileOperation => ({
  type: "run_command",
  command: ORBIT_VALIDATE_COMMAND,
  gatedOnPreviousSuccess: true,
});

const ensureAutonomousValidationOperation = (
  operations: ConversationFileOperation[],
  projectFiles: ConversationProjectFile[] = [],
) => {
  if (
    !ENABLE_AUTONOMOUS_VALIDATION ||
    !hasFilesystemMutation(operations) ||
    !hasPackageJsonAvailable(operations, projectFiles) ||
    operations.some((operation) => isBuildValidationCommand(operation))
  ) {
    return operations;
  }

  const validationOperation = buildAutonomousValidationOperation();
  const insertionIndex = (() => {
    const devServerIndex = operations.findIndex((operation) =>
      isManagedDevServerStartOperation(operation),
    );

    if (devServerIndex >= 0) {
      return devServerIndex;
    }

    return operations.length;
  })();

  const withValidation = [...operations];
  withValidation.splice(insertionIndex, 0, validationOperation);
  return withValidation;
};

const ensureDependencyInstallOperation = (
  operations: ConversationFileOperation[],
  projectFiles: ConversationProjectFile[] = [],
) => {
  const plainInstallCommands = operations.filter((operation) =>
    isPlainDependencyInstallCommand(operation),
  );

  const withoutPlainInstallCommands = operations.filter(
    (operation) => !isPlainDependencyInstallCommand(operation),
  );

  const shouldInsertInstall =
    plainInstallCommands.length > 0 || hasPackageJsonMutation(operations);

  if (!shouldInsertInstall) {
    return moveManagedDevServerStartToEnd(withoutPlainInstallCommands);
  }

  const selectedInstallCommand = hasDependencyInstallCommand(operations)
    ? plainInstallCommands[plainInstallCommands.length - 1]!
    : buildDefaultInstallOperation(operations, projectFiles);

  const shouldGateInstall =
    ENABLE_INSTALL_GATE && hasPackageJsonMutation(operations);

  const installCommandToInsert: ConversationFileOperation =
    shouldGateInstall && selectedInstallCommand.type === "run_command"
      ? {
          ...selectedInstallCommand,
          gatedOnPreviousSuccess:
            selectedInstallCommand.gatedOnPreviousSuccess ?? true,
        }
      : selectedInstallCommand;

  const insertionIndex = (() => {
    for (
      let index = withoutPlainInstallCommands.length - 1;
      index >= 0;
      index -= 1
    ) {
      const operation = withoutPlainInstallCommands[index]!;
      if (
        (operation.type === "create_file" ||
          operation.type === "update_file") &&
        operation.path === "package.json"
      ) {
        return index + 1;
      }
    }

    return withoutPlainInstallCommands.length;
  })();

  const withInstall = [...withoutPlainInstallCommands];
  withInstall.splice(insertionIndex, 0, installCommandToInsert);

  return moveManagedDevServerStartToEnd(withInstall);
};

const normalizeDevServerOperations = (
  operations: ConversationFileOperation[],
) => {
  return operations.map((operation) => {
    if (operation.type === "start_background_command") {
      return {
        ...operation,
        key: canonicalizeBackgroundCommandKey({
          key: operation.key,
          command: operation.command,
          commandArgs: operation.commandArgs,
        }),
      };
    }

    if (
      operation.type === "run_command" &&
      isLikelyDevServerCommandSpec({
        command: operation.command,
        commandArgs: operation.commandArgs,
      })
    ) {
      return {
        type: "start_background_command",
        key: DEV_SERVER_KEY,
        command: operation.command,
        commandArgs: operation.commandArgs,
        gatedOnPreviousSuccess: operation.gatedOnPreviousSuccess ?? true,
      } satisfies ConversationFileOperation;
    }

    return operation;
  });
};

const normalizePlannerOperationsForExecution = (args: {
  operations: ConversationFileOperation[];
  projectFiles?: ConversationProjectFile[];
  maxOperations?: number;
}) => {
  const projectFiles = args.projectFiles ?? [];
  const maxOperations = args.maxOperations ?? MAX_FILE_OPERATIONS_PER_RUN;

  const operationsWithInstall = ensureDependencyInstallOperation(
    normalizeDevServerOperations(
      validatePackageJsonDependencies(
        ensureFolderOperationsForWrites(args.operations, projectFiles),
      ),
    ),
    projectFiles,
  );

  return ensureAutonomousValidationOperation(
    normalizeInstallOperationsForExecution(operationsWithInstall),
    projectFiles,
  ).slice(0, maxOperations);
};

const COMMON_IMPORT_PATTERN =
  /(?:^|\n)\s*import\s+(?:[^;]*?)\s+from\s+["']([^"'./][^"']*)["']/g;
const COMMON_REQUIRE_PATTERN = /\brequire\s*\(\s*["']([^"'./][^"']*)["']\s*\)/g;

const extractImportedPackageNames = (sourceCode: string): Set<string> => {
  const packages = new Set<string>();

  const addFromPattern = (pattern: RegExp, code: string) => {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(code)) !== null) {
      const packageSpec = match[1]?.trim();
      if (!packageSpec) continue;
      // Handle scoped packages (@scope/name) and bare specifiers (name/path)
      const packageName = packageSpec.startsWith("@")
        ? packageSpec.split("/").slice(0, 2).join("/")
        : packageSpec.split("/")[0]!;
      if (packageName) packages.add(packageName);
    }
  };

  addFromPattern(COMMON_IMPORT_PATTERN, sourceCode);
  addFromPattern(COMMON_REQUIRE_PATTERN, sourceCode);

  return packages;
};

const NODE_BUILTIN_MODULES = new Set([
  "assert",
  "buffer",
  "child_process",
  "cluster",
  "crypto",
  "dgram",
  "dns",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "querystring",
  "readline",
  "stream",
  "string_decoder",
  "timers",
  "tls",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "worker_threads",
  "zlib",
  "node:assert",
  "node:buffer",
  "node:child_process",
  "node:cluster",
  "node:crypto",
  "node:dgram",
  "node:dns",
  "node:events",
  "node:fs",
  "node:http",
  "node:http2",
  "node:https",
  "node:net",
  "node:os",
  "node:path",
  "node:perf_hooks",
  "node:process",
  "node:querystring",
  "node:readline",
  "node:stream",
  "node:string_decoder",
  "node:timers",
  "node:tls",
  "node:tty",
  "node:url",
  "node:util",
  "node:v8",
  "node:vm",
  "node:worker_threads",
  "node:zlib",
  "node:test",
]);

const FRAMEWORK_IMPLICIT_PACKAGES = new Set([
  "react",
  "react-dom",
  "next",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
]);

const validatePackageJsonDependencies = (
  operations: ConversationFileOperation[],
): ConversationFileOperation[] => {
  if (!ENABLE_DEP_PREVALIDATION) return operations;

  // Find the package.json operation
  const packageJsonOpIndex = operations.findIndex(
    (op) =>
      (op.type === "create_file" || op.type === "update_file") &&
      op.path === "package.json",
  );

  if (packageJsonOpIndex === -1) return operations;

  const packageJsonOp = operations[packageJsonOpIndex]!;
  if (
    packageJsonOp.type !== "create_file" &&
    packageJsonOp.type !== "update_file"
  ) {
    return operations;
  }

  // Parse existing package.json content
  let packageJson: Record<string, unknown>;
  try {
    packageJson = JSON.parse(packageJsonOp.content) as Record<string, unknown>;
  } catch {
    return operations; // Can't parse, skip validation
  }

  const existingDeps = new Set<string>();
  const addDepsFrom = (obj: unknown) => {
    if (typeof obj === "object" && obj !== null) {
      for (const key of Object.keys(obj as Record<string, unknown>)) {
        existingDeps.add(key);
      }
    }
  };
  addDepsFrom(packageJson.dependencies);
  addDepsFrom(packageJson.devDependencies);
  addDepsFrom(packageJson.peerDependencies);

  // Collect all imported packages from source files in this batch
  const allImportedPackages = new Set<string>();
  for (const op of operations) {
    if (
      (op.type === "create_file" || op.type === "update_file") &&
      op.path !== "package.json" &&
      /\.(tsx?|jsx?|mjs|cjs)$/.test(op.path)
    ) {
      for (const pkg of extractImportedPackageNames(op.content)) {
        allImportedPackages.add(pkg);
      }
    }
  }

  // Find missing packages
  const missingPackages: string[] = [];
  for (const pkg of allImportedPackages) {
    if (existingDeps.has(pkg)) continue;
    if (NODE_BUILTIN_MODULES.has(pkg)) continue;
    if (FRAMEWORK_IMPLICIT_PACKAGES.has(pkg)) continue;
    // Skip path aliases and relative imports that slipped through
    if (pkg.startsWith("@/") || pkg.startsWith("~/") || pkg.startsWith("."))
      continue;
    missingPackages.push(pkg);
  }

  // Detect framework-essential dev dependencies that are ALWAYS needed
  // but the AI frequently forgets to include
  const frameworkEssentialPackages: Array<{ name: string; version: string }> =
    [];

  const hasVite = existingDeps.has("vite") || allImportedPackages.has("vite");
  const hasReactFiles = operations.some(
    (op) =>
      (op.type === "create_file" || op.type === "update_file") &&
      /\.(tsx|jsx)$/.test(op.path),
  );
  const hasTsSourceFiles = operations.some(
    (op) =>
      (op.type === "create_file" || op.type === "update_file") &&
      /\.tsx?$/.test(op.path) &&
      !/\.d\.ts$/.test(op.path),
  );
  const hasViteConfig = operations.some(
    (op) =>
      (op.type === "create_file" || op.type === "update_file") &&
      /^vite\.config\.(ts|js|mjs)$/.test(op.path),
  );
  const hasEsmJsConfig = operations.some(
    (op) =>
      (op.type === "create_file" || op.type === "update_file") &&
      /(?:postcss|tailwind|vite)\.config\.js$/.test(op.path) &&
      /\bexport\s+default\b/.test(op.content),
  );
  const hasTailwindConfig = operations.some(
    (op) =>
      (op.type === "create_file" || op.type === "update_file") &&
      /^tailwind\.config\.(ts|js|mjs|cjs)$/.test(op.path),
  );
  const hasPostcssTailwindPlugin = operations.some(
    (op) =>
      (op.type === "create_file" || op.type === "update_file") &&
      /^postcss\.config\.(js|mjs|cjs)$/.test(op.path) &&
      /\btailwindcss\b/.test(op.content),
  );

  // Vite + React → always needs @vitejs/plugin-react
  if (
    (hasVite || hasViteConfig) &&
    hasReactFiles &&
    !existingDeps.has("@vitejs/plugin-react") &&
    !existingDeps.has("@vitejs/plugin-react-swc")
  ) {
    frameworkEssentialPackages.push({
      name: "@vitejs/plugin-react",
      version: "^4",
    });
  }

  // Tailwind CSS → always needs postcss and autoprefixer
  if (existingDeps.has("tailwindcss")) {
    if (!existingDeps.has("postcss")) {
      frameworkEssentialPackages.push({ name: "postcss", version: "^8" });
    }
    if (!existingDeps.has("autoprefixer")) {
      frameworkEssentialPackages.push({ name: "autoprefixer", version: "^10" });
    }
  }

  // Vite + TypeScript → needs typescript
  if (
    (hasVite || hasViteConfig) &&
    hasTsSourceFiles &&
    !existingDeps.has("typescript")
  ) {
    frameworkEssentialPackages.push({ name: "typescript", version: "^5" });
  }

  // React projects → need @types/react and @types/react-dom
  if (
    hasReactFiles &&
    (existingDeps.has("react") || allImportedPackages.has("react"))
  ) {
    if (!existingDeps.has("@types/react")) {
      frameworkEssentialPackages.push({ name: "@types/react", version: "^19" });
    }
    if (!existingDeps.has("@types/react-dom")) {
      frameworkEssentialPackages.push({
        name: "@types/react-dom",
        version: "^19",
      });
    }
  }

  const hasFrameworkEssentialGaps = frameworkEssentialPackages.length > 0;

  if (missingPackages.length > 0 || hasFrameworkEssentialGaps) {
    console.info("conversation.planner.dep-prevalidation.fixing", {
      missingPackages,
      frameworkEssentials:
        frameworkEssentialPackages.length > 0
          ? frameworkEssentialPackages
          : undefined,
      existingDepCount: existingDeps.size,
    });
  }

  // Add missing packages to dependencies with "latest" version
  const deps =
    typeof packageJson.dependencies === "object" &&
    packageJson.dependencies !== null
      ? { ...(packageJson.dependencies as Record<string, string>) }
      : {};
  const devDeps =
    typeof packageJson.devDependencies === "object" &&
    packageJson.devDependencies !== null
      ? { ...(packageJson.devDependencies as Record<string, string>) }
      : {};

  for (const pkg of missingPackages) {
    deps[pkg] = "latest";
  }

  // Add framework essential packages to devDependencies
  for (const { name, version } of frameworkEssentialPackages) {
    if (!existingDeps.has(name)) {
      devDeps[name] = version;
    }
  }

  const scripts =
    typeof packageJson.scripts === "object" && packageJson.scripts !== null
      ? { ...(packageJson.scripts as Record<string, string>) }
      : {};

  if (hasVite || hasViteConfig) {
    scripts.dev = scripts.dev || "vite";
    scripts.build =
      scripts.build ||
      (hasTsSourceFiles ? "tsc -b && vite build" : "vite build");
    scripts.preview = scripts.preview || "vite preview";
    packageJson.scripts = scripts;
  }

  if (hasEsmJsConfig && packageJson.type !== "module") {
    packageJson.type = "module";
  }

  const tailwindVersion = deps.tailwindcss ?? devDeps.tailwindcss ?? "";
  const usesClassicTailwindPostcss =
    (hasTailwindConfig || hasPostcssTailwindPlugin) &&
    (hasPostcssTailwindPlugin || existingDeps.has("tailwindcss"));

  if (
    usesClassicTailwindPostcss &&
    tailwindVersion &&
    (/^latest$/i.test(tailwindVersion) ||
      /^(\^|~)?4(?:\.|$)/.test(tailwindVersion))
  ) {
    delete deps.tailwindcss;
    devDeps.tailwindcss = "^3.4.17";
  }

  packageJson.dependencies = deps;
  if (Object.keys(devDeps).length > 0) {
    packageJson.devDependencies = devDeps;
  }

  const updatedContent = `${JSON.stringify(packageJson, null, 2)}\n`;
  if (updatedContent === packageJsonOp.content) {
    return operations;
  }

  const updatedOp: ConversationFileOperation = {
    ...packageJsonOp,
    content: updatedContent,
  };

  const result = [...operations];
  result[packageJsonOpIndex] = updatedOp;
  return result;
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

    const gatedOnPreviousSuccess = parseOptionalBoolean(
      record.gatedOnPreviousSuccess,
    );

    return {
      type: "run_command",
      ...commandSpec,
      ...(gatedOnPreviousSuccess === undefined
        ? {}
        : { gatedOnPreviousSuccess }),
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

    const gatedOnPreviousSuccess = parseOptionalBoolean(
      record.gatedOnPreviousSuccess,
    );

    return {
      type: "start_background_command",
      key: canonicalizeBackgroundCommandKey({
        key,
        command: commandSpec.command,
        commandArgs: commandSpec.commandArgs,
      }),
      ...commandSpec,
      ...(gatedOnPreviousSuccess === undefined
        ? {}
        : { gatedOnPreviousSuccess }),
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

const buildNormalizedProjectPathSet = (
  projectFiles: ConversationProjectFile[] = [],
) => {
  const normalizedPaths = new Set<string>();

  for (const file of projectFiles) {
    const normalizedPath = normalizeOperationPath(file.path);
    if (!normalizedPath) {
      continue;
    }

    normalizedPaths.add(normalizedPath);
  }

  return normalizedPaths;
};

const isLikelyEmptyProjectForScaffold = (
  projectFiles: ConversationProjectFile[] = [],
) => {
  if (projectFiles.length === 0) {
    return true;
  }

  const normalizedPaths = buildNormalizedProjectPathSet(projectFiles);
  const hasPackageJson = normalizedPaths.has("package.json");
  const hasNextConfig = Array.from(normalizedPaths).some((path) =>
    /^next\.config\./i.test(path),
  );
  const hasAppRouterStructure = Array.from(normalizedPaths).some(
    (path) => path.startsWith("src/app/") || path.startsWith("app/"),
  );

  return !hasPackageJson && !hasNextConfig && !hasAppRouterStructure;
};

const isViteScaffoldRequest = (input: ConversationOrchestrationInput) => {
  const message = input.message.trim();
  return VITE_SCAFFOLD_INTENT_PATTERN.test(message);
};

const isViteBasicStarterRequest = (input: ConversationOrchestrationInput) => {
  const message = input.message.trim();

  if (!isViteScaffoldRequest(input)) {
    return false;
  }

  if (END_TO_END_BUILD_INTENT_PATTERN.test(message)) {
    return false;
  }

  if (COMPLEX_FEATURE_SCOPE_PATTERN.test(message)) {
    return false;
  }

  return VITE_BASIC_STARTER_INTENT_PATTERN.test(message);
};

const buildViteStarterPackageJson = () =>
  `${JSON.stringify(
    {
      name: "vite-react-app",
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        dev: "vite",
        build: "tsc -b && vite build",
        preview: "vite preview",
      },
      dependencies: {
        react: "^19.1.0",
        "react-dom": "^19.1.0",
      },
      devDependencies: {
        "@types/react": "^19",
        "@types/react-dom": "^19",
        "@vitejs/plugin-react": "^4",
        autoprefixer: "^10",
        postcss: "^8",
        tailwindcss: "^3",
        typescript: "^5",
        vite: "^6",
      },
    },
    null,
    2,
  )}\n`;

const upsertPlannerFileOperation = (args: {
  path: string;
  content: string;
  existingPaths: Set<string>;
}): ConversationFileOperation => {
  if (args.existingPaths.has(args.path)) {
    return {
      type: "update_file",
      path: args.path,
      content: args.content,
      createIfMissing: true,
    };
  }

  return {
    type: "create_file",
    path: args.path,
    content: args.content,
    overwrite: true,
  };
};

const buildDeterministicViteScaffoldOperations = (
  projectFiles: ConversationProjectFile[] = [],
) => {
  const existingPaths = buildNormalizedProjectPathSet(projectFiles);
  const operations: ConversationFileOperation[] = [];

  for (const folderPath of ["src", "public"]) {
    if (!existingPaths.has(folderPath)) {
      operations.push({ type: "create_folder", path: folderPath });
    }
  }

  operations.push(
    upsertPlannerFileOperation({
      path: "package.json",
      content: buildViteStarterPackageJson(),
      existingPaths,
    }),
    upsertPlannerFileOperation({
      path: "vite.config.ts",
      content: [
        'import { defineConfig } from "vite";',
        'import react from "@vitejs/plugin-react";',
        "",
        "export default defineConfig({",
        "  plugins: [react()],",
        "});",
        "",
      ].join("\n"),
      existingPaths,
    }),
    upsertPlannerFileOperation({
      path: "tsconfig.json",
      content: `${JSON.stringify(
        {
          compilerOptions: {
            target: "ES2020",
            useDefineForClassFields: true,
            lib: ["ES2020", "DOM", "DOM.Iterable"],
            module: "ESNext",
            skipLibCheck: true,
            moduleResolution: "bundler",
            allowImportingTsExtensions: true,
            isolatedModules: true,
            moduleDetection: "force",
            noEmit: true,
            jsx: "react-jsx",
            strict: true,
          },
          include: ["src"],
        },
        null,
        2,
      )}\n`,
      existingPaths,
    }),
    upsertPlannerFileOperation({
      path: "tsconfig.node.json",
      content: `${JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            lib: ["ES2023"],
            module: "ESNext",
            skipLibCheck: true,
            moduleResolution: "bundler",
            allowImportingTsExtensions: true,
            isolatedModules: true,
            moduleDetection: "force",
            noEmit: true,
            strict: true,
          },
          include: ["vite.config.ts"],
        },
        null,
        2,
      )}\n`,
      existingPaths,
    }),
    upsertPlannerFileOperation({
      path: "postcss.config.js",
      content:
        "export default {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n};\n",
      existingPaths,
    }),
    upsertPlannerFileOperation({
      path: "tailwind.config.js",
      content:
        '/** @type {import(\'tailwindcss\').Config} */\nexport default {\n  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],\n  theme: {\n    extend: {},\n  },\n  plugins: [],\n};\n',
      existingPaths,
    }),
    upsertPlannerFileOperation({
      path: "index.html",
      content:
        '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>Orbit App</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n',
      existingPaths,
    }),
    upsertPlannerFileOperation({
      path: "src/index.css",
      content: "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n",
      existingPaths,
    }),
    upsertPlannerFileOperation({
      path: "src/main.tsx",
      content:
        'import React from "react";\nimport ReactDOM from "react-dom/client";\nimport App from "./App";\nimport "./index.css";\n\nReactDOM.createRoot(document.getElementById("root")!).render(\n  <React.StrictMode>\n    <App />\n  </React.StrictMode>,\n);\n',
      existingPaths,
    }),
    upsertPlannerFileOperation({
      path: "src/App.tsx",
      content:
        'export default function App() {\n  return (\n    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">\n      <div className="text-center space-y-4">\n        <h1 className="text-4xl font-bold text-slate-900">Vite + React</h1>\n        <p className="text-slate-600">\n          Your project is ready. Edit <code className="bg-slate-200 px-2 py-1 rounded text-sm">src/App.tsx</code> to get started.\n        </p>\n      </div>\n    </div>\n  );\n}\n',
      existingPaths,
    }),
  );

  operations.push({
    type: "run_command",
    command: "npm",
    commandArgs: ["install", ...NPM_STABLE_INSTALL_FLAGS],
  });
  operations.push({
    type: "start_background_command",
    key: "dev-server",
    command: "npm",
    commandArgs: ["run", "dev"],
  });

  return operations;
};

const collectPlannedPathSet = (
  operations: ConversationFileOperation[],
  projectFiles: ConversationProjectFile[] = [],
) => {
  const paths = buildNormalizedProjectPathSet(projectFiles);

  for (const operation of operations) {
    if (operation.type === "create_file" || operation.type === "update_file") {
      paths.add(operation.path);
      continue;
    }

    if (operation.type === "rename_path") {
      paths.delete(operation.path);
      paths.add(operation.newPath);
    }
  }

  return paths;
};

const validateViteScaffoldPlan = (args: {
  input: ConversationOrchestrationInput;
  operations: ConversationFileOperation[];
}) => {
  if (!isViteScaffoldRequest(args.input)) {
    return [] as string[];
  }

  const plannedPaths = collectPlannedPathSet(
    args.operations,
    args.input.projectFiles,
  );

  const missingPaths = VITE_REQUIRED_SCAFFOLD_FILE_PATHS.filter(
    (path) => !plannedPaths.has(path),
  );

  if (missingPaths.length === 0) {
    return [] as string[];
  }

  return [
    `Vite scaffold is missing required files: ${missingPaths.join(", ")}.`,
  ];
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

const COMMAND_ONLY_REQUEST_PATTERN =
  /\b(run|execute|install|uninstall|upgrade|downgrade|command|commands|terminal|script|scripts|dependency|dependencies|package\.json|npm|pnpm|yarn|bun)\b/i;
const FILE_MUTATION_REQUEST_PATTERN =
  /\b(create|add|delete|remove|rename|move|update|edit|modify|write|rewrite|refactor|fix|implement|generate|scaffold|setup|build|component|page|route|endpoint|api|file|files|folder|folders|project|app|codebase)\b/i;

const isExplicitCommandOnlyRequest = (message: string) => {
  const hasCommandSignal = COMMAND_ONLY_REQUEST_PATTERN.test(message);
  const hasMutationSignal = FILE_MUTATION_REQUEST_PATTERN.test(message);
  const hasPathSignal = FILE_OPERATION_PATH_HINT_PATTERN.test(message);

  return hasCommandSignal && !hasMutationSignal && !hasPathSignal;
};

const isFilesystemMutationOperation = (operation: ConversationFileOperation) =>
  operation.type !== "run_command" &&
  operation.type !== "start_background_command";

const hasFilesystemMutationOperation = (
  operations: ConversationFileOperation[],
) => operations.some((operation) => isFilesystemMutationOperation(operation));

const shouldRequireFilesystemMutationOperations = (
  input: ConversationOrchestrationInput,
) => {
  const intent = inferConversationIntent(input.message);
  if (intent === "analysis") {
    return false;
  }

  return !isExplicitCommandOnlyRequest(input.message);
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
  "vite.config.ts",
  "vite.config.js",
  "tailwind.config.ts",
  "tailwind.config.js",
  "postcss.config.mjs",
  "postcss.config.js",
  // Main source files — critical for follow-up changes
  "index.html",
  "src/main.tsx",
  "src/App.tsx",
  "src/index.tsx",
  "src/index.css",
] as const;

const buildPlannerKeyFileContext = (files: ConversationProjectFile[] = []) => {
  const blocks: string[] = [];

  for (const pattern of PLANNER_KEY_FILE_PATTERNS) {
    const file = files.find(
      (f) =>
        f.type === "file" &&
        (f.path === pattern || f.path.endsWith(`/${pattern}`)),
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
  const includeFrontendStyleGuidance = FRONTEND_PLANNER_STYLE_HINT_PATTERN.test(
    input.message,
  );
  const hasPackageJson = input.projectFiles?.some(
    (f) => f.path === "package.json" || f.path.endsWith("/package.json"),
  );

  return [
    "TASK (will be executed immediately — your output creates real files and runs real commands):",
    input.message,
    "",
    input.history
      ? `CONVERSATION HISTORY:\n${input.history.slice(0, MAX_PLANNER_HISTORY_CHARS)}`
      : "",
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
    input.projectContext?.slice(0, MAX_PLANNER_PROJECT_CONTEXT_CHARS) ||
      "(empty project)",
    "",
    "REMINDERS:",
    "- Your output is EXECUTED, not displayed. Include COMPLETE file contents.",
    "- Unless the user explicitly asks for starter/minimal scaffold, do NOT stop at a basic frontend shell.",
    "- For feature requests, deliver a complete frontend implementation with polished UI, state management, and mock data.",
    '- After changing package.json: {"type":"run_command","command":"npm","commandArgs":["install","--legacy-peer-deps","--no-audit","--no-fund","--no-progress","--loglevel=error"]}',
    '- After file/dependency changes: {"type":"run_command","command":"npm","commandArgs":["run","build","--if-present"]}',
    '- To start dev server: {"type":"start_background_command","key":"dev-server","command":"npm","commandArgs":["run","dev"]}',
    "- For Vite scaffolds, include at minimum: package.json, vite.config.ts, tsconfig.json, index.html, src/main.tsx, src/App.tsx, src/index.css.",
    "- Create ALL files needed for the task. Do not leave gaps or TODOs.",
    ...(includeFrontendStyleGuidance
      ? [
          "",
          "CODE QUALITY — FRONTEND:",
          "- UI files must include polished, modern CSS. Avoid plain unstyled markup.",
          "- Include responsive states (loading/error/empty) and accessible controls.",
          "- Keep styling cohesive with clear color tokens and reusable classes.",
        ]
      : []),
    "",
    'Return ONLY valid JSON: {"operations":[...]}',
  ]
    .filter(Boolean)
    .join("\n");
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

const buildStrictFileOperationPlannerPrompt = (
  input: ConversationOrchestrationInput,
  previousOutput: string,
  issues: string[] = [],
) =>
  [
    buildFileOperationPlannerPrompt(input),
    "",
    "STRICT EXECUTION MODE:",
    "- You MUST return executable JSON operations only.",
    "- For code_generation/code_update intents, operations MUST NOT be empty.",
    "- Include create_folder operations for parent directories before create_file/update_file operations.",
    "- If package.json is changed, include run_command install right after it.",
    "- Do not return prose, markdown, or code-only response.",
    "",
    "Previous planner output:",
    previousOutput || "(empty)",
    "",
    issues.length > 0
      ? [
          "Validation issues to fix:",
          ...issues.map((issue) => `- ${issue}`),
          "",
        ].join("\n")
      : "",
    "Return ONLY valid JSON object with operations array and at least one operation.",
  ]
    .filter(Boolean)
    .join("\n");

const buildEmergencyFileOperationPlannerPrompt = (
  input: ConversationOrchestrationInput,
  previousOutput: string,
  issues: string[] = [],
) =>
  [
    "Return ONLY valid JSON object with this exact shape:",
    '{"operations":[{"type":"create_file|update_file|create_folder|delete_path|rename_path|run_command|start_background_command", "...": "..."}]}',
    "",
    "Rules:",
    "- operations MUST NOT be empty.",
    "- For create_file/update_file include FULL file content.",
    "- Use forward-slash relative paths only.",
    "- Do not include markdown fences or prose.",
    "",
    "Task:",
    input.message,
    "",
    input.history
      ? `Conversation history:\n${input.history.slice(0, MAX_PLANNER_HISTORY_CHARS)}`
      : "",
    "",
    "Project context:",
    input.projectContext?.slice(
      0,
      Math.min(4_500, MAX_PLANNER_PROJECT_CONTEXT_CHARS),
    ) || "(empty project)",
    "",
    "Previous planner output:",
    previousOutput || "(empty)",
    "",
    issues.length > 0
      ? ["Issues to fix:", ...issues.map((issue) => `- ${issue}`), ""].join(
          "\n",
        )
      : "",
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

  if (shouldRequireExecutableFileOperations(input)) {
    return true;
  }

  return false;
};

const shouldRequireExecutableFileOperations = (
  input: ConversationOrchestrationInput,
) => {
  const message = input.message;
  const intent = inferConversationIntent(message);
  const hasExecutionFrustrationSignal =
    EXECUTION_FRUSTRATION_PATTERN.test(message);

  if (hasExecutionFrustrationSignal) {
    return true;
  }

  if (!STRICT_FILE_OPS_GATE_ENABLED) {
    return false;
  }

  const hasExplicitExecutionDirective =
    STRICT_EXECUTION_ACTION_PATTERN.test(message) ||
    /\b(do(?:\s+the)?\s+(?:change|changes|work|implementation)|make(?:\s+the)?\s+changes|apply(?:\s+the)?\s+changes?)\b/i.test(
      message,
    );
  const hasProjectScopedDirective =
    PROJECT_SCOPED_EXECUTION_PATTERN.test(message);
  const hasFileOrCommandAction =
    COMMAND_OPERATION_INTENT_PATTERN.test(message) ||
    /\b(create|update|edit|modify|delete|rename|move|fix|implement|patch|install|uninstall|upgrade|downgrade|run|execute|scaffold|setup)\b/i.test(
      message,
    );
  const looksLikeQuestionOnly =
    /\b(how\s+do\s+i|how\s+to|what\s+is|why\s+is|can\s+you\s+explain|explain|describe|walk\s+me\s+through|show\s+me\s+how)\b/i.test(
      message,
    ) && !hasExplicitExecutionDirective;

  if (
    looksLikeQuestionOnly &&
    !hasProjectScopedDirective &&
    !hasExecutionFrustrationSignal
  ) {
    return false;
  }

  if (!hasFileOrCommandAction) {
    return false;
  }

  if (hasExplicitExecutionDirective) {
    return true;
  }

  if (
    REQUIRE_EXECUTABLE_FOR_CODE_INTENT &&
    intent !== "analysis" &&
    !looksLikeQuestionOnly
  ) {
    return true;
  }

  if (
    hasProjectScopedDirective &&
    (FILE_OPERATION_INTENT_PATTERN.test(message) ||
      FILE_OPERATION_PATH_HINT_PATTERN.test(message))
  ) {
    return true;
  }

  return false;
};

const shouldUseChunkedComplexBuildPlanning = (
  input: ConversationOrchestrationInput,
) => {
  if (!ENABLE_COMPLEX_BUILD_CHUNKING) {
    return false;
  }

  if (isFastExecutionRequest(input)) {
    return false;
  }

  const message = input.message;
  const intent = inferConversationIntent(message);
  if (intent === "analysis") {
    return false;
  }

  if (isViteBasicStarterRequest(input)) {
    return false;
  }

  if (END_TO_END_BUILD_INTENT_PATTERN.test(message)) {
    return true;
  }

  const hasTrigger = COMPLEX_BUILD_TRIGGER_PATTERN.test(message);
  const hasProjectScope = COMPLEX_BUILD_SCOPE_PATTERN.test(message);
  const hasComplexScope =
    COMPLEX_BUILD_STACK_PATTERN.test(message) ||
    COMPLEX_FEATURE_SCOPE_PATTERN.test(message);

  if (hasTrigger && hasProjectScope && hasComplexScope) {
    return true;
  }

  return false;
};

const buildComplexBuildChunkPlannerPrompt = (
  input: ConversationOrchestrationInput,
) => {
  const fileInventory = buildProjectFileInventory(input.projectFiles);

  return [
    "Break this implementation request into 2-4 executable build chunks.",
    "Return JSON only.",
    '{"chunks":[{"title":"short title","goal":"clear chunk goal"}]}',
    "",
    "Rules:",
    "- Keep chunks sequential and non-overlapping.",
    "- Chunk 1 should cover foundation/config/dependencies.",
    "- Middle chunks should implement core features in small vertical slices.",
    "- Final chunk should cover integration/polish/runtime command validation.",
    "- Keep each chunk small enough for one focused planner call.",
    "",
    "User request:",
    input.message,
    "",
    input.history
      ? `Conversation history:\n${input.history.slice(0, MAX_PLANNER_HISTORY_CHARS)}`
      : "",
    "",
    "Existing project files:",
    fileInventory,
    "",
    "Project context:",
    input.projectContext?.slice(0, MAX_PLANNER_PROJECT_CONTEXT_CHARS) ||
      "(empty project)",
  ]
    .filter(Boolean)
    .join("\n");
};

const parsePlannerChunks = (value: unknown): PlannerChunk[] => {
  const rootRecord = toRecord(value);
  const rawChunks =
    (Array.isArray(value)
      ? value
      : Array.isArray(rootRecord?.chunks)
        ? rootRecord.chunks
        : Array.isArray(rootRecord?.plan)
          ? rootRecord.plan
          : []) ?? [];

  const chunks: PlannerChunk[] = [];

  for (const rawChunk of rawChunks) {
    const record = toRecord(rawChunk);
    if (!record) {
      continue;
    }

    const goal = getStringField(record, [
      "goal",
      "task",
      "objective",
      "description",
      "scope",
    ]);

    if (!goal) {
      continue;
    }

    const title =
      getStringField(record, ["title", "name", "chunk", "step"]) ??
      `Chunk ${chunks.length + 1}`;

    chunks.push({
      title: title.slice(0, 120),
      goal: goal.slice(0, 700),
    });

    if (chunks.length >= MAX_COMPLEX_BUILD_CHUNKS) {
      break;
    }
  }

  return chunks;
};

const extractPlannerChunks = (output: string): PlannerChunk[] => {
  const plannerJson = extractJsonObject(output.trim());
  if (!plannerJson) {
    return [];
  }

  try {
    return parsePlannerChunks(safeJsonParse(plannerJson) as unknown);
  } catch {
    return [];
  }
};

const applyOperationsToProjectSnapshot = (
  projectFiles: ConversationProjectFile[] = [],
  operations: ConversationFileOperation[] = [],
) => {
  const entries = new Map<string, ConversationProjectFile>();

  const ensureFolder = (path: string) => {
    for (const ancestor of expandPathAncestors(path)) {
      if (!entries.has(ancestor)) {
        entries.set(ancestor, {
          path: ancestor,
          type: "folder",
        });
      }
    }
  };

  const upsertFile = (path: string, content: string) => {
    const parentPath = getParentPath(path);
    if (parentPath) {
      ensureFolder(parentPath);
    }

    entries.set(path, {
      path,
      type: "file",
      content,
    });
  };

  const deletePath = (path: string) => {
    const prefix = `${path}/`;
    for (const key of Array.from(entries.keys())) {
      if (key === path || key.startsWith(prefix)) {
        entries.delete(key);
      }
    }
  };

  const renamePath = (path: string, newPath: string) => {
    const entriesToMove = Array.from(entries.entries())
      .filter(([key]) => key === path || key.startsWith(`${path}/`))
      .sort((left, right) => left[0].length - right[0].length);

    const moved: Array<[string, ConversationProjectFile]> = [];

    for (const [oldKey, oldEntry] of entriesToMove) {
      const suffix = oldKey === path ? "" : oldKey.slice(path.length);
      const nextPath = `${newPath}${suffix}`;
      moved.push([
        nextPath,
        {
          ...oldEntry,
          path: nextPath,
        },
      ]);
      entries.delete(oldKey);
    }

    const parentPath = getParentPath(newPath);
    if (parentPath) {
      ensureFolder(parentPath);
    }

    for (const [nextPath, entry] of moved) {
      entries.set(nextPath, entry);
    }
  };

  for (const projectFile of projectFiles) {
    const normalizedPath = normalizeOperationPath(projectFile.path);
    if (!normalizedPath) {
      continue;
    }

    entries.set(normalizedPath, {
      path: normalizedPath,
      type: projectFile.type,
      content: projectFile.content,
    });
  }

  for (const operation of operations) {
    if (operation.type === "create_folder") {
      ensureFolder(operation.path);
      continue;
    }

    if (operation.type === "create_file" || operation.type === "update_file") {
      upsertFile(operation.path, operation.content);
      continue;
    }

    if (operation.type === "delete_path") {
      deletePath(operation.path);
      continue;
    }

    if (operation.type === "rename_path") {
      renamePath(operation.path, operation.newPath);
    }
  }

  return Array.from(entries.values()).sort((left, right) =>
    left.path.localeCompare(right.path),
  );
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

const isCommandOperation = (
  operation: ConversationFileOperation,
): operation is Extract<
  ConversationFileOperation,
  { type: "run_command" | "start_background_command" }
> =>
  operation.type === "run_command" ||
  operation.type === "start_background_command";

const commandOperationSignature = (operation: ConversationFileOperation) => {
  if (!isCommandOperation(operation)) {
    return "";
  }

  const args = operation.commandArgs?.join("\u0000") ?? "";
  return operation.type === "start_background_command"
    ? `${operation.type}\u0000${operation.key}\u0000${operation.command}\u0000${args}`
    : `${operation.type}\u0000${operation.command}\u0000${args}`;
};

const buildRecoveryCommandOperations = (args: {
  failures: ConversationFileOperationResult[];
  plannedOperations: ConversationFileOperation[];
}) => {
  const plannedCommandSignatures = new Set(
    args.plannedOperations
      .filter(isCommandOperation)
      .map((operation) => commandOperationSignature(operation)),
  );
  const recoveryOperations: ConversationFileOperation[] = [];
  const seenRecoverySignatures = new Set<string>();

  for (const failure of args.failures) {
    if (!isCommandOperation(failure.operation)) {
      continue;
    }

    const signature = commandOperationSignature(failure.operation);
    if (
      !signature ||
      plannedCommandSignatures.has(signature) ||
      seenRecoverySignatures.has(signature)
    ) {
      continue;
    }

    recoveryOperations.push({
      ...failure.operation,
      gatedOnPreviousSuccess: true,
    });
    seenRecoverySignatures.add(signature);
  }

  return recoveryOperations;
};

const runFileOpsPlannerDirect = async (
  prompt: string,
  label: string,
  args?: {
    preferredModel?: string;
    callBudget?: PlannerCallBudget;
    fastMode?: boolean;
    onPlanningProgress?: (status: string) => void;
  },
): Promise<string> => {
  const callBudget = args?.callBudget;
  if (callBudget) {
    if (callBudget.used >= callBudget.max) {
      console.info(`conversation.planner.${label}.skip`, {
        reason: "call-budget-exhausted",
        used: callBudget.used,
        max: callBudget.max,
      });

      return "";
    }

    callBudget.used += 1;
  }

  const targetModel = args?.preferredModel?.trim() || FILE_OPS_MODEL;

  console.info(`conversation.planner.${label}.call`, {
    promptLength: prompt.length,
    model: targetModel,
    plannerCallsUsed: callBudget?.used,
    plannerCallsMax: callBudget?.max,
    fastMode: args?.fastMode === true,
  });

  const result = await generateGeminiCompletion({
    model: targetModel,
    system: FILE_OPS_PLANNER_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    maxTokens: FILE_OPS_PLANNER_MAX_OUTPUT_TOKENS,
    temperature: 0.05,
    reasoningEffort: args?.fastMode ? "medium" : "high",
    responseMimeType: "application/json",
    onStreamChunk: (chunk, fullText) => {
      if (args?.onPlanningProgress) {
        // Find the last file path the LLM started generating
        const matches = [...fullText.matchAll(/"path"\s*:\s*"([^"]+)"/g)];
        if (matches.length > 0) {
          const lastPath = matches[matches.length - 1][1];
          args.onPlanningProgress(`✍️ Generating plan for \`${lastPath}\`...`);
        } else {
          args.onPlanningProgress(`🤔 Analyzing project requirements...`);
        }
      }
    },
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
): Promise<PlannedFileOperationBatch> => {
  const requiresExecutablePlan = shouldRequireExecutableFileOperations(input);
  const fastExecutionMode = shouldUseFastPlannerMode(input);
  const plannerCallBudgetMax = fastExecutionMode
    ? Math.min(2, inferCallBudget(input))
    : inferCallBudget(input);

  const plannerCallBudget: PlannerCallBudget = {
    used: 0,
    max: plannerCallBudgetMax,
  };

  const toPlanResult = (
    operations: ConversationFileOperation[],
    plannerOutput: string,
  ): PlannedFileOperationBatch => ({
    operations,
    plannerOutput,
    plannerCallCount: plannerCallBudget.used,
  });

  if (!input.executeFileOperation) {
    console.info("conversation.planner.skip", { reason: "no-execute-handler" });
    return toPlanResult([], "");
  }

  if (!shouldPlanFileOperations(input)) {
    console.info("conversation.planner.skip", {
      reason: "intent-skip",
      message: input.message.slice(0, 100),
    });
    return toPlanResult([], "intent-skip");
  }

  const shouldUseDeterministicViteFallback =
    isViteScaffoldRequest(input) &&
    isLikelyEmptyProjectForScaffold(input.projectFiles) &&
    isViteBasicStarterRequest(input);

  if (shouldUseDeterministicViteFallback) {
    const deterministicOperations = normalizePlannerOperationsForExecution({
      operations: buildDeterministicViteScaffoldOperations(input.projectFiles),
      projectFiles: input.projectFiles,
      maxOperations: MAX_FILE_OPERATIONS_PER_RUN,
    });

    return toPlanResult(deterministicOperations, "deterministic-vite-scaffold");
  }

  const runPlanner = async (args: {
    prompt: string;
    label: string;
    preferredModel?: string;
  }) =>
    runFileOpsPlannerDirect(args.prompt, args.label, {
      preferredModel: args.preferredModel,
      callBudget: plannerCallBudget,
      fastMode: fastExecutionMode,
      onPlanningProgress: input.onPlanningProgress,
    });

  const mergePlannerOutputs = (...parts: string[]) =>
    parts
      .map((part) => part.trim())
      .filter(Boolean)
      .join("\n\n");

  const extractOperations = (output: string): ConversationFileOperation[] => {
    // Strip markdown code fences that the model sometimes wraps JSON in.
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
      const parsed = safeJsonParse(plannerJson);
      if (parsed === null) {
        console.warn("conversation.planner.json-parse-failed", {
          jsonLength: plannerJson.length,
          jsonPreview: plannerJson.slice(0, 300),
          error: "safeJsonParse returned null",
        });
        return [];
      }
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
        error:
          parseError instanceof Error ? parseError.message : String(parseError),
      });
      return [];
    }
  };

  const normalizeOperations = (
    operations: ConversationFileOperation[],
    args?: {
      projectFiles?: ConversationProjectFile[];
      maxOperations?: number;
    },
  ) => {
    const projectFiles = args?.projectFiles ?? input.projectFiles;
    const maxOperations = args?.maxOperations ?? MAX_FILE_OPERATIONS_PER_RUN;

    return normalizePlannerOperationsForExecution({
      operations,
      projectFiles,
      maxOperations,
    });
  };

  const collectPlanIssues = (
    operations: ConversationFileOperation[],
    validationInput: ConversationOrchestrationInput = input,
  ) => {
    const issues = Array.from(
      new Set([
        ...validateFileOperationPlan(operations),
        ...validateViteScaffoldPlan({
          input: validationInput,
          operations,
        }),
      ]),
    );

    if (
      operations.length > 0 &&
      shouldRequireFilesystemMutationOperations(validationInput) &&
      !hasFilesystemMutationOperation(operations)
    ) {
      issues.push(
        "Plan must include at least one filesystem operation (create/update/delete/rename file or folder) for this request.",
      );
    }

    return Array.from(new Set(issues));
  };

  try {
    console.info("conversation.planner.start", {
      message: input.message.slice(0, 100),
      projectFileCount: input.projectFiles?.length ?? 0,
      plannerCallsMax: plannerCallBudget.max,
      fastExecutionMode,
      requiresExecutablePlan,
    });

    let chunkedPlannerOutput = "";

    if (shouldUseChunkedComplexBuildPlanning(input)) {
      console.info("conversation.planner.chunked.start", {
        message: input.message.slice(0, 100),
        plannerModels: PLANNER_MODEL_ROTATION,
      });

      const chunks = buildDeterministicChunks(input);

      console.info("conversation.planner.chunked.chunks", {
        chunkCount: chunks.length,
        chunkTitles: chunks.map((c) => c.title),
      });

      let workingProjectFiles = input.projectFiles ?? [];
      const chunkSummaries: string[] = [];
      let aggregateChunkOperations: ConversationFileOperation[] = [];
      const chunkOutputs: string[] = [];

      const maxChunkRetries =
        fastExecutionMode || isGeminiModelCoolingDown(FILE_OPS_MODEL.trim())
          ? 0
          : FILE_OPS_PLANNER_CHUNK_MAX_RETRIES;

      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
        const chunk = chunks[chunkIndex]!;
        const rotatedCandidate =
          PLANNER_MODEL_ROTATION[chunkIndex % PLANNER_MODEL_ROTATION.length] ??
          FILE_OPS_MODEL;
        const preferredModel = pickPlannerModelForAttempt(rotatedCandidate, 0);

        // Build enriched context from previous chunks — include actual file contents
        const previousChunkFilesList = aggregateChunkOperations
          .filter(
            (op) => op.type === "create_file" || op.type === "update_file",
          )
          .map((op) => (op as { path: string }).path);

        const previousKeyFileContents: string[] = [];
        if (workingProjectFiles.length > 0) {
          const keyPatterns = [
            "package.json",
            "tsconfig.json",
            "vite.config.ts",
            "tailwind.config.js",
            "postcss.config.js",
            "index.html",
            "src/main.tsx",
            "src/App.tsx",
            "src/index.css",
          ];
          for (const pattern of keyPatterns) {
            const file = workingProjectFiles.find(
              (f) => f.type === "file" && f.path === pattern && f.content,
            );
            if (file?.content) {
              const truncated =
                file.content.length > 4_000
                  ? `${file.content.slice(0, 4_000)}\n/* ...truncated... */`
                  : file.content;
              previousKeyFileContents.push(
                `--- ${file.path} ---\n${truncated}`,
              );
            }
          }
        }

        const chunkMessage = [
          input.message,
          "",
          `Execute implementation chunk ${chunkIndex + 1}/${chunks.length}: ${chunk.title}`,
          chunk.goal,
          "",
          chunkSummaries.length > 0
            ? [
                "Completed chunks:",
                ...chunkSummaries.map((summary) => `- ${summary}`),
              ].join("\n")
            : "",
          previousChunkFilesList.length > 0
            ? [
                "",
                "Files already created/modified by previous chunks:",
                ...previousChunkFilesList.map((path) => `- ${path}`),
              ].join("\n")
            : "",
          previousKeyFileContents.length > 0
            ? [
                "",
                "Key file contents from previous chunks (use these for compatibility):",
                ...previousKeyFileContents,
              ].join("\n")
            : "",
          "",
          "Implement ONLY this chunk now.",
          "Do not repeat previously completed chunk operations.",
          "Ensure imports/types/exports are compatible with files already created above.",
        ]
          .filter(Boolean)
          .join("\n");

        const chunkInput: ConversationOrchestrationInput = {
          ...input,
          message: chunkMessage,
          projectFiles: workingProjectFiles,
        };

        let selectedChunkOutput = await runPlanner({
          prompt: buildFileOperationPlannerPrompt(chunkInput),
          label: `chunk-${chunkIndex + 1}.primary`,
          preferredModel,
        });
        let selectedChunkOperations = normalizeOperations(
          extractOperations(selectedChunkOutput),
          {
            projectFiles: workingProjectFiles,
          },
        );
        let selectedChunkIssues = collectPlanIssues(
          selectedChunkOperations,
          chunkInput,
        );

        for (
          let retryIndex = 1;
          retryIndex <= maxChunkRetries &&
          (selectedChunkOperations.length === 0 ||
            selectedChunkIssues.length > 0);
          retryIndex += 1
        ) {
          const retryPrompt = buildFileOperationPlannerRetryPrompt(
            chunkInput,
            selectedChunkOutput,
            selectedChunkIssues.length > 0
              ? selectedChunkIssues
              : ["No valid operations were returned."],
          );

          const retryOutput = await runPlanner({
            prompt: retryPrompt,
            label: `chunk-${chunkIndex + 1}.retry-${retryIndex}`,
            preferredModel: pickPlannerModelForAttempt(
              preferredModel,
              retryIndex,
            ),
          });

          const retryOperations = normalizeOperations(
            extractOperations(retryOutput),
            {
              projectFiles: workingProjectFiles,
            },
          );
          const retryIssues = collectPlanIssues(retryOperations, chunkInput);

          selectedChunkOutput = retryOutput || selectedChunkOutput;
          selectedChunkOperations = retryOperations;
          selectedChunkIssues = retryIssues;
        }

        if (
          selectedChunkOperations.length === 0 ||
          selectedChunkIssues.length > 0
        ) {
          chunkOutputs.push(
            [
              `chunk-${chunkIndex + 1}: ${chunk.title}`,
              selectedChunkOutput || "(empty)",
              selectedChunkIssues.length > 0
                ? [
                    "Issues:",
                    ...selectedChunkIssues.map((issue) => `- ${issue}`),
                  ].join("\n")
                : "",
            ]
              .filter(Boolean)
              .join("\n"),
          );
          continue;
        }

        aggregateChunkOperations = [
          ...aggregateChunkOperations,
          ...selectedChunkOperations,
        ].slice(0, MAX_FILE_OPERATIONS_PER_COMPLEX_RUN);

        workingProjectFiles = applyOperationsToProjectSnapshot(
          workingProjectFiles,
          selectedChunkOperations,
        );

        chunkSummaries.push(`${chunk.title}: ${chunk.goal}`);
        chunkOutputs.push(
          [`chunk-${chunkIndex + 1}: ${chunk.title}`, selectedChunkOutput].join(
            "\n",
          ),
        );

        if (
          aggregateChunkOperations.length >= MAX_FILE_OPERATIONS_PER_COMPLEX_RUN
        ) {
          break;
        }
      }

      if (aggregateChunkOperations.length > 0) {
        const normalizedAggregateOperations = normalizeOperations(
          aggregateChunkOperations,
          {
            projectFiles: input.projectFiles,
            maxOperations: MAX_FILE_OPERATIONS_PER_COMPLEX_RUN,
          },
        );
        const aggregateIssues = collectPlanIssues(
          normalizedAggregateOperations,
        );

        if (aggregateIssues.length === 0) {
          return toPlanResult(
            normalizedAggregateOperations,
            mergePlannerOutputs("chunked-complex-build", ...chunkOutputs),
          );
        }

        chunkedPlannerOutput = mergePlannerOutputs(
          "chunked-complex-build-validation-failed",
          ...chunkOutputs,
          "Validation issues:",
          ...aggregateIssues.map((issue) => `- ${issue}`),
        );
      } else {
        chunkedPlannerOutput = mergePlannerOutputs(
          "chunked-complex-build-no-valid-ops",
          ...chunkOutputs,
        );
      }
    }

    const plannerPrompt = buildFileOperationPlannerPrompt(input);
    const plannerOutput = await runPlanner({
      prompt: plannerPrompt,
      label: "primary",
      preferredModel: pickPlannerModelForAttempt(
        fastExecutionMode ? FILE_OPS_FAST_MODEL : FILE_OPS_MODEL,
        0,
      ),
    });

    let selectedOutput = plannerOutput;
    let selectedOperations = normalizeOperations(
      extractOperations(plannerOutput),
    );
    let selectedIssues = collectPlanIssues(selectedOperations);

    console.info("conversation.planner.result", {
      operationCount: selectedOperations.length,
      issueCount: selectedIssues.length,
      issues: selectedIssues.slice(0, 5),
      types: selectedOperations.map((operation) => operation.type),
      plannerCallsUsed: plannerCallBudget.used,
    });

    if (selectedOperations.length > 0 && selectedIssues.length === 0) {
      return toPlanResult(
        selectedOperations,
        mergePlannerOutputs(chunkedPlannerOutput, selectedOutput),
      );
    }

    const maxRetries =
      fastExecutionMode || isGeminiModelCoolingDown(FILE_OPS_MODEL.trim())
        ? 0
        : FILE_OPS_PLANNER_MAX_RETRIES;

    for (let retryIndex = 1; retryIndex <= maxRetries; retryIndex += 1) {
      const retryIssues =
        selectedOperations.length === 0
          ? ["No valid operations were returned."]
          : selectedIssues;

      console.info("conversation.planner.retry", {
        retryIndex,
        retryIssues,
      });

      const retryPrompt = buildFileOperationPlannerRetryPrompt(
        input,
        selectedOutput,
        retryIssues,
      );
      const retryOutput = await runPlanner({
        prompt: retryPrompt,
        label: `retry-${retryIndex}`,
        preferredModel: pickPlannerModelForAttempt(
          fastExecutionMode ? FILE_OPS_FAST_MODEL : FILE_OPS_MODEL,
          retryIndex,
        ),
      });

      const retryOperations = normalizeOperations(
        extractOperations(retryOutput),
      );
      const retryValidationIssues = collectPlanIssues(retryOperations);

      console.info("conversation.planner.retry-result", {
        retryIndex,
        operationCount: retryOperations.length,
        issueCount: retryValidationIssues.length,
        issues: retryValidationIssues.slice(0, 5),
      });

      selectedOutput = retryOutput || selectedOutput;
      selectedOperations = retryOperations;
      selectedIssues = retryValidationIssues;

      if (selectedOperations.length > 0 && selectedIssues.length === 0) {
        return toPlanResult(
          selectedOperations,
          mergePlannerOutputs(chunkedPlannerOutput, selectedOutput),
        );
      }
    }

    if (
      requiresExecutablePlan &&
      (selectedOperations.length === 0 || selectedIssues.length > 0)
    ) {
      const finalStrictPrompt = [
        buildEmergencyFileOperationPlannerPrompt(
          input,
          selectedOutput,
          selectedIssues.length > 0
            ? selectedIssues
            : ["No valid operations were returned."],
        ),
        "",
        "STRICT EXECUTION MODE:",
        "- You MUST return executable JSON operations only.",
        "- For code_generation/code_update intents, operations MUST NOT be empty.",
        "- Include create_folder operations for parent directories before create_file/update_file operations.",
        "- If package.json is changed, include run_command install right after it.",
        "- Do not return prose, markdown, or code-only response.",
      ].join("\n");

      const finalStrictModel = pickPlannerModelForAttempt(
        fastExecutionMode ? FILE_OPS_FAST_MODEL : FILE_OPS_MODEL,
        maxRetries + 1,
      );
      const finalStrictOutput = await runPlanner({
        prompt: finalStrictPrompt,
        label: "final-strict",
        preferredModel: finalStrictModel,
      });
      const finalStrictOperations = normalizeOperations(
        extractOperations(finalStrictOutput),
      );
      const finalStrictIssues = collectPlanIssues(finalStrictOperations);

      console.info("conversation.planner.final-strict-result", {
        operationCount: finalStrictOperations.length,
        issueCount: finalStrictIssues.length,
        issues: finalStrictIssues.slice(0, 5),
        model: finalStrictModel,
      });

      selectedOutput = finalStrictOutput || selectedOutput;
      selectedOperations = finalStrictOperations;
      selectedIssues = finalStrictIssues;

      if (selectedOperations.length > 0 && selectedIssues.length === 0) {
        return toPlanResult(
          selectedOperations,
          mergePlannerOutputs(chunkedPlannerOutput, selectedOutput),
        );
      }
    }

    if (shouldUseDeterministicViteFallback) {
      const deterministicOperations = normalizePlannerOperationsForExecution({
        operations: buildDeterministicViteScaffoldOperations(
          input.projectFiles,
        ),
        projectFiles: input.projectFiles,
      });
      const deterministicIssues = collectPlanIssues(deterministicOperations);

      if (
        deterministicOperations.length > 0 &&
        deterministicIssues.length === 0
      ) {
        return toPlanResult(
          deterministicOperations,
          mergePlannerOutputs(
            chunkedPlannerOutput,
            selectedOutput,
            "fallback: deterministic-vite-scaffold",
          ),
        );
      }
    }

    return toPlanResult(
      selectedIssues.length === 0 ? selectedOperations : [],
      selectedIssues.length === 0
        ? mergePlannerOutputs(chunkedPlannerOutput, selectedOutput)
        : mergePlannerOutputs(
            chunkedPlannerOutput,
            selectedOutput,
            "Plan validation failed:",
            ...selectedIssues.map((issue) => `- ${issue}`),
          ),
    );
  } catch (error) {
    console.error("conversation.planner.error", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack?.slice(0, 500) : undefined,
      plannerCallsUsed: plannerCallBudget.used,
      plannerCallsMax: plannerCallBudget.max,
    });
    return toPlanResult(
      [] as ConversationFileOperation[],
      error instanceof Error ? error.message : "planner-error",
    );
  }
};

const executePlannedFileOperations = async (
  operations: ConversationFileOperation[],
  executeFileOperation?: ConversationFileOperationExecutor,
  onOperationProgress?: (
    completed: ConversationFileOperationResult[],
    total: number,
  ) => Promise<void> | void,
): Promise<ConversationFileOperationResult[]> => {
  if (operations.length === 0) {
    return [];
  }

  const results: ConversationFileOperationResult[] = [];
  const totalOps = operations.length;

  for (const operation of operations) {
    // Gate check: skip this operation if previous operation failed and this op requires it to succeed
    const isGated =
      (operation.type === "run_command" ||
        operation.type === "start_background_command") &&
      operation.gatedOnPreviousSuccess === true;

    if (isGated && results.length > 0) {
      const previousResult = results[results.length - 1]!;
      if (previousResult.status === "failed") {
        results.push({
          operation,
          status: "skipped",
          message: `Skipped because previous operation failed: ${previousResult.message.slice(0, 200)}`,
        });
        try {
          await onOperationProgress?.(results, totalOps);
        } catch {
          /* best-effort */
        }
        continue;
      }

      // Also skip if the previous command exited with a non-zero code
      if (
        previousResult.commandExitCode !== undefined &&
        previousResult.commandExitCode !== null &&
        previousResult.commandExitCode !== 0
      ) {
        results.push({
          operation,
          status: "skipped",
          message: `Skipped because previous command exited with code ${previousResult.commandExitCode}.`,
        });
        try {
          await onOperationProgress?.(results, totalOps);
        } catch {
          /* best-effort */
        }
        continue;
      }
    }

    if (!executeFileOperation) {
      const isCommandOperation =
        operation.type === "run_command" ||
        operation.type === "start_background_command";

      results.push({
        operation,
        status: isCommandOperation ? "applied" : "skipped",
        message: isCommandOperation
          ? "Queued for sandbox runtime execution."
          : "No execution handler is available.",
      });
      try {
        await onOperationProgress?.(results, totalOps);
      } catch {
        /* best-effort */
      }
      continue;
    }

    try {
      const execution = await executeFileOperation(operation);
      results.push({
        operation,
        status: execution.status,
        message: execution.message.trim() || "No details returned.",
        commandOutput: execution.commandOutput,
        commandExitCode: execution.commandExitCode,
      });
    } catch (error) {
      results.push({
        operation,
        status: "failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }

    // Fire progress callback after each operation so the UI updates in real-time
    try {
      await onOperationProgress?.(results, totalOps);
    } catch {
      /* best-effort */
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
  operationResults: ConversationFileOperationResult[];
}) =>
  (args.intent === "code_generation" || args.intent === "code_update") &&
  args.operationResults.some(
    (result) =>
      result.status === "applied" &&
      isFilesystemMutationOperation(result.operation),
  );

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
      r.status === "applied" && r.operation.type === "start_background_command",
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
    sections.push(
      failedCount > 0
        ? `\u26a0\ufe0f **Partially applied** \u2014 ${summaryParts.join(", ")}. Automatic repair was attempted, but ${failedCount} operation${failedCount === 1 ? "" : "s"} still failed.`
        : `\u2705 **Done** \u2014 ${summaryParts.join(", ")}.`,
    );
    sections.push("");
  }

  // Project structure
  if (structureLines.length > 0) {
    sections.push(
      "### Project Structure",
      "```text",
      ...structureLines,
      "```",
      "",
    );
  }

  // File list with brief descriptions (no full code dumps)
  if (args.changedFiles.length > 0) {
    const label =
      args.intent === "code_update"
        ? "### Files Modified"
        : "### Files Created";
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
      sections.push(`- \u2705 ${describeFileOperation(result.operation)}`);
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
  let plannerCallsUsed = fileOperationPlan.plannerCallCount;
  let allOperations = fileOperationPlan.operations;
  let operationResults = await executePlannedFileOperations(
    allOperations,
    input.executeFileOperation,
    input.onOperationProgress,
  );

  // ─── Iterative Fixup Loop ───────────────────────────────────────────
  // Detect failures (commands, file writes) and attempt repair up to
  // MAX_FIXUP_ITERATIONS times, feeding actual error output back to the
  // planner so it can make informed corrections.

  const collectFailures = (results: ConversationFileOperationResult[]) =>
    results.filter(
      (result) =>
        result.status === "failed" ||
        (result.status === "skipped" &&
          result.message.startsWith("Skipped because previous")),
    );

  let currentFailures = collectFailures(operationResults);

  for (
    let fixupIteration = 1;
    fixupIteration <= MAX_FIXUP_ITERATIONS &&
    currentFailures.length > 0 &&
    input.executeFileOperation &&
    plannerCallsUsed < MAX_PLANNER_CALLS_PER_REQUEST;
    fixupIteration += 1
  ) {
    console.info("conversation.planner.fixup.iteration", {
      iteration: fixupIteration,
      maxIterations: MAX_FIXUP_ITERATIONS,
      failureCount: currentFailures.length,
      failures: currentFailures.map((f) => ({
        op: describeFileOperation(f.operation),
        msg: f.message.slice(0, 200),
        exitCode: f.commandExitCode,
        hasOutput: Boolean(f.commandOutput),
      })),
    });

    // Build failure summary with actual command output
    const failureSummary = currentFailures
      .map((r) => {
        const parts = [
          `- ${describeFileOperation(r.operation)}: ${r.message.slice(0, 300)}`,
        ];
        if (r.commandExitCode !== undefined && r.commandExitCode !== null) {
          parts.push(`  Exit code: ${r.commandExitCode}`);
        }
        if (r.commandOutput) {
          parts.push(
            `  Terminal output:\n${r.commandOutput.slice(0, MAX_FIXUP_OUTPUT_CHARS)}`,
          );
        }
        return parts.join("\n");
      })
      .join("\n\n");

    // Reload project files to see current state after previous operations
    let fixupProjectFiles = input.projectFiles ?? [];
    if (input.loadProjectFilesAfterOperations) {
      try {
        fixupProjectFiles = await input.loadProjectFilesAfterOperations();
      } catch {
        fixupProjectFiles = input.projectFiles ?? [];
      }
    }

    // Build enhanced fixup prompt with error context
    const keyFileContents = buildPlannerKeyFileContext(fixupProjectFiles);

    // Find all source files that were created to analyze imports
    const createdSourceFiles = allOperations
      .filter(
        (op) =>
          (op.type === "create_file" || op.type === "update_file") &&
          /\.(tsx?|jsx?|mjs|cjs)$/.test(op.path) &&
          op.path !== "package.json",
      )
      .map((op) => (op as { path: string; content: string }).path);

    const fixupPrompt = [
      `FIXUP MODE (attempt ${fixupIteration}/${MAX_FIXUP_ITERATIONS}): Previous operations had failures that need correction.`,
      "Your output is PARSED AND EXECUTED IMMEDIATELY to fix the issue.",
      "",
      "═══════════════════════════════════════════════════",
      "FAILURES TO FIX:",
      "═══════════════════════════════════════════════════",
      failureSummary,
      "",
      "═══════════════════════════════════════════════════",
      "DIAGNOSIS CHECKLIST:",
      "═══════════════════════════════════════════════════",
      "1. Are ALL imported packages listed in package.json dependencies?",
      "2. Are package versions compatible (not conflicting peer deps)?",
      "3. Are TypeScript config paths correct (baseUrl, paths)?",
      "4. Are all type definition packages included (@types/...)?",
      "5. Do all import paths resolve to files that exist?",
      "",
      "Original user request:",
      input.message.slice(0, 500),
      "",
      "Existing project files:",
      buildProjectFileInventory(fixupProjectFiles),
      "",
      ...(keyFileContents.length > 0
        ? ["Current key file contents:", ...keyFileContents, ""]
        : []),
      createdSourceFiles.length > 0
        ? [
            "Source files that were created (check their imports):",
            ...createdSourceFiles.map((p) => `- ${p}`),
          ].join("\n")
        : "",
      "",
      "IMPORTANT RULES:",
      "- Return ONLY corrective operations (fix package.json, add missing config, fix import paths).",
      "- Do NOT recreate files that already exist and are correct.",
      "- If package.json needs fixing, include the COMPLETE updated package.json content.",
      "- After fixing package.json, include a run_command for npm install.",
      "- After fixing files or dependencies, retry the failed terminal command(s) so the pipeline can confirm the app now runs.",
      '- Return valid JSON: {"operations":[...]}',
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const fixupModel = pickPlannerModelForAttempt(
        FILE_OPS_MODEL,
        fixupIteration,
      );
      const fixupCallBudget = {
        used: plannerCallsUsed,
        max: MAX_PLANNER_CALLS_PER_REQUEST,
      };
      const fixupOutput = await runFileOpsPlannerDirect(
        fixupPrompt,
        `fixup-${fixupIteration}`,
        {
          preferredModel: fixupModel,
          callBudget: fixupCallBudget,
          fastMode: shouldUseFastPlannerMode(input),
        },
      );
      plannerCallsUsed = fixupCallBudget.used;

      const fixupJson = extractJsonObject(
        fixupOutput
          .replace(/^```(?:json)?\s*\n?/i, "")
          .replace(/\n?```\s*$/i, "")
          .trim(),
      );

      if (fixupJson) {
        const fixupOps = parseFileOperationPlan(safeJsonParse(fixupJson) ?? {});

        if (fixupOps.length > 0) {
          const normalizedFixupOps = normalizePlannerOperationsForExecution({
            operations: fixupOps,
            projectFiles: fixupProjectFiles,
            maxOperations: MAX_FILE_OPERATIONS_PER_RUN,
          });
          const recoveryCommandOps = buildRecoveryCommandOperations({
            failures: currentFailures,
            plannedOperations: normalizedFixupOps,
          });
          const executableFixupOps = [
            ...normalizedFixupOps,
            ...recoveryCommandOps,
          ];

          const fixupResults = await executePlannedFileOperations(
            executableFixupOps,
            input.executeFileOperation,
            input.onOperationProgress,
          );

          allOperations = [...allOperations, ...executableFixupOps];
          operationResults = [...operationResults, ...fixupResults];

          const fixupApplied = fixupResults.filter(
            (r) => r.status === "applied",
          ).length;
          const fixupFailed = fixupResults.filter(
            (r) => r.status === "failed",
          ).length;

          console.info("conversation.planner.fixup.applied", {
            iteration: fixupIteration,
            fixupOperationCount: executableFixupOps.length,
            recoveryCommandCount: recoveryCommandOps.length,
            fixupApplied,
            fixupFailed,
          });

          // Update failures for the next iteration
          currentFailures = collectFailures(fixupResults);

          if (currentFailures.length === 0) {
            console.info("conversation.planner.fixup.resolved", {
              iteration: fixupIteration,
            });
            break;
          }
        } else {
          console.warn("conversation.planner.fixup.empty-ops", {
            iteration: fixupIteration,
          });
          break;
        }
      } else {
        console.warn("conversation.planner.fixup.no-json", {
          iteration: fixupIteration,
        });
        break;
      }
    } catch (fixupError) {
      console.warn("conversation.planner.fixup.error", {
        iteration: fixupIteration,
        error:
          fixupError instanceof Error ? fixupError.message : String(fixupError),
      });
      break;
    }
  }

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
    shouldUseStructuredCodeResponse({
      intent,
      operationResults,
    })
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
      operations: allOperations,
      operationResults,
      fileOperationPlannerOutput: fileOperationPlan.plannerOutput,
      plannerCallsUsed,
    };
  }

  const requiresExecutableFileOps =
    shouldRequireExecutableFileOperations(input);

  if (requiresExecutableFileOps && fileOperationPlan.operations.length === 0) {
    const strictFailureContent = [
      "I could not generate a safe executable file-operation plan for this request.",
      "No files were changed.",
      "",
      "Try adding explicit target files/folders and required commands so I can execute operations directly.",
    ].join("\n");

    return {
      content: strictFailureContent,
      assignments: [] as AgentAssignment[],
      reports: [] as SpecialistReport[],
      supervisorPlan: "strict-file-ops-plan-gate",
      operations: allOperations,
      operationResults,
      fileOperationPlannerOutput: fileOperationPlan.plannerOutput,
      plannerCallsUsed,
    };
  }

  const requiresFilesystemMutations =
    shouldRequireFilesystemMutationOperations(input);
  const appliedFilesystemMutationCount = operationResults.filter(
    (result) =>
      result.status === "applied" &&
      isFilesystemMutationOperation(result.operation),
  ).length;

  if (requiresFilesystemMutations && appliedFilesystemMutationCount === 0) {
    const applyGateFailureContent = [
      "I couldn't apply any filesystem changes for this request.",
      "No files or folders were created, updated, renamed, or deleted.",
      "",
      "Execution summary:",
      buildFileOperationSummary(operationResults),
    ].join("\n");

    return {
      content: applyGateFailureContent,
      assignments: [] as AgentAssignment[],
      reports: [] as SpecialistReport[],
      supervisorPlan: "strict-file-mutation-apply-gate",
      operations: allOperations,
      operationResults,
      fileOperationPlannerOutput: fileOperationPlan.plannerOutput,
      plannerCallsUsed,
    };
  }

  const plannerCallBudgetNearLimit = plannerCallsUsed >= 2;

  const useReducedAgentPlan =
    plannerCallBudgetNearLimit ||
    [SUPERVISOR_MODEL, SPECIALIST_MODEL, SYNTHESIS_MODEL, FILE_OPS_MODEL].some(
      (model) => isGeminiModelCoolingDown(model.trim()),
    );

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
    supervisorText = plannerCallBudgetNearLimit
      ? "supervisor-skipped-due-to-planner-call-budget"
      : "supervisor-skipped-due-to-gemini-cooldown";
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
        reasoningEffort: "low",
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

  const reports: SpecialistReport[] = [];

  for (const assignment of assignments) {
    const agent = specialistAgents[assignment.agent];
    try {
      const content = await runAgentTextWithFallback({
        agent,
        prompt: buildSpecialistPrompt(input, assignment),
        systemPrompt: SPECIALIST_SYSTEM_PROMPTS[assignment.agent],
        model: SPECIALIST_MODEL,
        label: `specialist:${assignment.agent}`,
        reasoningEffort: "medium",
      });

      reports.push({
        agent: assignment.agent,
        task: assignment.task,
        content,
      });
    } catch (error) {
      reports.push({
        agent: assignment.agent ?? "implementation",
        task: assignment.task ?? "Provide practical implementation guidance.",
        content: `specialist-error: ${error instanceof Error ? error.message : "unknown error"}`,
      });
    }
  }

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
        reasoningEffort: "medium",
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
    operations: allOperations,
    operationResults,
    fileOperationPlannerOutput: fileOperationPlan.plannerOutput,
    plannerCallsUsed,
  };
};

export const generateConversationTitle = async (message: string) => {
  const title = await runAgentTextWithFallback({
    agent: titleAgent,
    prompt: ["Conversation starter:", message, "", "Title:"].join("\n"),
    systemPrompt: TITLE_SYSTEM_PROMPT,
    model: SPECIALIST_MODEL,
    label: "title",
    reasoningEffort: "low",
  });

  return title
    .replace(/^["'`]+|["'`.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
};
