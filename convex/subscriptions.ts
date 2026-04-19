import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { verifyAuth } from "./auth";

export const getActive = query({
  args: {},
  handler: async (ctx) => {
    try {
      const identity = await verifyAuth(ctx);
      const sub = await ctx.db
        .query("subscriptions")
        .withIndex("by_owner", (q) => q.eq("ownerId", identity.subject))
        .filter((q) => q.eq(q.field("status"), "active"))
        .first();
      return sub ?? null;
    } catch {
      return null;
    }
  },
});

// Called by the Stripe webhook after a successful checkout.
// Intentionally skips verifyAuth — only called from our secure server-side webhook handler.
export const activate = mutation({
  args: {
    ownerId: v.string(),
    tier: v.union(v.literal("basic"), v.literal("pro"), v.literal("advance")),
    stripeSessionId: v.string(),
    stripePaymentIntentId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Prevent duplicate activations
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();

    if (existing) return existing._id;

    // Clean up any pending records
    const pending = await ctx.db
      .query("subscriptions")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .first();

    if (pending) await ctx.db.delete(pending._id);

    const subId = await ctx.db.insert("subscriptions", {
      ownerId: args.ownerId,
      tier: args.tier,
      stripeSessionId: args.stripeSessionId,
      stripePaymentIntentId: args.stripePaymentIntentId,
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return subId;
  },
});
