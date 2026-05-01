import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";

const PATH_SEPARATOR_PATTERN = /[\\/]/;

const normalizePath = (rawPath: string, label: string) => {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    throw new Error(`${label} cannot be empty`);
  }

  const normalizedSlashes = trimmed
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "");

  const withoutCurrentDir = normalizedSlashes.startsWith("./")
    ? normalizedSlashes.slice(2)
    : normalizedSlashes;

  if (!withoutCurrentDir) {
    throw new Error(`${label} cannot be empty`);
  }

  const segments = withoutCurrentDir
    .split("/")
    .map((segment) => segment.trim());

  if (segments.some((segment) => !segment)) {
    throw new Error(`${label} cannot contain empty path segments`);
  }

  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`${label} cannot contain "." or ".." segments`);
  }

  if (segments.some((segment) => PATH_SEPARATOR_PATTERN.test(segment))) {
    throw new Error(`${label} contains invalid path separators`);
  }

  return {
    segments,
    normalizedPath: segments.join("/"),
  };
};

const touchProject = async (ctx: MutationCtx, projectId: Id<"projects">) => {
  await ctx.db.patch(projectId, {
    updatedAt: Date.now(),
  });
};

const findChildByName = async (args: {
  ctx: MutationCtx;
  projectId: Id<"projects">;
  parentId?: Id<"files">;
  name: string;
}) => {
  const { ctx, projectId, parentId, name } = args;

  const siblings = await ctx.db
    .query("files")
    .withIndex("by_project_parent", (q) =>
      q.eq("projectId", projectId).eq("parentId", parentId),
    )
    .collect();

  return siblings.find((sibling) => sibling.name === name) ?? null;
};

const resolvePath = async (args: {
  ctx: MutationCtx;
  projectId: Id<"projects">;
  path: string;
}): Promise<{
  item: Doc<"files">;
  normalizedPath: string;
  segments: string[];
} | null> => {
  const { ctx, projectId, path } = args;
  const { segments, normalizedPath } = normalizePath(path, "Path");

  let currentParentId: Id<"files"> | undefined;
  let currentItem: Doc<"files"> | null = null;

  for (const [index, segment] of segments.entries()) {
    const child = await findChildByName({
      ctx,
      projectId,
      parentId: currentParentId,
      name: segment,
    });

    if (!child) {
      return null;
    }

    const isLast = index === segments.length - 1;
    if (!isLast && child.type !== "folder") {
      throw new Error(
        `Path segment "${segments.slice(0, index + 1).join("/")}" is not a folder`,
      );
    }

    currentItem = child;
    currentParentId = child._id;
  }

  if (!currentItem) {
    return null;
  }

  return {
    item: currentItem,
    normalizedPath,
    segments,
  };
};

const ensureUniqueSiblingName = async (args: {
  ctx: MutationCtx;
  projectId: Id<"projects">;
  parentId?: Id<"files">;
  name: string;
  excludeId?: Id<"files">;
}) => {
  const existing = await findChildByName(args);
  if (existing && existing._id !== args.excludeId) {
    throw new Error(
      "An item with this name already exists in the target folder",
    );
  }
};

const ensureFolderPath = async (args: {
  ctx: MutationCtx;
  projectId: Id<"projects">;
  folderSegments: string[];
}) => {
  const { ctx, projectId, folderSegments } = args;

  let currentParentId: Id<"files"> | undefined;
  let createdCount = 0;

  for (const segment of folderSegments) {
    const existing = await findChildByName({
      ctx,
      projectId,
      parentId: currentParentId,
      name: segment,
    });

    if (existing) {
      if (existing.type !== "folder") {
        throw new Error(
          `Cannot create folder segment "${segment}" because a file already exists with that name`,
        );
      }

      currentParentId = existing._id;
      continue;
    }

    const folderId = await ctx.db.insert("files", {
      projectId,
      parentId: currentParentId,
      name: segment,
      type: "folder",
      updatedAt: Date.now(),
    });

    currentParentId = folderId;
    createdCount += 1;
  }

  return {
    folderId: currentParentId,
    createdCount,
  };
};

const deleteFileTree = async (
  ctx: MutationCtx,
  itemId: Id<"files">,
): Promise<number> => {
  const item = await ctx.db.get(itemId);
  if (!item) {
    return 0;
  }

  let deletedCount = 0;

  if (item.type === "folder") {
    const children = await ctx.db
      .query("files")
      .withIndex("by_project_parent", (q) =>
        q.eq("projectId", item.projectId).eq("parentId", item._id),
      )
      .collect();

    for (const child of children) {
      deletedCount += await deleteFileTree(ctx, child._id);
    }
  }

  if (item.storageId) {
    await ctx.storage.delete(item.storageId);
  }

  await ctx.db.delete(item._id);
  deletedCount += 1;

  return deletedCount;
};

