import { NextResponse } from "next/server";
import { suggestionRuntime } from "@/lib/completion-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(suggestionRuntime.getMetrics());
}
