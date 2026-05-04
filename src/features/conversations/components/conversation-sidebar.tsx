"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import {
  AlertTriangleIcon,
  BotIcon,
  ListOrderedIcon,
  LockIcon,
  MessageSquareIcon,
  PencilIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
  SquareIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { classifyError, type ClassifiedError } from "@/lib/errors";
import {
  ORBIT_AI_EXECUTION_TRACE_EVENT,
  parseAiExecutionTrace,
  type AiExecutionTrace,
  type OrbitAiExecutionTraceEventDetail,
} from "@/lib/ai-execution";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Suggestion } from "@/components/ai-elements/suggestion";
import { Spinner } from "@/components/ui/spinner";

import {
  useConversation,
  useProjectConversations,
  useMessages,
  useCreateConversation,
  useDeleteConversation,
  useUpdateConversationTitle,
  useSendMessage,
} from "../hooks/use-conversations";
import { useEditor } from "../../editor/hooks/use-editor";
import { useProjectFiles } from "../../projects/hooks/use-files";
import { buildProjectFilePathMap } from "@/features/editor/utils/codebase-context";

const STARTER_SUGGESTIONS = [
  "Explain this codebase architecture",
  "Find potential bugs in the project",
  "Suggest refactoring improvements",
  "Help me add a new feature",
];

const describePipelineOperation = (
  operation: AiExecutionTrace["operations"][number],
) => {
  if (operation.type === "run_command") {
    const args = operation.commandArgs?.join(" ") ?? "";
    return `run_command ${operation.command}${args ? ` ${args}` : ""}`;
  }

  if (operation.type === "start_background_command") {
    const args = operation.commandArgs?.join(" ") ?? "";
    return `start_background_command[${operation.key}] ${operation.command}${args ? ` ${args}` : ""}`;
  }

  if (operation.type === "rename_path") {
    return `${operation.type} ${operation.path} -> ${operation.newPath}`;
  }

  return `${operation.type} ${operation.path}`;
};

const extractExecutionTrace = (reasoningDetails: unknown) => {
  if (typeof reasoningDetails !== "object" || reasoningDetails === null) {
    return null;
  }

  const record = reasoningDetails as Record<string, unknown>;
  return parseAiExecutionTrace(record.executionTrace);
};

const inferAssistantPipelinePhase = (
  content: string,
): "planning" | "executing" => {
  const t = content.trimStart();
  if (t.startsWith("✍️") || t.startsWith("🤔") || t.startsWith("🧭")) {
    return "planning";
  }

  const lower = t.slice(0, 220).toLowerCase();
  if (
    /\b(planning pipeline|generating plan|planning executable|understanding request)\b/.test(
      lower,
    )
  ) {
    return "planning";
  }

  if (/\bcooling model\b/.test(lower) || /\brate limit\b/.test(lower)) {
    return "executing";
  }

  return "executing";
};

const statusBadgeClasses = (
  status: AiExecutionTrace["operationResults"][number]["status"],
) => {
  if (status === "applied") {
    return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  }

  if (status === "failed") {
    return "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-400";
  }

  return "border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-400";
};