const isFolderAncestor = async (args: {
  ctx: MutationCtx;
  projectId: Id<"projects">;
  ancestorFolderId: Id<"files">;
  candidateDescendantId?: Id<"files">;
}) => {
  const { ctx, projectId, ancestorFolderId, candidateDescendantId } = args;

  let currentId = candidateDescendantId;

  while (currentId) {
    if (currentId === ancestorFolderId) {
      return true;
    }

    const current = await ctx.db.get(currentId);
    if (!current || current.projectId !== projectId) {
      return false;
    }

    currentId = current.parentId;
  }

  return false;
};

export const getConversationById = query({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.conversationId);
  },
});

export const getMessagesByConversation = query({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("asc")
      .collect();
  },
});

export const getMessageById = query({
  args: {
    messageId: v.id("messages"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.messageId);
  },
});

export const getProjectFiles = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("files")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const updateMessageContent = mutation({
  args: {
    messageId: v.id("messages"),
    content: v.string(),
    status: v.union(v.literal("completed"), v.literal("failed")),
    reasoningDetails: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const patch: {
      content: string;
      status: "completed" | "failed";
      reasoning_details?: unknown;
    } = {
      content: args.content,
      status: args.status,
    };

    if (args.reasoningDetails !== undefined) {
      patch.reasoning_details = args.reasoningDetails;
    }

    await ctx.db.patch(args.messageId, patch);
  },
});

export const completeMessageIfProcessing = mutation({
  args: {
    messageId: v.id("messages"),
    content: v.string(),
    status: v.union(v.literal("completed"), v.literal("failed")),
    reasoningDetails: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message || message.status === "cancelled") {
      return false;
    }

    const patch: {
      content: string;
      status: "completed" | "failed";
      reasoning_details?: unknown;
    } = {
      content: args.content,
      status: args.status,
    };

    if (args.reasoningDetails !== undefined) {
      patch.reasoning_details = args.reasoningDetails;
    }

    await ctx.db.patch(args.messageId, patch);

    return true;
  },
});

/**
 * Stream progress updates to a processing message without changing its status.
 * Called after each file operation completes so the user sees real-time progress.
 */
export const streamMessageProgress = mutation({
  args: {
    messageId: v.id("messages"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) {
      return false;
    }

    // Only update if the message is still processing — don't overwrite completed/cancelled
    if (message.status !== "processing") {
      return false;
    }

    await ctx.db.patch(args.messageId, {
      content: args.content,
    });

    return true;
  },
});

export const cancelMessage = mutation({
  args: {
    messageId: v.id("messages"),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) {
      return false;
    }

    if (message.status !== "processing") {
      return false;
    }

    await ctx.db.patch(args.messageId, {
      content: "Response cancelled.",
      status: "cancelled",
    });

    return true;
  },
});

