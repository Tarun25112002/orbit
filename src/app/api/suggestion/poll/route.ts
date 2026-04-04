import { NextResponse } from "next/server";

type InngestRunOutputEnvelope = {
  data?: unknown;
  body?: string;
  status?: number;
  headers?: Record<string, string>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const normalizeRunOutput = (output: unknown): unknown => {
  let candidate: unknown = output;

  if (isRecord(candidate) && "data" in candidate) {
    candidate = (candidate as InngestRunOutputEnvelope).data;
  }

  if (isRecord(candidate) && typeof candidate.body === "string") {
    try {
      return JSON.parse(candidate.body);
    } catch {
      return {
        suggestion: candidate.body,
        sugegstions: candidate.body,
      };
    }
  }

  return candidate;
};

const getInngestBaseUrl = () => {
  const explicit = process.env.INNGEST_BASE_URL?.trim();
  if (explicit) {
    return explicit;
  }

  return "https://api.inngest.com";
};

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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const runId = url.searchParams.get("runId")?.trim() ?? "";
  const token = url.searchParams.get("token")?.trim() ?? "";

  if (!runId || !token) {
    return NextResponse.json(
      { error: "Missing runId or token query parameter" },
      { status: 400 },
    );
  }

  try {
    const outputUrl = new URL(
      `/v1/http/runs/${encodeURIComponent(runId)}/output`,
      getInngestBaseUrl(),
    );
    outputUrl.searchParams.set("token", token);

    const upstream = await fetch(outputUrl.toString(), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!upstream.ok) {
      const errorBody = await upstream.text();
      return new NextResponse(errorBody, {
        status: upstream.status,
        headers: {
          "Content-Type": upstream.headers.get("Content-Type") ?? "text/plain",
        },
      });
    }

    const payload = (await upstream.json().catch(() => null)) as unknown;
    const normalized = normalizeRunOutput(payload);

    if (!normalized) {
      return NextResponse.json(
        { error: "Background run has no output yet" },
        { status: 202 },
      );
    }

    if (isRecord(normalized)) {
      return NextResponse.json(normalized);
    }

    return NextResponse.json({
      suggestion: String(normalized),
      sugegstions: String(normalized),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to fetch background run output",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
