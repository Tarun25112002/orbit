import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { verifyAuth } from "./auth";
import { Id } from "./_generated/dataModel";

type FileReadCtx = QueryCtx | MutationCtx;
const INVALID_ITEM_NAME_PATTERN = /[\\/]/;

const validateItemName = (
  name: string,
  type: "file" | "folder" | "item",
) => {
  const trimmedName = name.trim();
  const label = type === "item" ? "Name" : `${type} name`;

  if (!trimmedName) {
    throw new Error(`${label} cannot be empty`);
  }

  if (trimmedName === "." || trimmedName === "..") {
    throw new Error(`${label} cannot be "." or ".."`);
  }

  if (INVALID_ITEM_NAME_PATTERN.test(trimmedName)) {
    throw new Error(`${label} cannot include path separators`);
  }

  return trimmedName;
};

const requireProjectAccess = async (
  ctx: FileReadCtx,
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

const requireFileAccess = async (
  ctx: FileReadCtx,
  fileId: Id<"files">,
  ownerId: string,
) => {
  const file = await ctx.db.get(fileId);
  if (!file) {
    throw new Error("File not found");
  }

  const project = await requireProjectAccess(ctx, file.projectId, ownerId);
  return { file, project };
};

const validateParentFolder = async (
  ctx: FileReadCtx,
  {
    projectId,
    parentId,
  }: {
    projectId: Id<"projects">;
    parentId?: Id<"files">;
  },
) => {
  if (!parentId) {
    return null;
  }

  const parent = await ctx.db.get(parentId);
  if (!parent) {
    throw new Error("Parent folder not found");
  }
  if (parent.projectId !== projectId) {
    throw new Error("Parent folder does not belong to this project");
  }
  if (parent.type !== "folder") {
    throw new Error("Items can only be created inside folders");
  }

  return parent;
};

const ensureUniqueSiblingName = async (
  ctx: FileReadCtx,
  {
    projectId,
    parentId,
    name,
    excludeId,
  }: {
    projectId: Id<"projects">;
    parentId?: Id<"files">;
    name: string;
    excludeId?: Id<"files">;
  },
) => {
  const siblings = await ctx.db
    .query("files")
    .withIndex("by_project_parent", (q) =>
      q.eq("projectId", projectId).eq("parentId", parentId),
    )
    .collect();

  const existing = siblings.find(
    (sibling) => sibling.name === name && sibling._id !== excludeId,
  );

  if (existing) {
    throw new Error("An item with this name already exists in this location");
  }
};

const touchProject = async (ctx: MutationCtx, projectId: Id<"projects">) => {
  await ctx.db.patch(projectId, {
    updatedAt: Date.now(),
  });
};

export const getFiles = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    await requireProjectAccess(ctx, args.projectId, identity.subject);

    return await ctx.db
      .query("files")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});
export const getFile = query({
  args: { id: v.id("files") },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    try {
      const { file } = await requireFileAccess(ctx, args.id, identity.subject);
      return file;
    } catch (error) {
      if (error instanceof Error && error.message === "File not found") {
        return null;
      }
      throw error;
    }
  },
});
export const getFolderContents = query({
  args: { projectId: v.id("projects"), parentId: v.optional(v.id("files")) },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    await requireProjectAccess(ctx, args.projectId, identity.subject);

    const files = await ctx.db
      .query("files")
      .withIndex("by_project_parent", (q) =>
        q.eq("projectId", args.projectId).eq("parentId", args.parentId),
      )
      .collect();
    return files.sort((a, b) => {
      if (a.type === "folder" && b.type === "file") return -1;
      if (a.type === "file" && b.type === "folder") return 1;

      return a.name.localeCompare(b.name);
    });
  },
});
export const createFile = mutation({
  args: {
    projectId: v.id("projects"),
    parentId: v.optional(v.id("files")),
    name: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    const name = validateItemName(args.name, "file");
    await requireProjectAccess(ctx, args.projectId, identity.subject);
    await validateParentFolder(ctx, {
      projectId: args.projectId,
      parentId: args.parentId,
    });
    await ensureUniqueSiblingName(ctx, {
      projectId: args.projectId,
      parentId: args.parentId,
      name,
    });

    const fileId = await ctx.db.insert("files", {
      projectId: args.projectId,
      parentId: args.parentId,
      name,
      type: "file",
      content: args.content,
      updatedAt: Date.now(),
    });

    await touchProject(ctx, args.projectId);

    return fileId;
  },
});
export const createFolder = mutation({
  args: {
    projectId: v.id("projects"),
    parentId: v.optional(v.id("files")),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    const name = validateItemName(args.name, "folder");
    await requireProjectAccess(ctx, args.projectId, identity.subject);
    await validateParentFolder(ctx, {
      projectId: args.projectId,
      parentId: args.parentId,
    });
    await ensureUniqueSiblingName(ctx, {
      projectId: args.projectId,
      parentId: args.parentId,
      name,
    });

    const folderId = await ctx.db.insert("files", {
      projectId: args.projectId,
      parentId: args.parentId,
      name,
      type: "folder",
      updatedAt: Date.now(),
    });

    await touchProject(ctx, args.projectId);

    return folderId;
  },
});
export const renameFile = mutation({
  args: {
    id: v.id("files"),
    newName: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    const newName = validateItemName(args.newName, "item");
    const { file } = await requireFileAccess(ctx, args.id, identity.subject);
    await ensureUniqueSiblingName(ctx, {
      projectId: file.projectId,
      parentId: file.parentId,
      name: newName,
      excludeId: args.id,
    });

    await ctx.db.patch(args.id, {
      name: newName,
      updatedAt: Date.now(),
    });

    await touchProject(ctx, file.projectId);
  },
});
export const deleteFile = mutation({
  args: {
    id: v.id("files"),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    const { file } = await requireFileAccess(ctx, args.id, identity.subject);

    const deleteRecursive = async (fileId: Id<"files">) => {
      const item = await ctx.db.get(fileId);
      if (!item) {
        return;
      }

      if (item.type === "folder") {
        const children = await ctx.db
          .query("files")
          .withIndex("by_project_parent", (q) =>
            q.eq("projectId", item.projectId).eq("parentId", fileId),
          )
          .collect();

        for (const child of children) {
          await deleteRecursive(child._id);
        }
      }

      if (item.storageId) {
        await ctx.storage.delete(item.storageId);
      }

      await ctx.db.delete(fileId);
    };

    await deleteRecursive(args.id);

    await touchProject(ctx, file.projectId);
  },
});

export const updateFile = mutation({
  args: {
    id: v.id("files"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    const { file } = await requireFileAccess(ctx, args.id, identity.subject);

    if (file.type !== "file") {
      throw new Error("Cannot update content of a folder");
    }

    const now = Date.now();
    await ctx.db.patch(args.id, {
      content: args.content,
      updatedAt: now,
    });
    await ctx.db.patch(file.projectId, {
      updatedAt: now,
    });
  },
});