export const updateConversationTitle = mutation({
  args: {
    conversationId: v.id("conversations"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const title = args.title.trim();
    if (!title) {
      return false;
    }

    await ctx.db.patch(args.conversationId, {
      title,
      updatedAt: Date.now(),
    });

    return true;
  },
});

export const agentCreateFileByPath = mutation({
  args: {
    projectId: v.id("projects"),
    path: v.string(),
    content: v.string(),
    overwrite: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { segments, normalizedPath } = normalizePath(args.path, "File path");
    const fileName = segments.at(-1)!;
    const folderSegments = segments.slice(0, -1);

    const { folderId } = await ensureFolderPath({
      ctx,
      projectId: args.projectId,
      folderSegments,
    });

    const existing = await findChildByName({
      ctx,
      projectId: args.projectId,
      parentId: folderId,
      name: fileName,
    });

    if (existing) {
      if (existing.type !== "file") {
        throw new Error(
          `Cannot create file at ${normalizedPath}: target is a folder`,
        );
      }

      if (!args.overwrite) {
        throw new Error(`File already exists at ${normalizedPath}`);
      }

      await ctx.db.patch(existing._id, {
        content: args.content,
        updatedAt: Date.now(),
      });
      await touchProject(ctx, args.projectId);

      return {
        action: "updated" as const,
        path: normalizedPath,
        fileId: existing._id,
      };
    }

    const fileId = await ctx.db.insert("files", {
      projectId: args.projectId,
      parentId: folderId,
      name: fileName,
      type: "file",
      content: args.content,
      updatedAt: Date.now(),
    });

    await touchProject(ctx, args.projectId);

    return {
      action: "created" as const,
      path: normalizedPath,
      fileId,
    };
  },
});

export const agentCreateFolderByPath = mutation({
  args: {
    projectId: v.id("projects"),
    path: v.string(),
  },
  handler: async (ctx, args) => {
    const { segments, normalizedPath } = normalizePath(
      args.path,
      "Folder path",
    );
    const { folderId, createdCount } = await ensureFolderPath({
      ctx,
      projectId: args.projectId,
      folderSegments: segments,
    });

    if (!folderId) {
      throw new Error("Unable to create folder path");
    }

    if (createdCount > 0) {
      await touchProject(ctx, args.projectId);
    }

    return {
      action: createdCount > 0 ? ("created" as const) : ("existing" as const),
      path: normalizedPath,
      folderId,
    };
  },
});

export const agentUpdateFileByPath = mutation({
  args: {
    projectId: v.id("projects"),
    path: v.string(),
    content: v.string(),
    createIfMissing: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const normalized = normalizePath(args.path, "File path");
    const resolved = await resolvePath({
      ctx,
      projectId: args.projectId,
      path: normalized.normalizedPath,
    });

    if (resolved) {
      if (resolved.item.type !== "file") {
        throw new Error(
          `Cannot update ${normalized.normalizedPath}: target is a folder`,
        );
      }

      await ctx.db.patch(resolved.item._id, {
        content: args.content,
        updatedAt: Date.now(),
      });
      await touchProject(ctx, args.projectId);

      return {
        action: "updated" as const,
        path: normalized.normalizedPath,
        fileId: resolved.item._id,
      };
    }

    if (!args.createIfMissing) {
      throw new Error(`File not found at ${normalized.normalizedPath}`);
    }

    const fileName = normalized.segments.at(-1)!;
    const folderSegments = normalized.segments.slice(0, -1);

    const { folderId } = await ensureFolderPath({
      ctx,
      projectId: args.projectId,
      folderSegments,
    });

    const existing = await findChildByName({
      ctx,
      projectId: args.projectId,
      parentId: folderId,
      name: fileName,
    });

    if (existing) {
      if (existing.type !== "file") {
        throw new Error(
          `Cannot update ${normalized.normalizedPath}: target is a folder`,
        );
      }

      await ctx.db.patch(existing._id, {
        content: args.content,
        updatedAt: Date.now(),
      });
      await touchProject(ctx, args.projectId);

      return {
        action: "updated" as const,
        path: normalized.normalizedPath,
        fileId: existing._id,
      };
    }

    const fileId = await ctx.db.insert("files", {
      projectId: args.projectId,
      parentId: folderId,
      name: fileName,
      type: "file",
      content: args.content,
      updatedAt: Date.now(),
    });

    await touchProject(ctx, args.projectId);

    return {
      action: "created" as const,
      path: normalized.normalizedPath,
      fileId,
    };
  },
});

export const agentDeletePath = mutation({
  args: {
    projectId: v.id("projects"),
    path: v.string(),
  },
  handler: async (ctx, args) => {
    const { normalizedPath } = normalizePath(args.path, "Path");
    const resolved = await resolvePath({
      ctx,
      projectId: args.projectId,
      path: normalizedPath,
    });

    if (!resolved) {
      return {
        status: "missing" as const,
        path: normalizedPath,
        deletedCount: 0,
      };
    }

    const deletedCount = await deleteFileTree(ctx, resolved.item._id);
    await touchProject(ctx, args.projectId);

    return {
      status: "deleted" as const,
      path: normalizedPath,
      deletedType: resolved.item.type,
      deletedCount,
    };
  },
});

export const agentRenamePath = mutation({
  args: {
    projectId: v.id("projects"),
    path: v.string(),
    newPath: v.string(),
    createMissingParents: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const source = normalizePath(args.path, "Path");
    const target = normalizePath(args.newPath, "New path");

    const resolved = await resolvePath({
      ctx,
      projectId: args.projectId,
      path: source.normalizedPath,
    });

    if (!resolved) {
      throw new Error(`Path not found: ${source.normalizedPath}`);
    }

    if (source.normalizedPath === target.normalizedPath) {
      return {
        status: "unchanged" as const,
        path: source.normalizedPath,
        newPath: target.normalizedPath,
        itemId: resolved.item._id,
      };
    }

    const nextName = target.segments.at(-1)!;
    const targetParentSegments = target.segments.slice(0, -1);

    let targetParentId: Id<"files"> | undefined;

    if (targetParentSegments.length > 0) {
      if (args.createMissingParents ?? true) {
        const ensured = await ensureFolderPath({
          ctx,
          projectId: args.projectId,
          folderSegments: targetParentSegments,
        });
        targetParentId = ensured.folderId;
      } else {
        const parentResolved = await resolvePath({
          ctx,
          projectId: args.projectId,
          path: targetParentSegments.join("/"),
        });

        if (!parentResolved || parentResolved.item.type !== "folder") {
          throw new Error(
            `Target parent folder does not exist: ${targetParentSegments.join("/")}`,
          );
        }

        targetParentId = parentResolved.item._id;
      }
    }

    if (resolved.item.type === "folder") {
      const createsCycle = await isFolderAncestor({
        ctx,
        projectId: args.projectId,
        ancestorFolderId: resolved.item._id,
        candidateDescendantId: targetParentId,
      });

      if (createsCycle) {
        throw new Error("Cannot move a folder into itself");
      }
    }

    await ensureUniqueSiblingName({
      ctx,
      projectId: args.projectId,
      parentId: targetParentId,
      name: nextName,
      excludeId: resolved.item._id,
    });

    await ctx.db.patch(resolved.item._id, {
      parentId: targetParentId,
      name: nextName,
      updatedAt: Date.now(),
    });

    await touchProject(ctx, args.projectId);

    return {
      status: "renamed" as const,
      path: source.normalizedPath,
      newPath: target.normalizedPath,
      itemId: resolved.item._id,
    };
  },
});
