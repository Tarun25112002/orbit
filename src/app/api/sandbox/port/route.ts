/**
 * GET /api/sandbox/port — Get the mapped host port for a container port.
 */

import { NextRequest, NextResponse } from "next/server";
import { getMappedPort } from "@/lib/docker/session-manager";

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

    // The host URL uses the server's IP/hostname
    const host = process.env.ORBIT_HOST || "localhost";
    const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
    const url = `${protocol}://${host}:${hostPort}`;

    return NextResponse.json({ port: hostPort, url });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to get port";
    console.error("[sandbox/port]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
