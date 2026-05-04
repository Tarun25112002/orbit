import { NextResponse, NextRequest } from "next/server";
import Stripe from "stripe";
import { fetchMutation } from "convex/nextjs";
import { internal } from "../../../../../convex/_generated/api";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "No signature" }, { status: 400 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: "2026-03-25.dahlia",
  });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch (err: any) {
    console.error("Stripe webhook signature verification failed:", err.message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    const session = event.data.object as Stripe.Checkout.Session;

    if (session.payment_status && session.payment_status !== "paid") {
      return NextResponse.json({ received: true });
    }

    const userId = session.metadata?.userId ?? session.client_reference_id;
    const tier = session.metadata?.tier as
      | "basic"
      | "pro"
      | "advance"
      | undefined;

    if (!userId || !tier) {
      console.error("Missing metadata in Stripe session:", session.id);
      return NextResponse.json({ error: "Missing metadata" }, { status: 400 });
    }

    const deployKey = process.env.CONVEX_DEPLOY_KEY?.trim();
    if (!deployKey) {
      console.error("[stripe/webhook] CONVEX_DEPLOY_KEY is not set");
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 },
      );
    }

    await fetchMutation(
      internal.subscriptions.activate,
      {
        ownerId: userId,
        tier,
        stripeSessionId: session.id,
        stripePaymentIntentId:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : undefined,
      },
      { adminToken: deployKey },
    );
  }

  return NextResponse.json({ received: true });
}
