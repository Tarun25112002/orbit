"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BotIcon,
  CheckIcon,
  MessageSquareIcon,
  PencilIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
import {
  Suggestions,
  Suggestion,
} from "@/components/ai-elements/suggestion";

import {
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

// ─── Conversation List Item ───────────────────────────────────────────────────

const ConversationListItem = ({
  id,
  title,
  isActive,
  onSelect,
  onDelete,
  onRename,
}: {
  id: Id<"conversations">;
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
}: {
  role: "user" | "assistant";
  content: string;
  status?: string | null;
}) => {
  const isProcessing = status === "processing";
  const isFailed = status === "failed";

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
        ) : role === "assistant" ? (
          <MessageResponse>{content}</MessageResponse>
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
  const messages = useMessages(conversationId);
  const sendMessage = useSendMessage();
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = useCallback(
    async (content: string) => {
      if (!content.trim() || isSending) return;

      setIsSending(true);
      setError(null);

      try {
        const { assistantMessageId } = await sendMessage({
          conversationId,
          content: content.trim(),
        });

        const response = await fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId,
            message: content.trim(),
          }),
        });

        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(data?.error ?? `Request failed (${response.status})`);
        }

        const data = (await response.json()) as { content: string };

        await fetch("/api/messages/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messageId: assistantMessageId,
            content: data.content,
            status: "completed",
          }),
        });
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Failed to send message";
        setError(msg);
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
        <div className="flex items-center gap-1.5">
          <SparklesIcon className="size-3.5 text-[#007acc]" />
          <span className="text-xs font-medium text-[#cccccc]">Orbit AI</span>
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
              />
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton className="bg-[#252526] border-[#3e3e42] hover:bg-[#2a2d2e]" />
      </Conversation>

      {/* Error */}
      {error && (
        <div className="px-3 py-1.5 text-[11px] text-red-400 bg-red-400/5 border-t border-red-400/20 flex items-center gap-2">
          <XIcon className="size-3 shrink-0" />
          <span className="truncate">{error}</span>
          <button
            type="button"
            className="ml-auto text-red-300 hover:text-red-200 shrink-0"
            onClick={() => setError(null)}
          >
            <XIcon className="size-3" />
          </button>
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
            className="min-h-10 max-h-32 text-xs bg-[#3c3c3c] border-[#3e3e42] text-[#cccccc] placeholder:text-[#5a5a5a] focus:border-[#007acc] rounded-md"
          />
          <PromptInputFooter className="mt-1.5">
            <div className="flex items-center gap-1 text-[10px] text-[#5a5a5a]">
              <SparklesIcon className="size-3" />
              <span>Orbit AI</span>
            </div>
            <PromptInputSubmit
              disabled={isSending}
              className="bg-[#007acc] hover:bg-[#0065a9] text-white rounded-md h-7 w-7"
            />
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
  const [activeConversationId, setActiveConversationId] =
    useState<Id<"conversations"> | null>(null);

  const handleCreate = useCallback(async () => {
    try {
      const id = await createConversation({
        projectId,
        title: `Chat ${(conversations?.length ?? 0) + 1}`,
      });
      setActiveConversationId(id);
    } catch {
      // Error handled by Convex
    }
  }, [createConversation, conversations?.length, projectId]);

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
                id={conv._id}
                title={conv.title}
                isActive={activeConversationId === conv._id}
                onSelect={() => setActiveConversationId(conv._id)}
                onDelete={() => void handleDelete(conv._id)}
                onRename={(newTitle) =>
                  void handleRename(conv._id, newTitle)
                }
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
