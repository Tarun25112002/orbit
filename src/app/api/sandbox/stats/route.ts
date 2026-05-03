import { NextResponse } from "next/server";
import { getStats } from "@/lib/docker/resource-guard";

export async function GET() {
  try {
    const stats = getStats();
    return NextResponse.json(stats);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to get stats";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
