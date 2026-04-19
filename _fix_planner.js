const fs = require('fs');
const path = 'src/lib/conversation-agents.ts';
let c = fs.readFileSync(path, 'utf8');

// Replace the planner generateGeminiCompletion call to separate system prompt
const oldPattern = [
  '  const result = await generateGeminiCompletion({',
  '    model: targetModel,',
  '    messages: [',
  '      {',
  '        role: "user",',
  '        content: `${FILE_OPS_PLANNER_SYSTEM_PROMPT}\\n\\n${prompt}`,',
  '      },',
  '    ],',
  '    maxTokens: FILE_OPS_PLANNER_MAX_OUTPUT_TOKENS,',
  '    temperature: 0.1,',
  '    responseMimeType: "application/json",',
  '  });',
].join('\r\n');

const newContent = [
  '  const result = await generateGeminiCompletion({',
  '    model: targetModel,',
  '    system: FILE_OPS_PLANNER_SYSTEM_PROMPT,',
  '    messages: [',
  '      {',
  '        role: "user",',
  '        content: prompt,',
  '      },',
  '    ],',
  '    maxTokens: FILE_OPS_PLANNER_MAX_OUTPUT_TOKENS,',
  '    temperature: 0.05,',
  '    reasoningEffort: "high",',
  '    responseMimeType: "application/json",',
  '  });',
].join('\r\n');

const idx = c.indexOf(oldPattern);
if (idx >= 0) {
  c = c.replace(oldPattern, newContent);
  fs.writeFileSync(path, c);
  console.log('✅ Replaced planner call successfully');
} else {
  console.log('❌ Pattern not found. Trying with LF...');
  const oldLF = oldPattern.replace(/\r\n/g, '\n');
  const newLF = newContent.replace(/\r\n/g, '\n');
  const idx2 = c.indexOf(oldLF);
  if (idx2 >= 0) {
    c = c.replace(oldLF, newLF);
    fs.writeFileSync(path, c);
    console.log('✅ Replaced planner call (LF) successfully');
  } else {
    console.log('❌ Pattern not found with either line ending');
    // Debug: show what's around line 2827
    const lines = c.split(/\r?\n/);
    for (let i = 2826; i <= 2838; i++) {
      console.log(`  L${i+1}: ${JSON.stringify(lines[i])}`);
    }
  }
}
