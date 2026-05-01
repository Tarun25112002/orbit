"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import {
  AlertTriangleIcon,
  BotIcon,
  LockIcon,
  MessageSquareIcon,
  PencilIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
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

const ExecutionTimeline = ({ trace }: { trace: AiExecutionTrace }) => {
  if (trace.operationResults.length === 0) {
    return null;
  }

  return (
    <div className="mt-2.5 rounded-md border border-border/50 bg-card/40 backdrop-blur-sm p-2.5 text-[11px] shadow-sm">
      <div className="mb-1.5 text-[10px] font-semibold tracking-wider text-primary uppercase">
        Execution Pipeline
      </div>
      <div className="space-y-1">
        {trace.operationResults.map((result, index) => {
          const statusColor =
            result.status === "applied"
              ? "text-emerald-500"
              : result.status === "failed"
                ? "text-red-500"
                : "text-amber-500";

          return (
            <div
              key={`${index}:${result.status}:${result.message}`}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 text-foreground/80"
            >
              <span className="text-muted-foreground/70">{index + 1}.</span>
              <div className="min-w-0">
                <div className="break-all">
                  {describePipelineOperation(result.operation)}
                </div>
                {result.message ? (
                  <div className="text-muted-foreground/70">
                    {result.message}
                  </div>
                ) : null}
              </div>
              <span className={cn("font-medium uppercase", statusColor)}>
                {result.status}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── Conversation List Item ───────────────────────────────────────────────────

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
        "group relative flex items-center gap-2 rounded-md px-2.5 py-2 text-xs  cursor-pointer border border-transparent",
        isActive
          ? "bg-primary/5 text-foreground border-primary/10 shadow-sm"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
      onClick={isEditing ? undefined : onSelect}
    >
      <MessageSquareIcon className="size-3.5 shrink-0 opacity-60" />

      {isEditing ? (
        <input
          ref={inputRef}
          className="min-w-0 flex-1 rounded border border-primary bg-background px-1.5 py-0.5 text-xs text-foreground outline-none shadow-sm"
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
        <div className="flex items-center gap-0.5 opacity-0  group-hover:opacity-100">
          <button
            type="button"
            className="rounded p-0.5 hover:bg-muted/80 text-muted-foreground hover:text-foreground "
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
            className="rounded p-0.5 hover:bg-destructive/10 text-destructive/70 hover:text-destructive "
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

// ─── Chat Message ─────────────────────────────────────────────────────────────

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

  return (
    <Message from={role}>
      <MessageContent>
        {role === "assistant" && isProcessing && !content ? (
          <div className="flex items-center gap-2">
            <Shimmer duration={1.5}>Thinking...</Shimmer>
          </div>
        ) : role === "assistant" && isProcessing && content ? (
          <div className="relative">
            <div className="flex items-center gap-2 mb-2">
              <span className="relative flex size-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/60 opacity-75" />
                <span className="relative inline-flex rounded-full size-2.5 bg-primary" />
              </span>
              <span className="text-[11px] font-semibold text-primary tracking-wide uppercase">
                Executing Pipeline
              </span>
            </div>
            <MessageResponse>{content}</MessageResponse>
          </div>
        ) : role === "assistant" && isFailed ? (
          <div className="flex items-center gap-2 text-destructive/90 text-sm font-medium">
            <XIcon className="size-3.5" />
            <span>Failed to generate response</span>
          </div>
        ) : role === "assistant" && isCancelled ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm font-medium">
            <XIcon className="size-3.5" />
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

// ─── Chat View ────────────────────────────────────────────────────────────────

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
      // Fall back to cookie-based auth if token retrieval fails.
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

        // Mark assistant message as failed so it doesn't stay stuck in "processing"
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
            // Best-effort cleanup
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
      {/* Header */}
      <div className="flex flex-none h-11 items-center gap-2 border-b border-border/60 bg-background/80 backdrop-blur-md px-4 shadow-sm z-20">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/80 hover:text-foreground "
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
          <div className="p-1 rounded bg-primary/10">
            <SparklesIcon className="size-3.5 text-primary" />
          </div>
          <span className="truncate text-[13px] font-semibold text-foreground tracking-tight">
            {conversation?.title ?? "Orbit AI"}
          </span>
        </div>
      </div>

      {/* Messages */}
      <Conversation className="flex-1 bg-transparent">
        <ConversationContent className="gap-6 px-4 py-6">
          {isEmpty && !isSending ? (
            <ConversationEmptyState
              title="Start a conversation"
              description="Ask Orbit AI about your code, architecture, or anything else."
              icon={
                <div className="rounded-2xl bg-card p-4 border border-border shadow-sm">
                  <BotIcon className="size-8 text-primary" />
                </div>
              }
            >
              <div className="flex flex-col items-center gap-5 mt-4">
                <div className="rounded-2xl bg-card p-4 border border-border shadow-sm ring-1 ring-primary/5">
                  <BotIcon className="size-8 text-primary" />
                </div>
                <div className="space-y-1.5 text-center">
                  <h3 className="font-semibold text-[15px] text-foreground tracking-tight">
                    Start a conversation
                  </h3>
                  <p className="text-muted-foreground text-[13px] max-w-[240px] leading-relaxed">
                    Ask Orbit AI about your code, architecture, bugs, or
                    anything else.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2 mt-4 max-w-[300px]">
                  {STARTER_SUGGESTIONS.map((s) => (
                    <Suggestion
                      key={s}
                      suggestion={s}
                      onClick={handleSuggestionClick}
                      className="text-[11px] h-8 px-3 bg-card border-border text-muted-foreground hover:bg-muted/80 hover:text-foreground hover:border-primary/30  font-medium rounded-full shadow-sm"
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

      {/* Error */}
      {error && (
        <div className="px-4 py-3 text-[12px] bg-red-500/10 border-t border-red-500/20 flex flex-col gap-2">
          <div className="flex items-start gap-2.5">
            <AlertTriangleIcon className="size-4 shrink-0 text-red-500 mt-0.5" />
            <span className="text-red-600 dark:text-red-400 font-medium leading-relaxed">
              {error.message}
            </span>
            <button
              type="button"
              className="ml-auto text-red-500/60 hover:text-red-500 shrink-0 p-1 rounded-sm hover:bg-red-500/10 "
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

      {/* Input */}
      {isLimitReached ? (
        <div className="border-t border-amber-500/30 bg-amber-500/5 backdrop-blur-xl p-4 z-20">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-amber-500/10 p-2 shrink-0">
              <LockIcon className="size-4 text-amber-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-foreground">
                AI Limit Reached
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
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
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-[11px] font-bold text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
              >
                <SparklesIcon className="size-3" />
                Upgrade Plan
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="border-t border-border/60 bg-background/80 backdrop-blur-xl p-3 z-20">
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
                {activeAssistantMessageId ? undefined : undefined}
              </PromptInputSubmit>
            </PromptInputFooter>
          </PromptInput>
        </div>
      )}
    </div>
  );
};

// ─── Main Sidebar ─────────────────────────────────────────────────────────────

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
      // Error handled by Convex
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
        // Error handled by Convex
      }
    },
    [activeConversationId, deleteConversation],
  );

  const handleRename = useCallback(
    async (id: Id<"conversations">, newTitle: string) => {
      try {
        await updateTitle({ id, title: newTitle });
      } catch {
        // Error handled by Convex
      }
    },
    [updateTitle],
  );

  // If there's an active conversation, show the chat view
  if (activeConversationId) {
    return (
      <ChatView
        conversationId={activeConversationId}
        projectId={projectId}
        onBack={() => setActiveConversationId(null)}
      />
    );
  }

  // Otherwise show the conversation list
  return (
    <div className="flex h-full flex-col bg-background relative z-10 border-r border-border/50 shadow-[4px_0_24px_-12px_rgba(0,0,0,0.1)]">
      {/* Header */}
      <div className="flex flex-none h-12 items-center justify-between border-b border-border/60 bg-card/50 backdrop-blur-md px-4 relative z-20">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded bg-primary/10">
            <SparklesIcon className="size-4 text-primary" />
          </div>
          <span className="text-[13px] font-bold tracking-widest text-foreground uppercase">
            Orbit AI
          </span>
        </div>
        <button
          type="button"
          onClick={handleCreate}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground hover:shadow-sm  border border-transparent hover:border-border/50"
          aria-label="New conversation"
        >
          <PlusIcon className="size-4" />
        </button>
      </div>

      {/* Conversation List */}
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
              className="flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[13px] font-semibold text-primary-foreground hover:bg-primary/90  shadow-md hover:shadow-lg hover:-translate-y-[1px]"
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

      {/* Footer */}
      {conversations && conversations.length > 0 && (
        <div className="border-t border-border/60 bg-card/40 backdrop-blur-md p-3">
          <button
            type="button"
            onClick={handleCreate}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-[13px] font-medium text-foreground hover:bg-muted hover:border-primary/30  shadow-sm"
          >
            <PlusIcon className="size-4" />
            New Conversation
          </button>
        </div>
      )}
    </div>
  );
};
