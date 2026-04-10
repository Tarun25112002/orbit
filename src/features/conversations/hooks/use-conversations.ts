import { useMutation, useQuery } from "convex/react";
import { useCallback, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export const useConversation = (id: Id<"conversations"> | null) => {
  return useQuery(api.conversations.getById, id ? { id } : "skip");
};

export const useProjectConversations = (projectId: Id<"projects"> | null) => {
  return useQuery(
    api.conversations.getProject,
    projectId ? { projectId } : "skip",
  );
};

export const useMessages = (conversationId: Id<"conversations"> | null) => {
  return useQuery(
    api.conversations.getMessages,
    conversationId ? { conversationId } : "skip",
  );
};

export const useCreateConversation = () => {
  return useMutation(api.conversations.create);
};

export const useDeleteConversation = () => {
  return useMutation(api.conversations.deleteConversation);
};

export const useUpdateConversationTitle = () => {
  return useMutation(api.conversations.updateTitle);
};

export const useSendMessage = () => {
  return useMutation(api.conversations.sendMessage);
};

export type ChatStatus = "idle" | "sending" | "error";

export const useChatActions = (conversationId: Id<"conversations"> | null) => {
  const sendMessage = useSendMessage();
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    async (content: string) => {
      if (!conversationId || !content.trim()) return;

      setStatus("sending");
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

        const internalKey = undefined;

        const updateResponse = await fetch("/api/messages/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messageId: assistantMessageId,
            content: data.content,
            status: "completed",
          }),
        });

        if (!updateResponse.ok) {
          throw new Error("Failed to save AI response");
        }

        setStatus("idle");
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to send message";
        setError(message);
        setStatus("error");
      }
    },
    [conversationId, sendMessage],
  );

  return { send, status, error };
};