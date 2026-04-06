import {v} from "convex/values"
import {mutation, query} from "./_generated/server";
import { verifyAuth  } from "./auth";

export const create = mutation({
    args: {
        projectId: v.id("projects"),
        title: v.string()
    },
    handler: async (ctx,args)=>{
        const identity = await verifyAuth(ctx)
        const project = await ctx.db.get("projects", args.projectId)
        if(!project){
            throw new Error("Project not found")
        }
        if(project.ownerId !== identity.subject){
            throw new Error("Unauthorized to access this project")
        }
        const conversationId = await ctx.db.insert("conversations", {
            projectId: args.projectId,
            title: args.title,
            updatedAt: Date.now()
        })
        return conversationId
    }
})

