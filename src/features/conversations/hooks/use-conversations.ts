import {useMutation, useQuery} from "convex/react"
import {api} from "../../../../convex/_generated/api"
import { Id } from "../../../../convex/_generated/dataModel"
export const useConversation = (id:Id<"conversations"> |null)=>{
    return useQuery(api.conversations.getById, id?{id}:"skip")
}
export const useMessages = (conversationId: Id<"conversations">|null)=>{
    return useQuery(api.conversations.getMesssages,conversationId?{conversationId}:"skip");
}
export const useCreateConversation = (projectId: Id<"projects">)=>{
    return useMutation(api.conversations.create)
}