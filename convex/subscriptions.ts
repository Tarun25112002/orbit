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
    const byOwner = () =>
      ctx.db
        .query("subscriptions")
        .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId));

    const existingBySession = await byOwner()
      .filter((q) => q.eq(q.field("stripeSessionId"), args.stripeSessionId))
      .first();

    if (existingBySession) {
      if (
        existingBySession.status !== "active" ||
        existingBySession.tier !== args.tier ||
        (args.stripePaymentIntentId &&
          existingBySession.stripePaymentIntentId !==
            args.stripePaymentIntentId)
      ) {
        await ctx.db.patch(existingBySession._id, {
          tier: args.tier,
          status: "active",
          stripeSessionId: args.stripeSessionId,
          stripePaymentIntentId:
            args.stripePaymentIntentId ??
            existingBySession.stripePaymentIntentId,
          updatedAt: Date.now(),
        });
      }

      return existingBySession._id;
    }

    const existingActive = await byOwner()
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();

    if (existingActive) {
      await ctx.db.patch(existingActive._id, {
        tier: args.tier,
        stripeSessionId: args.stripeSessionId,
        stripePaymentIntentId:
          args.stripePaymentIntentId ?? existingActive.stripePaymentIntentId,
        status: "active",
        updatedAt: Date.now(),
      });

      return existingActive._id;
    }

    const pending = await byOwner()
      .filter((q) => q.eq(q.field("status"), "pending"))
      .first();

    if (pending) {
      await ctx.db.patch(pending._id, {
        tier: args.tier,
        stripeSessionId: args.stripeSessionId,
        stripePaymentIntentId:
          args.stripePaymentIntentId ?? pending.stripePaymentIntentId,
        status: "active",
        updatedAt: Date.now(),
      });

      return pending._id;
    }

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
