import { NextRequest, NextResponse } from "next/server";
import { getStats } from "@/lib/docker/resource-guard";
import { getClerkUserId } from "@/lib/clerk-auth";

export async function GET(request: NextRequest) {
  try {
    const userId = await getClerkUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const stats = getStats();
    return NextResponse.json(stats);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to get stats";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
