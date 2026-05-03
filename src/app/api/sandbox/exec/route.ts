import { NextRequest } from "next/server";
import { getContainer, touchSession } from "@/lib/docker/session-manager";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      sessionId?: string;
      command?: string;
      env?: Record<string, string>;
    };

    const { sessionId, command, env } = body;

    if (!sessionId || !command) {
      return new Response(
        JSON.stringify({ error: "sessionId and command are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const container = getContainer(sessionId);
    if (!container) {
      return new Response(
        JSON.stringify({ error: `Session ${sessionId} not found` }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    touchSession(sessionId);

    const envArray = env
      ? Object.entries(env).map(([k, v]) => `${k}=${v}`)
      : undefined;

    const exec = await container.exec({
      Cmd: ["/bin/sh", "-c", command],
      AttachStdout: true,
      AttachStderr: true,
      Env: envArray,
      WorkingDir: "/workspace",
    });

    const execStream = await exec.start({ Detach: false, Tty: false });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        let closed = false;

        const sendEvent = (type: string, data: string) => {
          if (closed) return;
          try {
            const payload = JSON.stringify({ type, data });
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
          } catch {

            closed = true;
          }
        };

        const closeOnce = () => {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {

          }
        };

        execStream.on("data", (chunk: Buffer) => {
          const text = chunk.toString("utf-8");
          sendEvent("stdout", text);
        });

        execStream.on("end", () => {

          exec
            .inspect()
            .then((info) => {
              sendEvent("exit", String(info.ExitCode ?? 0));
              closeOnce();
            })
            .catch(() => {
              sendEvent("exit", "1");
              closeOnce();
            });
        });

        execStream.on("error", (err: Error) => {
          sendEvent("error", err.message);
          closeOnce();
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to execute command";
    console.error("[sandbox/exec]", message);

    if (
      /\bsession\b[\s\S]*\bnot found\b/i.test(message) ||
      /\bno such container\b|\bcontainer\b[\s\S]*\bnot found\b/i.test(message)
    ) {
      return new Response(JSON.stringify({ error: message }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
