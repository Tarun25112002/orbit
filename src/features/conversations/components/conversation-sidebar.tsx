"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangleIcon,
  BotIcon,
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
    <div className="mt-2.5 rounded-md border border-[#2d2d2d] bg-[#252526]/70 p-2.5 text-[11px]">
      <div className="mb-1.5 text-[10px] font-medium tracking-wide text-[#9cdcfe] uppercase">
        Execution Pipeline
      </div>
      <div className="space-y-1">
        {trace.operationResults.map((result, index) => {
          const statusColor =
            result.status === "applied"
              ? "text-emerald-300"
              : result.status === "failed"
                ? "text-red-300"
                : "text-amber-300";

          return (
            <div
              key={`${index}:${result.status}:${result.message}`}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 text-[#c7c7c7]"
            >
              <span className="text-[#858585]">{index + 1}.</span>
              <div className="min-w-0">
                <div className="break-all">
                  {describePipelineOperation(result.operation)}
                </div>
                {result.message ? (
                  <div className="text-[#7f7f7f]">{result.message}</div>
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
        "group relative flex items-center gap-2 rounded-md px-2.5 py-2 text-xs transition-colors cursor-pointer",
        isActive
          ? "bg-[#37373d] text-[#ffffff]"
          : "text-[#cccccc] hover:bg-[#2a2d2e]",
      )}
      onClick={isEditing ? undefined : onSelect}
    >
      <MessageSquareIcon className="size-3.5 shrink-0 opacity-60" />

      {isEditing ? (
        <input
          ref={inputRef}
          className="min-w-0 flex-1 rounded border border-[#007acc] bg-[#3c3c3c] px-1.5 py-0.5 text-xs text-[#cccccc] outline-none"
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
        <span className="min-w-0 flex-1 truncate">{title}</span>
      )}

      {!isEditing && (
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            className="rounded p-0.5 hover:bg-[#ffffff15]"
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
            className="rounded p-0.5 hover:bg-[#ffffff15] text-red-400"
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
        ) : role === "assistant" && isFailed ? (
          <div className="flex items-center gap-2 text-red-400 text-sm">
            <XIcon className="size-3.5" />
            <span>Failed to generate response</span>
          </div>
        ) : role === "assistant" && isCancelled ? (
          <div className="flex items-center gap-2 text-[#858585] text-sm">
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
  onBack,
}: {
  conversationId: Id<"conversations">;
  onBack: () => void;
}) => {
  const conversation = useConversation(conversationId);
  const messages = useMessages(conversationId);
  const sendMessage = useSendMessage();
  const [isSending, setIsSending] = useState(false);
  const [pendingAssistantMessageId, setPendingAssistantMessageId] =
    useState<Id<"messages"> | null>(null);
  const [cancellingMessageId, setCancellingMessageId] =
    useState<Id<"messages"> | null>(null);
  const [error, setError] = useState<ClassifiedError | null>(null);
  const dispatchedExecutionTraceRef = useRef<Set<Id<"messages">>>(new Set());
  const hasHydratedTraceDispatchRef = useRef(false);

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
        console.warn("[orbit:trace] No trace found in message", message._id, message.reasoning_details);
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
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId,
            userMessageId: result.userMessageId,
            assistantMessageId: result.assistantMessageId,
            message: content.trim(),
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
              headers: { "Content-Type": "application/json" },
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
    [conversationId, isSending, sendMessage],
  );

  const handleSuggestionClick = useCallback(
    (suggestion: string) => {
      void handleSend(suggestion);
    },
    [handleSend],
  );

  const handleCancel = useCallback(async (messageId: Id<"messages">) => {
    setCancellingMessageId(messageId);
    setError(null);

    try {
      const response = await fetch("/api/messages/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
  }, []);

  const handleCancelActiveMessage = useCallback(() => {
    if (!activeAssistantMessageId || isCancellingActiveAssistant) {
      return;
    }
    void handleCancel(activeAssistantMessageId);
  }, [activeAssistantMessageId, handleCancel, isCancellingActiveAssistant]);

  const isEmpty = !messages || messages.length === 0;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-9 items-center gap-2 border-b border-[#2d2d2d] bg-[#252526] px-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded p-0.5 text-[#858585] hover:bg-[#ffffff12] hover:text-[#cccccc] transition-colors"
          aria-label="Back to conversations"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <div className="flex min-w-0 items-center gap-1.5">
          <SparklesIcon className="size-3.5 text-[#007acc]" />
          <span className="truncate text-xs font-medium text-[#cccccc]">
            {conversation?.title ?? "Orbit AI"}
          </span>
        </div>
      </div>

      {/* Messages */}
      <Conversation className="flex-1 bg-[#1e1e1e]">
        <ConversationContent className="gap-5 px-3 py-4">
          {isEmpty && !isSending ? (
            <ConversationEmptyState
              title="Start a conversation"
              description="Ask Orbit AI about your code, architecture, or anything else."
              icon={
                <div className="rounded-xl bg-[#252526] p-4 border border-[#2d2d2d]">
                  <BotIcon className="size-8 text-[#007acc]" />
                </div>
              }
            >
              <div className="flex flex-col items-center gap-4 mt-4">
                <div className="rounded-xl bg-[#252526] p-4 border border-[#2d2d2d]">
                  <BotIcon className="size-8 text-[#007acc]" />
                </div>
                <div className="space-y-1 text-center">
                  <h3 className="font-medium text-sm text-[#cccccc]">
                    Start a conversation
                  </h3>
                  <p className="text-[#858585] text-xs max-w-[240px]">
                    Ask Orbit AI about your code, architecture, bugs, or
                    anything else.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-1.5 mt-2 max-w-[280px]">
                  {STARTER_SUGGESTIONS.map((s) => (
                    <Suggestion
                      key={s}
                      suggestion={s}
                      onClick={handleSuggestionClick}
                      className="text-[10px] h-7 px-2.5 bg-[#252526] border-[#3e3e42] text-[#cccccc] hover:bg-[#2a2d2e] hover:border-[#007acc]/40"
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
        <ConversationScrollButton className="bg-[#252526] border-[#3e3e42] hover:bg-[#2a2d2e]" />
      </Conversation>

      {/* Error */}
      {error && (
        <div className="px-3 py-2 text-[11px] bg-red-400/5 border-t border-red-400/20 flex flex-col gap-1.5">
          <div className="flex items-start gap-2">
            <AlertTriangleIcon className="size-3.5 shrink-0 text-red-400 mt-0.5" />
            <span className="text-red-300 leading-relaxed">
              {error.message}
            </span>
            <button
              type="button"
              className="ml-auto text-red-300/60 hover:text-red-200 shrink-0 p-0.5"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
            >
              <XIcon className="size-3" />
            </button>
          </div>
          {error.retryable && (
            <button
              type="button"
              className="self-start ml-5 text-[10px] text-[#007acc] hover:text-[#3794d1] hover:underline transition-colors"
              onClick={() => setError(null)}
            >
              Dismiss and try again
            </button>
          )}
        </div>
      )}

      {/* Input */}
      <div className="border-t border-[#2d2d2d] bg-[#252526] p-2.5">
        <PromptInput
          onSubmit={(msg) => {
            void handleSend(msg.text);
          }}
          className="w-full"
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
            className="min-h-10 max-h-32 text-xs bg-[#3c3c3c] border-[#3e3e42] text-[#cccccc] placeholder:text-[#5a5a5a] focus:border-[#007acc] rounded-md"
          />
          <PromptInputFooter className="mt-1.5">
            <div className="flex items-center gap-1 text-[10px] text-[#5a5a5a]">
              <SparklesIcon className="size-3" />
              <span>Orbit AI</span>
            </div>
            <PromptInputSubmit
              status={activeAssistantMessageId ? "streaming" : undefined}
              onStop={
                activeAssistantMessageId ? handleCancelActiveMessage : undefined
              }
              disabled={
                !activeAssistantMessageId && isSending
                  ? true
                  : isCancellingActiveAssistant
              }
              className={cn(
                "text-white rounded-md h-7",
                activeAssistantMessageId
                  ? "bg-[#3e3e42] hover:bg-[#4a4a50] w-auto px-2.5 text-[10px]"
                  : "bg-[#007acc] hover:bg-[#0065a9] w-7",
              )}
              >
              {activeAssistantMessageId ? undefined : undefined}
            </PromptInputSubmit>
          </PromptInputFooter>
        </PromptInput>
      </div>
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
        onBack={() => setActiveConversationId(null)}
      />
    );
  }

  // Otherwise show the conversation list
  return (
    <div className="flex h-full flex-col bg-[#252526]">
      {/* Header */}
      <div className="flex h-9 items-center justify-between border-b border-[#2d2d2d] px-3">
        <div className="flex items-center gap-1.5">
          <SparklesIcon className="size-3.5 text-[#007acc]" />
          <span className="text-xs font-medium tracking-wide text-[#cccccc] uppercase">
            Orbit AI
          </span>
        </div>
        <button
          type="button"
          onClick={handleCreate}
          className="rounded p-1 text-[#858585] hover:bg-[#ffffff12] hover:text-[#cccccc] transition-colors"
          aria-label="New conversation"
        >
          <PlusIcon className="size-3.5" />
        </button>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto p-1.5">
        {conversations === undefined ? (
          <div className="flex items-center justify-center py-8">
            <Shimmer duration={1.5}>Loading conversations...</Shimmer>
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-12 px-4">
            <div className="rounded-xl bg-[#1e1e1e] p-4 border border-[#2d2d2d]">
              <BotIcon className="size-8 text-[#007acc]" />
            </div>
            <div className="space-y-1.5 text-center">
              <p className="text-xs font-medium text-[#cccccc]">
                No conversations yet
              </p>
              <p className="text-[10px] text-[#858585] max-w-[200px]">
                Start a new conversation to get AI help with your project.
              </p>
            </div>
            <button
              type="button"
              onClick={handleCreate}
              className="flex items-center gap-1.5 rounded-md bg-[#007acc] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#0065a9] transition-colors"
            >
              <PlusIcon className="size-3.5" />
              New Conversation
            </button>
          </div>
        ) : (
          <div className="space-y-0.5">
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
        <div className="border-t border-[#2d2d2d] p-2">
          <button
            type="button"
            onClick={handleCreate}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-[#3e3e42] bg-[#2d2d2d] px-3 py-1.5 text-xs text-[#cccccc] hover:bg-[#333333] hover:border-[#007acc]/40 transition-colors"
          >
            <PlusIcon className="size-3.5" />
            New Conversation
          </button>
        </div>
      )}
    </div>
  );
};
