'use client'
import { Button } from "@/components/ui/button"
import { useMutation, useQuery } from "convex/react"
import { api } from "../../convex/_generated/api"

 const X = ()=>{
  const project = useQuery(api.projects.get)
  const createProject = useMutation(api.projects.create)
  return (
    <div>
      <Button onClick={()=>createProject({
        name:"New Project"
      })}> Create Project </Button>
      <div className="flex min-h-screen flex-col items-center justify-between p-24 text-white">
        {project?.map((project) => (
          <div key={project._id}>{project.name}{project.ownerId}</div>
        ))}
      </div>
    </div>
  );
} 
export default X