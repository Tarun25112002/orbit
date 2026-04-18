import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { verifyAuth } from "./auth";

export const create = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    const projectId = await ctx.db.insert("projects", {
      name: args.name,
      ownerId: identity.subject,
      updatedAt: Date.now(),
    });
    return projectId;
  },
});

export const touch = mutation({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.ownerId !== identity.subject) {
      throw new Error("Project not found");
    }
    const updatedAt = Date.now();
    await ctx.db.patch(args.projectId, { updatedAt });
    return { projectId: args.projectId, updatedAt };
  },
});

export const startGithubImport = mutation({
  args: {
    projectId: v.id("projects"),
    githubUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.ownerId !== identity.subject) {
      throw new Error("Project not found or unauthorized");
    }
    await ctx.db.patch(args.projectId, {
      importStatus: "importing",
      updatedAt: Date.now(),
    });
  },
});

export const getPartial = query({
  args: {
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    return await ctx.db
      .query("projects")
      .withIndex("by_owner_updated", (q) => q.eq("ownerId", identity.subject))
      .order("desc")
      .take(args.limit);
  },
});

export const get = query({
  args: {},
  handler: async (ctx) => {
    const identity = await verifyAuth(ctx);
    return await ctx.db
      .query("projects")
      .withIndex("by_owner_updated", (q) => q.eq("ownerId", identity.subject))
      .order("desc")
      .collect();
  },
});

export const getById = query({
  args: {
    id: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    const project = await ctx.db.get(args.id);
    // Return null instead of throwing so route/layout guards can render
    // a not-found UI without crashing client query consumers.
    if (!project || project.ownerId !== identity.subject) {
      return null;
    }
    return project;
  },
});

export const rename = mutation({
  args: {
    id: v.id("projects"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    const project = await ctx.db.get(args.id);
    if (!project) {
      throw new Error("Project not found");
    }
    if (project.ownerId !== identity.subject) {
      throw new Error("Unauthorized access to this project");
    }
    await ctx.db.patch(args.id, {
      name: args.name,
      updatedAt: Date.now(),
    });
  },
});

export const completeGithubImport = mutation({
  args: {
    projectId: v.id("projects"),
    importRepoUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.ownerId !== identity.subject) {
      throw new Error("Project not found or unauthorized");
    }
    await ctx.db.patch(args.projectId, {
      importStatus: "completed",
      importRepoUrl: args.importRepoUrl,
      updatedAt: Date.now(),
    });
  },
});

export const failGithubImport = mutation({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.ownerId !== identity.subject) {
      throw new Error("Project not found or unauthorized");
    }
    await ctx.db.patch(args.projectId, {
      importStatus: "failed",
      updatedAt: Date.now(),
    });
  },
});

export const startGithubExport = mutation({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.ownerId !== identity.subject) {
      throw new Error("Project not found or unauthorized");
    }
    await ctx.db.patch(args.projectId, {
      exportStatus: "exporting",
      updatedAt: Date.now(),
    });
  },
});

export const completeGithubExport = mutation({
  args: {
    projectId: v.id("projects"),
    exportRepoUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.ownerId !== identity.subject) {
      throw new Error("Project not found or unauthorized");
    }
    await ctx.db.patch(args.projectId, {
      exportStatus: "completed",
      exportRepoUrl: args.exportRepoUrl,
      updatedAt: Date.now(),
    });
  },
});

export const failGithubExport = mutation({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.ownerId !== identity.subject) {
      throw new Error("Project not found or unauthorized");
    }
    await ctx.db.patch(args.projectId, {
      exportStatus: "failed",
      updatedAt: Date.now(),
    });
  },
});
