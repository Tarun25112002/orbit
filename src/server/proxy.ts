import http from "http";
import httpProxy from "http-proxy";
import { getMappedPort } from "../lib/docker/session-manager";

const PROXY_PORT = parseInt(process.env.ORBIT_PROXY_PORT || "3002", 10);
const HOST = process.env.ORBIT_HOST || "127.0.0.1";

function parseCookie(cookieString: string | undefined, name: string): string | null {
  if (!cookieString) return null;
  const match = cookieString.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

const proxy = httpProxy.createProxyServer({
  ws: true,
  xfwd: true,
});

proxy.on("error", (err, req, res) => {
  console.error(`[orbit:proxy] Error for ${req.url}:`, err.message);
  if (res && "writeHead" in res && !res.headersSent) {
    res.writeHead(502);
    res.end("Bad Gateway: " + err.message);
  }
});

async function getTargetUrl(req: http.IncomingMessage): Promise<string | null> {
  const targetCookie = parseCookie(req.headers.cookie, "orbit_proxy_target");
  if (!targetCookie) return null;

  const [sessionId, portStr] = targetCookie.split(":");
  if (!sessionId || !portStr) return null;

  const containerPort = parseInt(portStr, 10);
  if (isNaN(containerPort)) return null;

  const hostPort = await getMappedPort(sessionId, containerPort);
  if (hostPort === null) return null;

  return `http://${HOST}:${hostPort}`;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (url.pathname === "/__orbit_proxy_init") {
      const sessionId = url.searchParams.get("sessionId");
      const port = url.searchParams.get("port");

      if (sessionId && port) {

        res.setHeader(
          "Set-Cookie",
          `orbit_proxy_target=${encodeURIComponent(`${sessionId}:${port}`)}; Path=/; SameSite=Lax`,
        );

        res.writeHead(302, { Location: "/" });
        res.end();
        return;
      }
    }

    const targetUrl = await getTargetUrl(req);

    if (targetUrl) {
      proxy.web(req, res, { target: targetUrl });
    } else {
      res.writeHead(404, { "Content-Type": "text/html" });
      res.end("Not Found: Missing or invalid proxy session. Load the preview UI first.");
    }
  } catch (err) {
    console.error("[orbit:proxy] routing error:", err);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end("Internal Server Error");
    }
  }
});

server.on("upgrade", async (req, socket, head) => {
  try {
    const targetUrl = await getTargetUrl(req);
    if (targetUrl) {
      proxy.ws(req, socket, head, { target: targetUrl });
    } else {
      socket.destroy();
    }
  } catch (err) {
    console.error("[orbit:proxy] ws routing error:", err);
    socket.destroy();
  }
});

export function startProxyServer() {
  server.listen(PROXY_PORT, () => {
    console.info(`[orbit:proxy] Proxy server listening on port ${PROXY_PORT}`);
  });
}

if (require.main === module) {
  startProxyServer();
}
