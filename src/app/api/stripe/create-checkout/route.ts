import { NextResponse, NextRequest } from "next/server";
import Stripe from "stripe";
import { getAuth } from "@clerk/nextjs/server";

const TIER_CONFIG: Record<string, { name: string; amount: number; description: string; currency: string }> = {
  basic: {
    name: "Orbit Basic Plan",
    amount: 100000, // ₹1000 in paisa
    description: "10 AI projects with standard model access",
    currency: "inr",
  },
  pro: {
    name: "Orbit Pro Plan",
    amount: 250000, // ₹2500 in paisa
    description: "50 AI projects with advanced model access",
    currency: "inr",
  },
  advance: {
    name: "Orbit Advanced Plan",
    amount: 500000, // ₹5000 in paisa
    description: "Unlimited AI projects with all models and team features",
    currency: "inr",
  },
};

export async function POST(req: NextRequest) {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { tier } = await req.json();

    if (!tier || !TIER_CONFIG[tier]) {
      return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
    }

    const config = TIER_CONFIG[tier];

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2025-03-31.basil",
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
      success_url: `${baseUrl}/dashboard?payment=success`,
      cancel_url: `${baseUrl}/pricing?payment=cancelled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    console.error("Stripe Checkout Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
