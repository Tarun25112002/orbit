import { NextResponse, NextRequest } from "next/server";
import Stripe from "stripe";
import { getClerkUserId } from "@/lib/clerk-auth";

const TIER_CONFIG: Record<
  string,
  { name: string; amount: number; description: string; currency: string }
> = {
  basic: {
    name: "Orbit Basic Plan",
    amount: 100000,
    description: "10 AI projects with standard model access",
    currency: "inr",
  },
  pro: {
    name: "Orbit Pro Plan",
    amount: 250000,
    description: "50 AI projects with advanced model access",
    currency: "inr",
  },
  advance: {
    name: "Orbit Advanced Plan",
    amount: 500000,
    description: "Unlimited AI projects with all models and team features",
    currency: "inr",
  },
};

export async function POST(req: NextRequest) {
  try {
    const userId = await getClerkUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { tier } = await req.json();

    if (!tier || !TIER_CONFIG[tier]) {
      return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
    }

    const config = TIER_CONFIG[tier];

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2026-03-25.dahlia",
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: config.currency,
            product_data: {
              name: config.name,
              description: config.description,
            },
            unit_amount: config.amount,
          },
          quantity: 1,
        },
      ],
      metadata: {
        userId,
        tier,
      },
      client_reference_id: userId,
      success_url: `${baseUrl}/dashboard?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/pricing?payment=cancelled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error: unknown) {
    console.error("Stripe Checkout Error:", error);
    const safeMessage =
      process.env.NODE_ENV === "production"
        ? "Unable to start checkout"
        : error instanceof Error
          ? error.message
          : "Checkout failed";
    return NextResponse.json({ error: safeMessage }, { status: 500 });
  }
}
