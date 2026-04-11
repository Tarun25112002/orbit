import { createAgent, gemini, type AgentResult } from "@inngest/agent-kit";
import { GEMINI_MODEL_DEFAULT, generateGeminiCompletion } from "@/lib/gemini";

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
const MAX_FILE_OPERATIONS_PER_RUN = 12;
const MAX_PROJECT_FILE_INVENTORY = 220;

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
    };

export type ConversationFileOperationExecutionResult = {
  status: "applied" | "skipped" | "failed";
  message: string;
};

export type ConversationFileOperationExecutor = (
  operation: ConversationFileOperation,
) => Promise<ConversationFileOperationExecutionResult>;

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
  "Prefer modifying existing files over creating duplicate files.",
  "Use forward-slash relative paths like src/app/page.ts.",
  "Allowed operation types:",
  "- create_file: { type, path, content, overwrite? }",
  "- create_folder: { type, path }",
  "- update_file: { type, path, content, createIfMissing? }",
  "- delete_path: { type, path }",
  "- rename_path: { type, path, newPath, createMissingParents? }",
  "JSON shape:",
  '{"operations":[{"type":"update_file","path":"src/example.ts","content":"..."}]}',
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
  [
    systemPrompt,
    "",
    "Task input:",
    prompt,
  ].join("\n");

const runAgentTextWithFallback = async (args: {
  agent: { run: (prompt: string) => Promise<AgentResult> };
  prompt: string;
  systemPrompt: string;
  model: string;
  label: string;
}) => {
  let primaryError: unknown;

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

  try {
    const fallback = await generateGeminiCompletion({
      model: args.model,
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

    throw new Error(
      `${args.label} failed. primary=${primaryMessage}; fallback=${fallbackMessage}`,
    );
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

const parseFileOperation = (
  value: unknown,
): ConversationFileOperation | null => {
  const record = toRecord(value);
  if (!record) {
    return null;
  }

  const type =
    typeof record.type === "string" ? record.type.trim().toLowerCase() : "";
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
      overwrite: parseOptionalBoolean(record.overwrite),
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
      createIfMissing: parseOptionalBoolean(record.createIfMissing),
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
      createMissingParents: parseOptionalBoolean(record.createMissingParents),
    };
  }

  return null;
};

const parseFileOperationPlan = (
  value: unknown,
): ConversationFileOperation[] => {
  const record = toRecord(value);
  if (!record || !Array.isArray(record.operations)) {
    return [];
  }

  const operations = record.operations
    .map((operation) => parseFileOperation(operation))
    .filter(
      (operation): operation is ConversationFileOperation => operation !== null,
    )
    .slice(0, MAX_FILE_OPERATIONS_PER_RUN);

  return operations;
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
    "Return JSON only with this shape:",
    '{"operations":[{"type":"update_file","path":"src/example.ts","content":"..."}]}',
  ]
    .filter(Boolean)
    .join("\n");

const buildFileOperationPlannerRetryPrompt = (
  input: ConversationOrchestrationInput,
  previousOutput: string,
) =>
  [
    buildFileOperationPlannerPrompt(input),
    "",
    "Your previous response was empty or not valid JSON:",
    previousOutput || "(empty)",
    "",
    "Return valid JSON only now.",
    "If the request involves implementation or editing, include at least one operation.",
    "Do not include markdown fences.",
  ]
    .filter(Boolean)
    .join("\n");

const shouldPlanFileOperations = (input: ConversationOrchestrationInput) => {
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
    const operations = extractOperations(plannerOutput);

    if (operations.length > 0) {
      return {
        operations,
        plannerOutput,
      };
    }

    const retryOutput = await runAgentTextWithFallback({
      agent: fileOperationsPlannerAgent,
      prompt: buildFileOperationPlannerRetryPrompt(input, plannerOutput),
      systemPrompt: FILE_OPS_PLANNER_SYSTEM_PROMPT,
      model: FILE_OPS_MODEL,
      label: "file-ops-planner-retry",
    });
    const retryOperations = extractOperations(retryOutput);

    return {
      operations: retryOperations,
      plannerOutput: retryOutput || plannerOutput,
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

  if (!executeFileOperation) {
    return operations.map((operation) => ({
      operation,
      status: "skipped",
      message: "No execution handler is available.",
    }));
  }

  const results: ConversationFileOperationResult[] = [];

  for (const operation of operations) {
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
    return "No filesystem operations were executed.";
  }

  return operationResults
    .map(
      (result) =>
        `- ${result.status.toUpperCase()}: ${describeFileOperation(result.operation)} (${result.message})`,
    )
    .join("\n");
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
    "Filesystem operation results:",
    buildFileOperationSummary(operationResults),
    "",
    "Write the final answer for the user now.",
    "If operations were applied, clearly list the changed paths and what changed.",
  ]
    .filter(Boolean)
    .join("\n");

export const runConversationAgentOrchestration = async (
  input: ConversationOrchestrationInput,
) => {
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
        content:
          reportResult.reason instanceof Error
            ? `Specialist unavailable: ${reportResult.reason.message}`
            : "Specialist unavailable due to an unexpected error.",
      };
    },
  );

  const fileOperationPlan = await planConversationFileOperations(input);
  const operationResults = await executePlannedFileOperations(
    fileOperationPlan.operations,
    input.executeFileOperation,
  );

  let content = "";

  try {
    content = await runAgentTextWithFallback({
      agent: synthesisAgent,
      prompt: buildSynthesisPrompt(input, reports, operationResults),
      systemPrompt: SYNTHESIS_SYSTEM_PROMPT,
      model: SYNTHESIS_MODEL,
      label: "synthesis",
    });
  } catch (error) {
    const fallbackErrorMessage =
      error instanceof Error ? error.message : "Unexpected synthesis error";
    content = [
      "I completed what I could, but could not generate the full narrative response.",
      "",
      "Filesystem operation results:",
      buildFileOperationSummary(operationResults),
      "",
      "Partial analysis:",
      reports
        .map(
          (report) =>
            `- ${report.agent}: ${report.content || "No details available."}`,
        )
        .join("\n"),
      "",
      `Synthesis error: ${fallbackErrorMessage}`,
    ].join("\n");
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
