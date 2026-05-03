import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getClerkUserId } from "@/lib/clerk-auth";
import { fetchMutation } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";

const VALID_TIERS = new Set(["basic", "pro", "advance"]);

export async function POST(request: NextRequest) {
  try {
    const userId = await getClerkUserId(request);

    let payload: { sessionId?: string } | null = null;
    try {
      payload = (await request.json()) as { sessionId?: string };
    } catch {
      payload = null;
    }

    const sessionId =
      payload?.sessionId ??
      request.nextUrl.searchParams.get("session_id") ??
      request.nextUrl.searchParams.get("sessionId");

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 },
      );
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2026-03-25.dahlia",
    });

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const metadataUserId =
      session.metadata?.userId ?? session.client_reference_id ?? null;
    const tier = session.metadata?.tier ?? null;

    if (!metadataUserId) {
      return NextResponse.json(
        { error: "Missing user metadata" },
        { status: 400 },
      );
    }

    if (userId && metadataUserId !== userId) {
      return NextResponse.json(
        { error: "Session does not belong to the current user" },
        { status: 403 },
      );
    }

    if (!tier || !VALID_TIERS.has(tier)) {
      return NextResponse.json(
        { error: "Missing or invalid tier metadata" },
        { status: 400 },
      );
    }

    if (session.payment_status !== "paid") {
      return NextResponse.json(
        { error: "Payment not completed", status: session.payment_status },
        { status: 409 },
      );
    }

    await fetchMutation(api.subscriptions.activate, {
      ownerId: metadataUserId,
      tier: tier as "basic" | "pro" | "advance",
      stripeSessionId: session.id,
      stripePaymentIntentId:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : undefined,
    });

    return NextResponse.json({ status: "activated", tier });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    console.error("[stripe/sync-session]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
