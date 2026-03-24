"use client"

import { Id } from "../../../../convex/_generated/dataModel"
import { Navbar } from "./navbar"

export const ProjectIdLayout = ({
    children,
    projectId 
}:{
    children: React.ReactNode
    projectId: Id<"projects">
})=>{
return (
    <div>
        <Navbar projectId = {projectId}/>
        {children}
    </div>
)
}