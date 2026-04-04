import { type NextRequest, NextResponse } from "next/server";
import { suggestionRuntime } from "@/lib/completion-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

const sendEvent = (
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: string,
  data: unknown,
) => {
  controller.enqueue(
    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
  );
};

const streamSuggestionChunks = async (
  controller: ReadableStreamDefaultController<Uint8Array>,
  suggestion: string,
) => {
  const chunkSize = 48;

  for (let index = 0; index < suggestion.length; index += chunkSize) {
    const nextSuggestion = suggestion.slice(0, index + chunkSize);
    sendEvent(controller, "chunk", {
      suggestion: nextSuggestion,
    });
    await Promise.resolve();
  }
};

export async function GET(request: NextRequest) {
  const requestId = request.nextUrl.searchParams.get("requestId")?.trim();
  const token = request.nextUrl.searchParams.get("token")?.trim();

  if (!requestId || !token) {
    return NextResponse.json(
      {
        error: "Missing requestId or token.",
      },
      { status: 400 },
    );
  }

  const record = suggestionRuntime.validateRequest(requestId, token);
  if (!record) {
    return NextResponse.json(
      {
        error: "Suggestion request not found.",
      },
      { status: 404 },
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | null = null;

      const cleanup = () => {
        if (closed) {
          return;
        }

        closed = true;
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        unsubscribe();
        request.signal.removeEventListener("abort", cleanup);
        controller.close();
      };

      const pushSnapshot = async () => {
        const snapshot = suggestionRuntime.validateRequest(requestId, token);
        if (!snapshot) {
          sendEvent(controller, "failure", {
            error: "Suggestion request not found.",
          });
          cleanup();
          return;
        }

        sendEvent(controller, "status", suggestionRuntime.toApiResponse(snapshot));

        if (snapshot.status === "completed") {
          await streamSuggestionChunks(controller, snapshot.suggestion);
          sendEvent(controller, "complete", suggestionRuntime.toApiResponse(snapshot));
          cleanup();
        } else if (snapshot.status === "failed") {
          sendEvent(controller, "failure", suggestionRuntime.toApiResponse(snapshot));
          cleanup();
        }
      };

      const unsubscribe = suggestionRuntime.subscribe(requestId, () => {
        void pushSnapshot();
      });

      heartbeat = setInterval(() => {
        const snapshot = suggestionRuntime.validateRequest(requestId, token);
        if (!snapshot || closed) {
          cleanup();
          return;
        }

        sendEvent(controller, "ping", {
          status: snapshot.status,
          queuePosition: snapshot.queuePosition,
        });
      }, suggestionRuntime.getHeartbeatIntervalMs());

      request.signal.addEventListener("abort", cleanup, { once: true });
      void pushSnapshot();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
