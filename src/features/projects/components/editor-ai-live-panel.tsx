"use client";

import { useMemo } from "react";

import { MessageResponse } from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import {
  ExecutionTimeline,
  extractExecutionTrace,
  inferAssistantPipelinePhase,
} from "@/features/conversations/components/conversation-sidebar";
import { useMessages } from "@/features/conversations/hooks/use-conversations";

import { useProjectHeaderContext } from "./project-header-context";

const RUNTIME_LOG_TAIL = 28;

export const EditorAiLivePanel = ({
  isProjectProcessing,
  isRuntimeBusy,
  runtimeLogs,
}: {
  isProjectProcessing: boolean;
  isRuntimeBusy: boolean;
  runtimeLogs: string[];
}) => {
  const { liveAiConversationId } = useProjectHeaderContext();
  const messages = useMessages(liveAiConversationId);

  const processingAssistantMessage = useMemo(
    () =>
      [...(messages ?? [])]
        .reverse()
        .find((msg) => msg.role === "assistant" && msg.status === "processing"),
    [messages],
  );

  const executionTrace = processingAssistantMessage
    ? extractExecutionTrace(processingAssistantMessage.reasoning_details)
    : null;

  const pipelinePhase =
    processingAssistantMessage?.content &&
    processingAssistantMessage.content.trimStart().length > 0
      ? inferAssistantPipelinePhase(processingAssistantMessage.content)
      : "executing";

  const runtimeTail = useMemo(
    () => runtimeLogs.slice(-RUNTIME_LOG_TAIL),
    [runtimeLogs],
  );

  const showAiSection = isProjectProcessing;
  const showRuntimeSection = isRuntimeBusy;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-3 sm:p-4">
      <div className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Live activity
      </div>

      {showAiSection ? (
        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-primary/15 bg-muted/20 p-3 ring-1 ring-primary/10">
          {messages === undefined && liveAiConversationId ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              <span>Loading messages…</span>
            </div>
          ) : !liveAiConversationId ? (
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/80 bg-muted/30 px-3 py-2.5">
              <Spinner className="size-4 text-primary" />
              <Shimmer duration={1.5}>AI is working on your project…</Shimmer>
            </div>
          ) : !processingAssistantMessage ? (
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/80 bg-muted/30 px-3 py-2.5">
              <Spinner className="size-4 text-primary" />
              <Shimmer duration={1.5}>Waiting for assistant…</Shimmer>
            </div>
          ) : !processingAssistantMessage.content ? (
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/80 bg-muted/30 px-3 py-2.5">
              <Spinner className="size-4 text-primary" />
              <Shimmer duration={1.5}>Preparing response…</Shimmer>
            </div>
          ) : (
            <>
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
              <div className="max-h-[min(50vh,22rem)] overflow-y-auto rounded-lg border border-border/40 bg-background/60 px-2.5 py-2">
                <MessageResponse>{processingAssistantMessage.content}</MessageResponse>
              </div>
              {executionTrace ? (
                <div className="mt-3">
                  <ExecutionTimeline trace={executionTrace} />
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {showRuntimeSection ? (
        <div className="flex min-h-0 shrink-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-card/80">
          <div className="border-b border-border/50 bg-muted/30 px-3 py-2 text-xs font-semibold text-foreground">
            Runtime output
          </div>
          <ScrollArea className="max-h-40">
            <pre className="whitespace-pre-wrap break-all px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
              {runtimeTail.length > 0
                ? runtimeTail.join("\n")
                : "Waiting for log output…"}
            </pre>
          </ScrollArea>
        </div>
      ) : null}
    </div>
  );
};
