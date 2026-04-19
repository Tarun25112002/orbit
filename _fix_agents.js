const fs = require('fs');
const path = 'src/lib/conversation-agents.ts';
let c = fs.readFileSync(path, 'utf8');
let changeCount = 0;

// Helper to try both CRLF and LF
function replacePattern(content, old, replacement) {
  let idx = content.indexOf(old);
  if (idx >= 0) {
    return content.replace(old, replacement);
  }
  // Try with LF
  const oldLF = old.replace(/\r\n/g, '\n');
  const repLF = replacement.replace(/\r\n/g, '\n');
  idx = content.indexOf(oldLF);
  if (idx >= 0) {
    return content.replace(oldLF, repLF);
  }
  return null;
}

// 1. Update runAgentTextWithFallback signature to accept reasoningEffort
{
  const old = [
    'const runAgentTextWithFallback = async (args: {',
    '  agent: { run: (prompt: string) => Promise<AgentResult> };',
    '  prompt: string;',
    '  systemPrompt: string;',
    '  model: string;',
    '  label: string;',
    '}) => {',
  ].join('\r\n');
  
  const rep = [
    'const runAgentTextWithFallback = async (args: {',
    '  agent: { run: (prompt: string) => Promise<AgentResult> };',
    '  prompt: string;',
    '  systemPrompt: string;',
    '  model: string;',
    '  label: string;',
    '  reasoningEffort?: "low" | "medium" | "high";',
    '}) => {',
  ].join('\r\n');
  
  const result = replacePattern(c, old, rep);
  if (result) { c = result; changeCount++; console.log('✅ 1. Added reasoningEffort to runAgentTextWithFallback'); }
  else console.log('❌ 1. Failed to update runAgentTextWithFallback signature');
}

// 2. Update the fallback generateGeminiCompletion call in runAgentTextWithFallback to use system + reasoningEffort 
{
  const old = [
    '    const fallback = await generateGeminiCompletion({',
    '      model: targetModel,',
    '      messages: [',
    '        {',
    '          role: "user",',
    '          content: buildFallbackAgentPrompt(args.systemPrompt, args.prompt),',
    '        },',
    '      ],',
    '    });',
  ].join('\r\n');
  
  const rep = [
    '    const fallback = await generateGeminiCompletion({',
    '      model: targetModel,',
    '      system: args.systemPrompt,',
    '      messages: [',
    '        {',
    '          role: "user",',
    '          content: args.prompt,',
    '        },',
    '      ],',
    '      ...(args.reasoningEffort ? { reasoningEffort: args.reasoningEffort } : {}),',
    '    });',
  ].join('\r\n');
  
  const result = replacePattern(c, old, rep);
  if (result) { c = result; changeCount++; console.log('✅ 2. Updated fallback call to use system prompt + reasoning effort'); }
  else console.log('❌ 2. Failed to update fallback call');
}

// 3. Add reasoningEffort to supervisor agent call (low — simple routing task)
{
  const old = [
    '      supervisorText = await runAgentTextWithFallback({',
    '        agent: supervisorAgent,',
    '        prompt: supervisorPrompt,',
    '        systemPrompt: SUPERVISOR_SYSTEM_PROMPT,',
    '        model: SUPERVISOR_MODEL,',
    '        label: "supervisor",',
    '      });',
  ].join('\r\n');
  
  const rep = [
    '      supervisorText = await runAgentTextWithFallback({',
    '        agent: supervisorAgent,',
    '        prompt: supervisorPrompt,',
    '        systemPrompt: SUPERVISOR_SYSTEM_PROMPT,',
    '        model: SUPERVISOR_MODEL,',
    '        label: "supervisor",',
    '        reasoningEffort: "low",',
    '      });',
  ].join('\r\n');
  
  const result = replacePattern(c, old, rep);
  if (result) { c = result; changeCount++; console.log('✅ 3. Added reasoning effort "low" to supervisor'); }
  else console.log('❌ 3. Failed to update supervisor call');
}

// 4. Add reasoningEffort to specialist agent calls (medium — analysis)
{
  const old = [
    '      const content = await runAgentTextWithFallback({',
    '        agent,',
    '        prompt: buildSpecialistPrompt(input, assignment),',
    '        systemPrompt: SPECIALIST_SYSTEM_PROMPTS[assignment.agent],',
    '        model: SPECIALIST_MODEL,',
    '        label: `specialist:${assignment.agent}`,',
    '      });',
  ].join('\r\n');
  
  const rep = [
    '      const content = await runAgentTextWithFallback({',
    '        agent,',
    '        prompt: buildSpecialistPrompt(input, assignment),',
    '        systemPrompt: SPECIALIST_SYSTEM_PROMPTS[assignment.agent],',
    '        model: SPECIALIST_MODEL,',
    '        label: `specialist:${assignment.agent}`,',
    '        reasoningEffort: "medium",',
    '      });',
  ].join('\r\n');
  
  const result = replacePattern(c, old, rep);
  if (result) { c = result; changeCount++; console.log('✅ 4. Added reasoning effort "medium" to specialists'); }
  else console.log('❌ 4. Failed to update specialist call');
}

// 5. Add reasoningEffort to synthesis agent call (medium — response quality matters)
{
  const old = [
    '      content = await runAgentTextWithFallback({',
    '        agent: synthesisAgent,',
    '        prompt: buildSynthesisPrompt(input, reports, operationResults),',
    '        systemPrompt: SYNTHESIS_SYSTEM_PROMPT,',
    '        model: SYNTHESIS_MODEL,',
    '        label: "synthesis",',
    '      });',
  ].join('\r\n');
  
  const rep = [
    '      content = await runAgentTextWithFallback({',
    '        agent: synthesisAgent,',
    '        prompt: buildSynthesisPrompt(input, reports, operationResults),',
    '        systemPrompt: SYNTHESIS_SYSTEM_PROMPT,',
    '        model: SYNTHESIS_MODEL,',
    '        label: "synthesis",',
    '        reasoningEffort: "medium",',
    '      });',
  ].join('\r\n');
  
  const result = replacePattern(c, old, rep);
  if (result) { c = result; changeCount++; console.log('✅ 5. Added reasoning effort "medium" to synthesis'); }
  else console.log('❌ 5. Failed to update synthesis call');
}

// 6. Add reasoningEffort to title agent call (low — trivial task)
{
  const old = [
    '  const title = await runAgentTextWithFallback({',
    '    agent: titleAgent,',
    '    prompt: ["Conversation starter:", message, "", "Title:"].join("\\n"),',
    '    systemPrompt: TITLE_SYSTEM_PROMPT,',
    '    model: SPECIALIST_MODEL,',
    '    label: "title",',
    '  });',
  ].join('\r\n');
  
  const rep = [
    '  const title = await runAgentTextWithFallback({',
    '    agent: titleAgent,',
    '    prompt: ["Conversation starter:", message, "", "Title:"].join("\\n"),',
    '    systemPrompt: TITLE_SYSTEM_PROMPT,',
    '    model: SPECIALIST_MODEL,',
    '    label: "title",',
    '    reasoningEffort: "low",',
    '  });',
  ].join('\r\n');
  
  const result = replacePattern(c, old, rep);
  if (result) { c = result; changeCount++; console.log('✅ 6. Added reasoning effort "low" to title agent'); }
  else console.log('❌ 6. Failed to update title call');
}

fs.writeFileSync(path, c);
console.log(`\nDone! Applied ${changeCount}/6 changes.`);
