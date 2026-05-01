import { useMutation, useQuery } from "convex/react";
import { useCallback, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { classifyError } from "@/lib/errors";

export const useConversation = (id: Id<"conversations"> | null) => {
  return useQuery(api.conversations.getById, id ? { id } : "skip");
};

export const useProjectConversations = (projectId: Id<"projects"> | null) => {
  return useQuery(
    api.conversations.getProject,
    projectId ? { projectId } : "skip",
  );
};

export const useIsProjectProcessing = (projectId: Id<"projects"> | null) => {
  return useQuery(
    api.conversations.getProcessingStatus,
    projectId ? { projectId } : "skip",
  ) ?? false;
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
  const { getToken } = useAuth();
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<string | null>(null);

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

  const send = useCallback(
    async (content: string) => {
      if (!conversationId || !content.trim()) return;

      setStatus("sending");
      setError(null);

      try {
        let assistantMessageId: string | undefined;

        try {
          const result = await sendMessage({
            conversationId,
            content: content.trim(),
          });
          assistantMessageId = result.assistantMessageId;

          const response = await fetch("/api/messages", {
            method: "POST",
            credentials: "include",
            headers: await buildAuthHeaders(),
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
            throw new Error(
              data?.error ?? `Request failed (${response.status})`,
            );
          }

          setStatus("idle");
        } catch (err) {
          // Mark assistant message as failed
          if (assistantMessageId) {
            try {
              await fetch("/api/messages/complete", {
                method: "POST",
                credentials: "include",
                headers: await buildAuthHeaders(),
                body: JSON.stringify({
                  messageId: assistantMessageId,
                  content:
                    err instanceof Error
                      ? err.message
                      : "Failed to send message",
                  status: "failed",
                }),
              });
            } catch {
              // Best-effort cleanup
            }
          }
          throw err;
        }
      } catch (err) {
        const classified = classifyError(err);
        setError(classified.message);
        setStatus("error");
      }
    },
    [buildAuthHeaders, conversationId, sendMessage],
  );

  return { send, status, error };
};
