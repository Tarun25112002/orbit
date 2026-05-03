export interface ServerDetectedEvent {
  port: number;
  url: string;
}

type ServerReadyHandler = (event: ServerDetectedEvent) => void;

const PORT_PATTERNS: RegExp[] = [
  /(?:listening|started|running)\s+(?:on|at)\s+(?:port\s+)?(\d{2,5})/i,
  /(?:Local|Network):\s+https?:\/\/(?:localhost|0\.0\.0\.0|127\.0\.0\.1):(\d{2,5})/i,
  /(?:http|https):\/\/(?:localhost|0\.0\.0\.0|127\.0\.0\.1):(\d{2,5})/i,
  /port\s+(\d{2,5})\b/i,
  /:\s*(\d{4,5})\s*$/,
];

export function detectPortFromLine(line: string): number | null {
  for (const pattern of PORT_PATTERNS) {
    const match = pattern.exec(line);
    if (match && match[1]) {
      const port = parseInt(match[1], 10);
      if (port >= 1024 && port <= 65535) {
        return port;
      }
    }
  }
  return null;
}

export function createPortWatcher(
  handler: ServerReadyHandler,
  getHostUrl: (port: number) => Promise<string | null>,
): { scan: (chunk: string) => void; destroy: () => void } {
  let detectedPort: number | null = null;
  let destroyed = false;

  return {
    scan(chunk: string) {
      if (destroyed || detectedPort !== null) return;

      const lines = chunk.split("\n");
      for (const line of lines) {
        const port = detectPortFromLine(line);
        if (port !== null && port !== detectedPort) {
          detectedPort = port;

          void getHostUrl(port).then((url) => {
            if (destroyed || !url) return;
            handler({ port, url });
          });

          return;
        }
      }
    },
    destroy() {
      destroyed = true;
    },
  };
}
