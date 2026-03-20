import { inngest } from "@/inngest/client";
import { generateText } from "ai";
import {google} from '@ai-sdk/google'
export const orbit = inngest.createFunction(
  { id: "orbit-generate" },
  { event: "orbit/generate" },
  async ({ step }) => {
    await step.run("generate-text", async ()=>{
     return await generateText({
            model: google('gemini-2.5-flash'),
            prompt: 'What is current time'
        })
    });
   
  },
);
