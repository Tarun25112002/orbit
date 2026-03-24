import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { verifyAuth } from "./auth";
export const getFiles = query({
  args: {projectId: v.id("projects")},
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
const project   = await ctx.db.get("projects", args.projectId) 
if(!project){
    throw new Error("Project not found")
}
if(project.ownerId!==identity.subject){
    throw new Error("Unauthorrized to access this project")
}
    return await ctx.db
      .query("files")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId)).collect()
     
     
  },
});
