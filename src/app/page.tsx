'use client'
import { Button } from "@/components/ui/button"
import { useQuery } from "convex/react"
import { api } from "../../convex/_generated/api"
 const X = ()=>{
  const tasks = useQuery(api.tasks.get)
  return (
    <div>
      <Button>Click Me</Button>
      <div className="flex min-h-screen flex-col items-center justify-between p-24 text-white">
        {tasks?.map(({ _id, text }) => (
          <div key={_id}>{text}</div>
        ))}
      </div>
    </div>
  );
} 
export default X