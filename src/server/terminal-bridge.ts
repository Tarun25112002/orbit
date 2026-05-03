import { WebSocketServer, WebSocket } from "ws";
import Docker from "dockerode";
import {
  getContainer,
  touchSession,
  cleanupOrphanedContainers,
} from "../lib/docker/session-manager";

const WS_PORT = parseInt(process.env.ORBIT_WS_PORT || "3001", 10);

interface AttachMessage {
  type: "attach";
  sessionId: string;
}

interface InputMessage {
  type: "input";
  data: string;
}

interface ResizeMessage {
  type: "resize";
  cols: number;
  rows: number;
}

type ClientMessage = AttachMessage | InputMessage | ResizeMessage;

interface SessionAttachment {
  sessionId: string;
  exec: Docker.Exec;
  execStream: NodeJS.ReadWriteStream;
}

function parseMessage(raw: string): ClientMessage | null {
  try {
    const msg = JSON.parse(raw) as Record<string, unknown>;

    if (msg.type === "attach" && typeof msg.sessionId === "string") {
      return { type: "attach", sessionId: msg.sessionId };
    }

    if (msg.type === "input" && typeof msg.data === "string") {
      return { type: "input", data: msg.data };
    }

    if (
      msg.type === "resize" &&
      typeof msg.cols === "number" &&
      typeof msg.rows === "number"
    ) {
      return { type: "resize", cols: msg.cols, rows: msg.rows };
    }

    return null;
  } catch {
    return null;
  }
}

function send(
  ws: WebSocket,
  payload: { type: string; data?: string; code?: number; message?: string },
): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

async function attachToContainer(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<SessionAttachment> {
  const container = getContainer(sessionId);
  if (!container) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const exec = await container.exec({
    Cmd: ["/bin/bash", "-l"],
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    Env: [
      "TERM=xterm-256color",
      `COLUMNS=${cols}`,
      `LINES=${rows}`,
    ],
    WorkingDir: "/workspace",
  });

  const execStream = await exec.start({
    hijack: true,
    stdin: true,
    Tty: true,
  });

  return { sessionId, exec, execStream };
}

export function startTerminalBridge(): void {

  void cleanupOrphanedContainers();

  const wss = new WebSocketServer({ port: WS_PORT });

  console.info(`[orbit:terminal] WebSocket bridge listening on port ${WS_PORT}`);

  wss.on("connection", (ws: WebSocket) => {
    let attachment: SessionAttachment | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    heartbeatTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30_000);

    ws.on("message", async (raw: Buffer | string) => {
      const message = parseMessage(
        typeof raw === "string" ? raw : raw.toString("utf-8"),
      );
      if (!message) return;

      switch (message.type) {
        case "attach": {
          if (attachment) {

            attachment.execStream.removeAllListeners();
            try {
              attachment.execStream.end();
            } catch {

            }
          }

          try {
            attachment = await attachToContainer(
              message.sessionId,
              80,
              24,
            );

            touchSession(message.sessionId);

            attachment.execStream.on("data", (chunk: Buffer) => {
              send(ws, { type: "output", data: chunk.toString("utf-8") });
              touchSession(message.sessionId);
            });

            attachment.execStream.on("end", () => {
              send(ws, { type: "exit", code: 0 });
            });

            attachment.execStream.on("error", (err: Error) => {
              send(ws, { type: "error", message: err.message });
            });

            send(ws, {
              type: "output",
              data: `\r\n\x1b[32m● Connected to sandbox ${message.sessionId}\x1b[0m\r\n\r\n`,
            });
          } catch (error) {
            const msg =
              error instanceof Error ? error.message : "Failed to attach";
            send(ws, { type: "error", message: msg });
          }
          break;
        }

        case "input": {
          if (attachment) {
            try {
              attachment.execStream.write(message.data);
              touchSession(attachment.sessionId);
            } catch {
              send(ws, {
                type: "error",
                message: "Failed to write to container stdin",
              });
            }
          }
          break;
        }

        case "resize": {
          if (attachment) {
            try {
              await attachment.exec.resize({
                h: message.rows,
                w: message.cols,
              });
            } catch {

            }
          }
          break;
        }
      }
    });

    ws.on("close", () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }

      if (attachment) {
        try {
          attachment.execStream.end();
        } catch {

        }
        attachment = null;
      }
    });

    ws.on("error", () => {
      if (attachment) {
        try {
          attachment.execStream.end();
        } catch {

        }
        attachment = null;
      }
    });
  });
}

if (require.main === module) {
  startTerminalBridge();
}
