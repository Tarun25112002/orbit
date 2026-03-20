//projects api end point in convex 
import {v} from "convex/values"
import {mutation, query} from "./_generated/server"

export const create = mutation({
    args:{
        name: v.string(),
    },
    handler: async(ctx,args)=>{
        const identity = await ctx.auth.getUserIdentity()
        if(!identity){
            throw new Error("Unauthorized");
        }
            await ctx.db.insert("projects", {
              name: args.name,
              ownerId: identity.subject
            });
    }

})
export const get = query({
    args:{},
    handler: async (ctx)=>{
        const identity = ctx.auth.getUserIdentity()
        if(!identity){
            return []
        }
       return await ctx.db.query("projects").collect()
    }
})