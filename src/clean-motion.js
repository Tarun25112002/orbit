const fs = require('fs');

const targetFile = 'd:/orbit/src/app/page.tsx';
let content = fs.readFileSync(targetFile, 'utf8');

// Remove import
content = content.replace(/import { motion } from "framer-motion";\n/g, '');

// Replace motion tags
content = content.replace(/<motion\.([a-zA-Z]+)/g, '<$1');
content = content.replace(/<\/motion\.([a-zA-Z]+)>/g, '</$1>');

// Remove framer-motion specific props (simplified regex)
// We need to replace props like variants={...}, initial={...}, animate={...}, transition={...}, whileInView={...}, viewport={...}
const propsToRemove = ['variants', 'initial', 'animate', 'transition', 'whileInView', 'viewport'];

for (const prop of propsToRemove) {
  content = content.replace(new RegExp(`\\s+${prop}=\\{[^}]+\\}`, 'g'), '');
}

// Remove the animate-pulse utility classes
content = content.replace(/ \banimate-pulse\b/g, '');

// Also clean up defined variants since they are dead code
content = content.replace(/const containerVariants = {[\s\S]*?};\n\n/m, '');
content = content.replace(/const itemVariants = {[\s\S]*?};\n\n/m, '');

fs.writeFileSync(targetFile, content, 'utf8');
console.log('Successfully cleaned up page.tsx');
