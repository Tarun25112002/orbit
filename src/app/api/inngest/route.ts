import { serve } from "inngest/next";
import { inngest } from "../../../inngest/client";
import {
  codeCompletionRequested,
  conversationMessageRequested,
  orbit,
} from "./functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [orbit, conversationMessageRequested, codeCompletionRequested],
});
