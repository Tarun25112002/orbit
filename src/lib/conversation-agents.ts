import {
  createAgent,
  gemini,
  type AgentResult,
} from "@inngest/agent-kit";
import { GEMINI_MODEL_DEFAULT } from "@/lib/gemini";

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
};

type SpecialistReport = {
  agent: SpecialistKey;
  task: string;
  content: string;
};

const supervisorAgent = createAgent({
  name: "conversation_supervisor",
  description: "Plans which specialist agents should answer a user request.",
  model: createGeminiModel(SUPERVISOR_MODEL, {
    temperature: 0.1,
    maxOutputTokens: 900,
  }),
  system: [
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
  ].join("\n"),
});

const architectureAgent = createAgent({
  name: "architecture",
  description: "Understands codebase structure and explains how pieces connect.",
  model: createGeminiModel(SPECIALIST_MODEL, {
    temperature: 0.2,
    maxOutputTokens: 1800,
  }),
  system: [
    "You are Orbit's architecture specialist.",
    "Focus on project structure, data flow, API boundaries, and how the code fits together.",
    "Return concise findings that another agent can synthesize into a final user answer.",
  ].join("\n"),
});

const codeQualityAgent = createAgent({
  name: "code_quality",
  description: "Reviews code for bugs, edge cases, and missing tests.",
  model: createGeminiModel(SPECIALIST_MODEL, {
    temperature: 0.15,
    maxOutputTokens: 1800,
  }),
  system: [
    "You are Orbit's code-quality specialist.",
    "Focus on correctness, regressions, edge cases, and verification.",
    "Be specific and avoid generic advice.",
  ].join("\n"),
});

const implementationAgent = createAgent({
  name: "implementation",
  description: "Turns requests into concrete implementation guidance.",
  model: createGeminiModel(SPECIALIST_MODEL, {
    temperature: 0.25,
    maxOutputTokens: 2200,
  }),
  system: [
    "You are Orbit's implementation specialist.",
    "Focus on concrete code changes, APIs, examples, and practical next steps.",
    "Prefer local project patterns over new abstractions.",
  ].join("\n"),
});

const webContextAgent = createAgent({
  name: "web_context",
  description: "Extracts relevant facts from scraped URL context.",
  model: createGeminiModel(SPECIALIST_MODEL, {
    temperature: 0.1,
    maxOutputTokens: 1800,
  }),
  system: [
    "You are Orbit's web-context specialist.",
    "Use only the supplied scraped web context for external facts.",
    "Call out when the web context is absent or insufficient.",
  ].join("\n"),
});

const synthesisAgent = createAgent({
  name: "conversation_synthesizer",
  description: "Combines specialist findings into the final assistant answer.",
  model: createGeminiModel(SYNTHESIS_MODEL, {
    temperature: 0.35,
    maxOutputTokens: 5000,
  }),
  system: [
    "You are Orbit AI, an intelligent coding assistant embedded in the Orbit code editor.",
    "Synthesize the specialist reports into one helpful response for the user.",
    "Do not mention internal orchestration unless it is directly useful.",
    "Be concise, accurate, and practical. Use markdown when helpful.",
  ].join("\n"),
});

const titleAgent = createAgent({
  name: "conversation_title",
  description: "Creates short conversation titles.",
  model: createGeminiModel(SPECIALIST_MODEL, {
    temperature: 0.2,
    maxOutputTokens: 40,
  }),
  system: [
    "Create a short title for a coding assistant conversation.",
    "Return only the title, no quotes, no punctuation at the end.",
    "Use 3 to 6 words.",
  ].join("\n"),
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
    "Write the final answer for the user now.",
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

  const supervisorResult = await supervisorAgent.run(supervisorPrompt);
  const supervisorText = textFromAgentResult(supervisorResult);
  const supervisorJson = extractJsonObject(supervisorText);
  let parsedPlan: unknown = null;

  if (supervisorJson) {
    try {
      parsedPlan = JSON.parse(supervisorJson);
    } catch {
      parsedPlan = null;
    }
  }

  const assignments = normalizeAssignments(parsedPlan, input);

  const reports = await Promise.all(
    assignments.map(async (assignment) => {
      const agent = specialistAgents[assignment.agent];
      const result = await agent.run(buildSpecialistPrompt(input, assignment));

      return {
        agent: assignment.agent,
        task: assignment.task,
        content: textFromAgentResult(result),
      };
    }),
  );

  const synthesisResult = await synthesisAgent.run(
    buildSynthesisPrompt(input, reports),
  );
  const content = textFromAgentResult(synthesisResult);

  return {
    content,
    assignments,
    reports,
    supervisorPlan: supervisorText,
  };
};

export const generateConversationTitle = async (message: string) => {
  const result = await titleAgent.run([
    "Conversation starter:",
    message,
    "",
    "Title:",
  ].join("\n"));

  return textFromAgentResult(result)
    .replace(/^["'`]+|["'`.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
};
