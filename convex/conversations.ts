import { v } from "convex/values";
import { mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { verifyAuth } from "./auth";
import type { Id } from "./_generated/dataModel";

const requireProjectAccess = async (
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
  ownerId: string,
) => {
  const project = await ctx.db.get(projectId);
  if (!project) {
    throw new Error("Project not found");
  }
  if (project.ownerId !== ownerId) {
    throw new Error("Unauthorized to access this project");
  }
  return project;
};

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    await requireProjectAccess(ctx, args.projectId, identity.subject);

    const conversationId = await ctx.db.insert("conversations", {
      projectId: args.projectId,
      title: args.title,
      updatedAt: Date.now(),
    });
    return conversationId;
  },
});

export const getById = query({
  args: {
    id: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    const conversation = await ctx.db.get(args.id);
    if (!conversation) {
      throw new Error("Conversation not found");
    }
    await requireProjectAccess(ctx, conversation.projectId, identity.subject);
    return conversation;
  },
});

export const getProject = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    await requireProjectAccess(ctx, args.projectId, identity.subject);

    return await ctx.db
      .query("conversations")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .collect();
  },
});

export const getMessages = query({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) {
      throw new Error("Conversation not found");
    }
    await requireProjectAccess(ctx, conversation.projectId, identity.subject);

    return await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("asc")
      .collect();
  },
});

export const getProcessingStatus = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    await requireProjectAccess(ctx, args.projectId, identity.subject);

    const processingMessage = await ctx.db
      .query("messages")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", args.projectId).eq("status", "processing"),
      )
      .first();

    return processingMessage !== null;
  },
});

export const sendMessage = mutation({
  args: {
    conversationId: v.id("conversations"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) {
      throw new Error("Conversation not found");
    }
    await requireProjectAccess(ctx, conversation.projectId, identity.subject);

    const userMessageId = await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      projectId: conversation.projectId,
      role: "user",
      content: args.content,
    });

    const assistantMessageId = await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      projectId: conversation.projectId,
      role: "assistant",
      content: "",
      status: "processing",
    });

    await ctx.db.patch(args.conversationId, {
      updatedAt: Date.now(),
    });

    return { userMessageId, assistantMessageId };
  },
});

export const updateTitle = mutation({
  args: {
    id: v.id("conversations"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    const conversation = await ctx.db.get(args.id);
    if (!conversation) {
      throw new Error("Conversation not found");
    }
    await requireProjectAccess(ctx, conversation.projectId, identity.subject);

    await ctx.db.patch(args.id, {
      title: args.title.trim(),
      updatedAt: Date.now(),
    });
  },
});

export const deleteConversation = mutation({
  args: {
    id: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    const conversation = await ctx.db.get(args.id);
    if (!conversation) {
      throw new Error("Conversation not found");
    }
    await requireProjectAccess(ctx, conversation.projectId, identity.subject);

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.id),
      )
      .collect();

    for (const message of messages) {
      await ctx.db.delete(message._id);
    }

    await ctx.db.delete(args.id);
  },
});