const ExecutionTimeline = ({ trace }: { trace: AiExecutionTrace }) => {
  if (trace.operationResults.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-border/60 bg-card/80 shadow-sm ring-1 ring-border/30 backdrop-blur-sm">
      <div className="flex items-center gap-2 border-b border-border/50 bg-muted/30 px-3 py-2">
        <ListOrderedIcon
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <span className="text-xs font-semibold text-foreground">
          Execution pipeline
        </span>
        <span className="ml-auto rounded-md bg-muted/80 px-2 py-0.5 font-mono text-[10px] font-medium tabular-nums text-muted-foreground">
          {trace.operationResults.length} step
          {trace.operationResults.length === 1 ? "" : "s"}
        </span>
      </div>
      <ScrollArea className="max-h-56">
        <div className="space-y-0 divide-y divide-border/40 px-2 py-1.5">
          {trace.operationResults.map((result, index) => (
            <div
              key={`${index}:${result.status}:${describePipelineOperation(result.operation)}`}
              className="grid grid-cols-1 gap-1.5 py-2.5 text-xs sm:grid-cols-[1fr_auto] sm:items-start sm:gap-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-mono text-[10px] font-medium tabular-nums text-muted-foreground">
                    {(index + 1).toString().padStart(2, "0")}
                  </span>
                  <p className="min-w-0 break-all font-mono text-[11px] leading-snug text-foreground/90">
                    {describePipelineOperation(result.operation)}
                  </p>
                </div>
                {result.message ? (
                  <p className="mt-1 border-l-2 border-border/70 pl-2 text-[11px] leading-relaxed text-muted-foreground">
                    {result.message}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 sm:justify-end">
                <Badge
                  variant="outline"
                  className={cn(
                    "rounded-md px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide",
                    statusBadgeClasses(result.status),
                  )}
                >
                  {result.status}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};

const ConversationListItem = ({
  title,
  isActive,
  onSelect,
  onDelete,
  onRename,
}: {
  title: string;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (newTitle: string) => void;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleRename = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== title) {
      onRename(trimmed);
    }
    setIsEditing(false);
  };

  return (
    <div
      className={cn(
        "group relative flex cursor-pointer items-center gap-2 rounded-lg border border-transparent px-2.5 py-2 text-xs transition-colors outline-none",
        "focus-within:border-primary/20 focus-within:bg-muted/40",
        isActive
          ? "border-primary/15 bg-primary/5 text-foreground shadow-sm ring-1 ring-primary/10"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
      onClick={isEditing ? undefined : onSelect}
    >
      <MessageSquareIcon className="size-3.5 shrink-0 opacity-60" />

      {isEditing ? (
        <input
          ref={inputRef}
          className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground shadow-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRename();
            if (e.key === "Escape") setIsEditing(false);
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
      )}

      {!isEditing && (
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={(e) => {
              e.stopPropagation();
              setEditValue(title);
              setIsEditing(true);
            }}
            aria-label="Rename conversation"
          >
            <PencilIcon className="size-3" />
          </button>
          <button
            type="button"
            className="rounded-md p-1 text-destructive/70 hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            aria-label="Delete conversation"
          >
            <Trash2Icon className="size-3" />
          </button>
        </div>
      )}
    </div>
  );
};

const ChatMessage = ({
  role,
  content,
  status,
  reasoningDetails,
}: {
  role: "user" | "assistant";
  content: string;
  status?: string | null;
  reasoningDetails?: unknown;
}) => {
  const isProcessing = status === "processing";
  const isFailed = status === "failed";
  const isCancelled = status === "cancelled";
  const executionTrace =
    role === "assistant" ? extractExecutionTrace(reasoningDetails) : null;
  const pipelinePhase =
    role === "assistant" && isProcessing && content
      ? inferAssistantPipelinePhase(content)
      : null;

  return (
    <Message from={role}>
      <MessageContent>
        {role === "assistant" && isProcessing && !content ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/80 bg-muted/30 px-3 py-2.5">
            <Spinner className="size-4 text-primary" />
            <Shimmer duration={1.5}>Preparing response…</Shimmer>
          </div>
        ) : role === "assistant" && isProcessing && content ? (
          <div className="relative rounded-xl border border-primary/15 bg-muted/25 p-3 ring-1 ring-primary/10">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="relative flex size-2.5 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/50 opacity-60" />
                <span className="relative inline-flex size-2.5 rounded-full bg-primary" />
              </span>
              <Badge variant="secondary" className="text-[11px] font-semibold">
                {pipelinePhase === "planning" ? "Planning" : "Executing"}
              </Badge>
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Live pipeline status
              </span>
            </div>
            <div className="rounded-lg border border-border/40 bg-background/60 px-2.5 py-2">
              <MessageResponse>{content}</MessageResponse>
            </div>
          </div>
        ) : role === "assistant" && isFailed ? (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2.5 text-sm font-medium text-destructive"
          >
            <AlertTriangleIcon className="size-4 shrink-0 opacity-90" />
            <span>Failed to generate response</span>
          </div>
        ) : role === "assistant" && isCancelled ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-border/80 bg-muted/40 px-3 py-2.5 text-sm font-medium text-muted-foreground">
            <XIcon className="size-4 shrink-0 opacity-80" />
            <span>{content || "Response cancelled."}</span>
          </div>
        ) : role === "assistant" ? (
          <>
            <MessageResponse>{content}</MessageResponse>
            {executionTrace ? (
              <ExecutionTimeline trace={executionTrace} />
            ) : null}
          </>
        ) : (
          <p className="text-sm whitespace-pre-wrap">{content}</p>
        )}
      </MessageContent>
    </Message>
  );
};

const ChatView = ({
  conversationId,
  projectId,
  onBack,
}: {
  conversationId: Id<"conversations">;
  projectId: Id<"projects">;
  onBack: () => void;
}) => {
  const conversation = useConversation(conversationId);
  const messages = useMessages(conversationId);
  const sendMessage = useSendMessage();
  const { getToken } = useAuth();
  const router = useRouter();
  const aiAccess = useQuery(api.projects.checkAiAccess);
  const isLimitReached = aiAccess ? !aiAccess.allowed : false;
  const [isSending, setIsSending] = useState(false);
  const [pendingAssistantMessageId, setPendingAssistantMessageId] =
    useState<Id<"messages"> | null>(null);
  const [cancellingMessageId, setCancellingMessageId] =
    useState<Id<"messages"> | null>(null);
  const [error, setError] = useState<ClassifiedError | null>(null);
  const dispatchedExecutionTraceRef = useRef<Set<Id<"messages">>>(new Set());
  const hasHydratedTraceDispatchRef = useRef(false);
  const { activeTabId } = useEditor(projectId);
  const projectFiles = useProjectFiles({ projectId });

  const filePathById = useMemo(
    () => buildProjectFilePathMap(projectFiles ?? []),
    [projectFiles],
  );

  const activeFilePath = useMemo(() => {
    if (!activeTabId) {
      return undefined;
    }

    return filePathById.get(activeTabId);
  }, [activeTabId, filePathById]);

  const activeFolderPath = useMemo(() => {
    if (!activeFilePath) {
      return undefined;
    }

    const separatorIndex = activeFilePath.lastIndexOf("/");
    if (separatorIndex <= 0) {
      return undefined;
    }

    return activeFilePath.slice(0, separatorIndex);
  }, [activeFilePath]);

  const buildAuthHeaders = useCallback(async () => {
    const headers = new Headers({
      "Content-Type": "application/json",
    });

    try {
      const token =
        (await getToken({ template: "convex" })) ?? (await getToken());
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }
    } catch {

    }

    return headers;
  }, [getToken]);

  useEffect(() => {
    dispatchedExecutionTraceRef.current.clear();
    hasHydratedTraceDispatchRef.current = false;
  }, [conversationId]);

  const processingAssistantMessage = [...(messages ?? [])]
    .reverse()
    .find((msg) => msg.role === "assistant" && msg.status === "processing");

  const activeAssistantMessageId =
    processingAssistantMessage?._id ?? pendingAssistantMessageId;

  const isCancellingActiveAssistant =
    !!activeAssistantMessageId &&
    cancellingMessageId === activeAssistantMessageId;

  useEffect(() => {
    if (!pendingAssistantMessageId || !messages) {
      return;
    }

    const pendingMessage = messages.find(
      (msg) => msg._id === pendingAssistantMessageId,
    );

    if (!pendingMessage || pendingMessage.status !== "processing") {
      setPendingAssistantMessageId(null);
    }
  }, [messages, pendingAssistantMessageId]);

  useEffect(() => {
    if (!messages || typeof window === "undefined") {
      return;
    }

    if (!hasHydratedTraceDispatchRef.current) {
      for (const message of messages) {
        if (message.role !== "assistant" || message.status !== "completed") {
          continue;
        }

        const trace = extractExecutionTrace(message.reasoning_details);
        if (!trace) {
          continue;
        }

        dispatchedExecutionTraceRef.current.add(message._id);
      }

      hasHydratedTraceDispatchRef.current = true;
      return;
    }

    for (const message of messages) {
      if (message.role !== "assistant" || message.status !== "completed") {
        continue;
      }

      if (dispatchedExecutionTraceRef.current.has(message._id)) {
        continue;
      }

      const trace = extractExecutionTrace(message.reasoning_details);
      if (!trace) {
        console.warn(
          "[orbit:trace] No trace found in message",
          message._id,
          message.reasoning_details,
        );
        continue;
      }

      console.info("[orbit:trace] Dispatching execution trace", {
        messageId: message._id,
        operationCount: trace.operations.length,
        resultCount: trace.operationResults.length,
        types: trace.operations.map((op) => op.type),
      });

      const detail: OrbitAiExecutionTraceEventDetail = {
        assistantMessageId: message._id,
        trace,
      };

      window.dispatchEvent(
        new CustomEvent<OrbitAiExecutionTraceEventDetail>(
          ORBIT_AI_EXECUTION_TRACE_EVENT,
          {
            detail,
          },
        ),
      );

      dispatchedExecutionTraceRef.current.add(message._id);
    }
  }, [messages]);

  const handleSend = useCallback(
    async (content: string) => {
      if (!content.trim() || isSending) return;

      setIsSending(true);
      setError(null);

      let assistantMessageId: Id<"messages"> | undefined;

      try {
        const result = await sendMessage({
          conversationId,
          content: content.trim(),
        });
        assistantMessageId = result.assistantMessageId;
        setPendingAssistantMessageId(result.assistantMessageId);

        const response = await fetch("/api/messages", {
          method: "POST",
          credentials: "include",
          headers: await buildAuthHeaders(),
          body: JSON.stringify({
            conversationId,
            userMessageId: result.userMessageId,
            assistantMessageId: result.assistantMessageId,
            message: content.trim(),
            activeFilePath,
            activeFolderPath,
          }),
        });

        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(data?.error ?? `Request failed (${response.status})`);
        }
      } catch (err) {
        const classified = classifyError(err);
        setError(classified);

        if (assistantMessageId) {
          try {
            await fetch("/api/messages/complete", {
              method: "POST",
              credentials: "include",
              headers: await buildAuthHeaders(),
              body: JSON.stringify({
                messageId: assistantMessageId,
                content: classified.message,
                status: "failed",
              }),
            });
          } catch {

          }
        }
      } finally {
        setIsSending(false);
      }
    },
    [
      activeFilePath,
      activeFolderPath,
      buildAuthHeaders,
      conversationId,
      isSending,
      sendMessage,
    ],
  );

  const handleSuggestionClick = useCallback(
    (suggestion: string) => {
      void handleSend(suggestion);
    },
    [handleSend],
  );

  const handleCancel = useCallback(
    async (messageId: Id<"messages">) => {
      setCancellingMessageId(messageId);
      setError(null);

      try {
        const response = await fetch("/api/messages/cancel", {
          method: "POST",
          credentials: "include",
          headers: await buildAuthHeaders(),
          body: JSON.stringify({
            assistantMessageId: messageId,
          }),
        });

        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(data?.error ?? `Cancel failed (${response.status})`);
        }
      } catch (err) {
        setError(classifyError(err));
      } finally {
        setCancellingMessageId(null);
      }
    },
    [buildAuthHeaders],
  );

  const handleCancelActiveMessage = useCallback(() => {
    if (!activeAssistantMessageId || isCancellingActiveAssistant) {
      return;
    }
    void handleCancel(activeAssistantMessageId);
  }, [activeAssistantMessageId, handleCancel, isCancellingActiveAssistant]);

  const isEmpty = !messages || messages.length === 0;

  return (
    <div className="flex h-full flex-col bg-background relative z-10 before:absolute before:inset-0 before:bg-gradient-to-t before:from-primary/5 before:to-transparent before:-z-10 before:opacity-50">
      {}
      <div className="z-20 flex h-11 flex-none items-center gap-2 border-b border-border/60 bg-background/90 px-4 shadow-sm backdrop-blur-md supports-[backdrop-filter]:bg-background/75">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Back to conversations"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <div className="flex min-w-0 items-center gap-2">
          <div className="rounded-md bg-primary/10 p-1">
            <SparklesIcon className="size-3.5 text-primary" />
          </div>
          <span className="truncate text-[13px] font-semibold tracking-tight text-foreground">
            {conversation?.title ?? "Orbit AI"}
          </span>
        </div>
      </div>

      {}
      <Conversation className="flex-1 bg-transparent">
        <ConversationContent className="gap-6 px-4 py-6">
          {isEmpty && !isSending ? (
            <ConversationEmptyState
              title="Start a conversation"
              description="Ask Orbit AI about your code, architecture, or anything else."
              icon={
                <div className="rounded-2xl border border-border bg-card p-5 shadow-sm ring-1 ring-primary/5">
                  <BotIcon className="mx-auto size-9 text-primary" />
                </div>
              }
            >
              <div className="mt-5 flex max-w-[320px] flex-col items-center gap-5">
                <p className="text-center text-[13px] leading-relaxed text-muted-foreground">
                  Ask about architecture, debugging, refactors — Orbit applies
                  changes in your workspace when you need it.
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {STARTER_SUGGESTIONS.map((s) => (
                    <Suggestion
                      key={s}
                      suggestion={s}
                      onClick={handleSuggestionClick}
                      className="h-9 rounded-full border border-border bg-card px-3.5 text-[12px] font-medium text-muted-foreground shadow-sm transition-colors hover:border-primary/35 hover:bg-muted hover:text-foreground"
                    />
                  ))}
                </div>
              </div>
            </ConversationEmptyState>
          ) : (
            messages?.map((msg) => (
              <ChatMessage
                key={msg._id}
                role={msg.role}
                content={msg.content}
                status={msg.status}
                reasoningDetails={msg.reasoning_details}
              />
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton className="bg-card border-border hover:bg-muted shadow-md" />
      </Conversation>

      {}
      {error && (
        <div className="flex flex-col gap-2 border-t border-destructive/20 bg-destructive/5 px-4 py-3 text-[12px]">
          <div className="flex items-start gap-2.5">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
            <span className="font-medium leading-relaxed text-destructive">
              {error.message}
            </span>
            <button
              type="button"
              className="ml-auto shrink-0 rounded-md p-1 text-destructive/70 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
          {error.retryable && (
            <button
              type="button"
              className="self-start ml-6 text-[11px] font-semibold text-primary hover:text-primary/80 "
              onClick={() => setError(null)}
            >
              Dismiss and try again
            </button>
          )}
        </div>
      )}

      {}
      {isLimitReached ? (
        <div className="z-20 border-t border-amber-500/25 bg-amber-500/[0.06] p-4 backdrop-blur-sm">
          <div className="flex items-start gap-3">
            <div className="shrink-0 rounded-full bg-amber-500/12 p-2 ring-1 ring-amber-500/20">
              <LockIcon className="size-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-foreground">
                AI limit reached
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                You&apos;ve used {aiAccess?.count}/{aiAccess?.limit} projects on
                the{" "}
                <span className="font-semibold text-foreground capitalize">
                  {aiAccess?.tier}
                </span>{" "}
                plan. Upgrade to continue using AI.
              </p>
              <button
                type="button"
                onClick={() => router.push("/pricing")}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[12px] font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <SparklesIcon className="size-3" />
                Upgrade Plan
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="z-20 border-t border-border/60 bg-background/90 p-3 backdrop-blur-md supports-[backdrop-filter]:bg-background/80">
          <PromptInput
            onSubmit={(msg) => {
              void handleSend(msg.text);
            }}
            className="w-full relative shadow-sm"
          >
            <PromptInputTextarea
              placeholder="Ask Orbit AI..."
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing &&
                  activeAssistantMessageId
                ) {
                  event.preventDefault();
                  handleCancelActiveMessage();
                }
              }}
              className="min-h-12 max-h-32 text-[13px] bg-transparent text-foreground placeholder:text-muted-foreground px-3 py-2"
            />
            <PromptInputFooter className="mt-2.5 px-1">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground/70">
                <SparklesIcon className="size-3.5 text-primary/70" />
                <span>Orbit AI</span>
              </div>
              <PromptInputSubmit
                status={activeAssistantMessageId ? "streaming" : undefined}
                onStop={
                  activeAssistantMessageId
                    ? handleCancelActiveMessage
                    : undefined
                }
                disabled={
                  !activeAssistantMessageId && isSending
                    ? true
                    : isCancellingActiveAssistant
                }
                className={cn(
                  "text-primary-foreground font-medium rounded-lg h-8  shadow-sm",
                  activeAssistantMessageId
                    ? "bg-muted hover:bg-muted/80 text-foreground w-auto px-3 text-[11px] border border-border"
                    : "bg-primary hover:bg-primary/90 w-8",
                )}
              >
                {activeAssistantMessageId ? (
                  isCancellingActiveAssistant ? (
                    <div className="flex items-center gap-1.5 opacity-70">
                      <Spinner className="size-3" />
                      <span>Stopping...</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                      <SquareIcon className="size-3 fill-current" />
                      <span>Stop generating</span>
                    </div>
                  )
                ) : undefined}
              </PromptInputSubmit>
            </PromptInputFooter>
          </PromptInput>
        </div>
      )}
    </div>
  );
};

export const ConversationSidebar = ({
  projectId,
}: {
  projectId: Id<"projects">;
}) => {
  const conversations = useProjectConversations(projectId);
  const createConversation = useCreateConversation();
  const deleteConversation = useDeleteConversation();
  const updateTitle = useUpdateConversationTitle();
  const conversationCount = conversations?.length ?? 0;
  const [activeConversationId, setActiveConversationId] =
    useState<Id<"conversations"> | null>(null);

  const handleCreate = useCallback(async () => {
    try {
      const id = await createConversation({
        projectId,
        title: `Chat ${conversationCount + 1}`,
      });
      setActiveConversationId(id);
    } catch {

    }
  }, [conversationCount, createConversation, projectId]);

  const handleDelete = useCallback(
    async (id: Id<"conversations">) => {
      try {
        if (activeConversationId === id) {
          setActiveConversationId(null);
        }
        await deleteConversation({ id });
      } catch {

      }
    },
    [activeConversationId, deleteConversation],
  );

  const handleRename = useCallback(
    async (id: Id<"conversations">, newTitle: string) => {
      try {
        await updateTitle({ id, title: newTitle });
      } catch {

      }
    },
    [updateTitle],
  );

  if (activeConversationId) {
    return (
      <ChatView
        conversationId={activeConversationId}
        projectId={projectId}
        onBack={() => setActiveConversationId(null)}
      />
    );
  }

  return (
    <div className="flex h-full flex-col bg-background relative z-10 border-r border-border/50 shadow-[4px_0_24px_-12px_rgba(0,0,0,0.1)]">
      {}
      <div className="relative z-20 flex h-12 flex-none items-center justify-between border-b border-border/60 bg-card/70 px-4 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-primary/10 p-1">
            <SparklesIcon className="size-4 text-primary" />
          </div>
          <span className="text-[13px] font-semibold tracking-tight text-foreground">
            Orbit AI
          </span>
        </div>
        <button
          type="button"
          onClick={handleCreate}
          className="rounded-md border border-transparent p-1.5 text-muted-foreground transition-colors hover:border-border/60 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="New conversation"
        >
          <PlusIcon className="size-4" />
        </button>
      </div>

      {}
      <div className="flex-1 overflow-y-auto p-2 scrollbar-none">
        {conversations === undefined ? (
          <div className="flex items-center justify-center py-10">
            <Shimmer duration={1.5} className="text-sm tracking-wide">
              Loading conversations...
            </Shimmer>
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center gap-5 py-16 px-4">
            <div className="rounded-2xl bg-card p-5 border border-border shadow-sm ring-1 ring-primary/5">
              <BotIcon className="size-10 text-primary" />
            </div>
            <div className="space-y-2 text-center">
              <p className="text-[14px] font-semibold text-foreground tracking-tight">
                No conversations yet
              </p>
              <p className="text-[12px] text-muted-foreground max-w-[220px] leading-relaxed">
                Start a new conversation to get AI help with your project.
              </p>
            </div>
            <button
              type="button"
              onClick={handleCreate}
              className="flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[13px] font-semibold text-primary-foreground shadow-md transition-transform hover:bg-primary/90 hover:shadow-lg active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <PlusIcon className="size-4" />
              New Conversation
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            {conversations.map((conv) => (
              <ConversationListItem
                key={conv._id}
                title={conv.title}
                isActive={activeConversationId === conv._id}
                onSelect={() => setActiveConversationId(conv._id)}
                onDelete={() => void handleDelete(conv._id)}
                onRename={(newTitle) => void handleRename(conv._id, newTitle)}
              />
            ))}
          </div>
        )}
      </div>

      {}
      {conversations && conversations.length > 0 && (
        <div className="border-t border-border/60 bg-card/40 backdrop-blur-md p-3">
          <button
            type="button"
            onClick={handleCreate}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-[13px] font-medium text-foreground shadow-sm transition-colors hover:border-primary/25 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <PlusIcon className="size-4" />
            New Conversation
          </button>
        </div>
      )}
    </div>
  );
};
