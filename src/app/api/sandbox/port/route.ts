import { NextRequest, NextResponse } from "next/server";
import { getMappedPort } from "@/lib/docker/session-manager";

const PREVIEW_PROXY_HEALTH_TIMEOUT_MS = 1_500;

const buildDirectPreviewUrl = (hostPort: number) => {
  const host = process.env.ORBIT_HOST || "localhost";
  const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
  return `${protocol}://${host}:${hostPort}`;
};

const isPreviewProxyReachable = async (proxyBase: string) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, PREVIEW_PROXY_HEALTH_TIMEOUT_MS);

  try {
    const response = await fetch(`${proxyBase}/`, {
      method: "HEAD",
      signal: controller.signal,
      cache: "no-store",
    });

    return response.status >= 200 && response.status < 600;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const sessionId = searchParams.get("sessionId");
    const port = searchParams.get("port");

    if (!sessionId || !port) {
      return NextResponse.json(
        { error: "sessionId and port query params are required" },
        { status: 400 },
      );
    }

    const containerPort = parseInt(port, 10);
    if (isNaN(containerPort)) {
      return NextResponse.json(
        { error: "port must be a number" },
        { status: 400 },
      );
    }

    const hostPort = await getMappedPort(sessionId, containerPort);

    if (hostPort === null) {
      return NextResponse.json(
        { error: "Port not mapped or session not found" },
        { status: 404 },
      );
    }

    const proxyBase = process.env.NEXT_PUBLIC_PREVIEW_BASE_URL?.trim();
    let url = buildDirectPreviewUrl(hostPort);

    if (proxyBase) {
      const normalizedProxyBase = proxyBase.replace(/\/$/, "");
      const proxyInitUrl = `${normalizedProxyBase}/__orbit_proxy_init?sessionId=${encodeURIComponent(sessionId)}&port=${containerPort}`;

      const proxyReachable = await isPreviewProxyReachable(normalizedProxyBase);
      if (proxyReachable) {
        url = proxyInitUrl;
      } else {
        console.warn(
          "[sandbox/port] Preview proxy unavailable; falling back to direct host port URL",
          {
            proxyBase: normalizedProxyBase,
            sessionId,
            containerPort,
            hostPort,
          },
        );
      }
    }

    return NextResponse.json({ port: hostPort, url });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to get port";
    console.error("[sandbox/port]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
