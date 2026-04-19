/**
 * Port Detector — watches container stdout for server-ready patterns.
 *
 * Scans output lines for common framework startup messages like
 * "listening on port 3000", "Local: http://localhost:5173", etc.
 * When detected, resolves the E2B/Docker mapped host port so the
 * frontend can show a preview URL.
 */

/** Detected server-ready event */
export interface ServerDetectedEvent {
  port: number;
  url: string;
}

type ServerReadyHandler = (event: ServerDetectedEvent) => void;

// Common patterns that frameworks print when a server starts
const PORT_PATTERNS: RegExp[] = [
  /(?:listening|started|running)\s+(?:on|at)\s+(?:port\s+)?(\d{2,5})/i,
  /(?:Local|Network):\s+https?:\/\/(?:localhost|0\.0\.0\.0|127\.0\.0\.1):(\d{2,5})/i,
  /(?:http|https):\/\/(?:localhost|0\.0\.0\.0|127\.0\.0\.1):(\d{2,5})/i,
  /port\s+(\d{2,5})\b/i,
  /:\s*(\d{4,5})\s*$/,
];

/**
 * Try to extract a port number from a line of stdout/stderr.
 *
 * @param line - A single line of terminal output
 * @returns The detected port number, or null
 */
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

/**
 * Create a port detection watcher that scans output chunks.
 *
 * Call `watcher.scan(chunk)` with each stdout/stderr chunk.
 * When a port is detected, the handler fires once (debounced).
 *
 * @param handler - Callback when a server port is detected
 * @param getHostUrl - Function that resolves a container port to a host URL
 * @returns An object with a `scan(chunk)` method and `destroy()` cleanup
 */
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
