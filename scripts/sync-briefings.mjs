import fs from 'node:fs';
import path from 'node:path';

const source = process.argv[2] || path.resolve('../memory/briefings');
const target = path.resolve('content/briefings');

if (!fs.existsSync(source)) {
  console.error(`Source not found: ${source}`);
  process.exit(1);
}
fs.mkdirSync(target, { recursive: true });
let copied = 0;
for (const file of fs.readdirSync(source)) {
  if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(file)) continue;
  fs.copyFileSync(path.join(source, file), path.join(target, file));
  copied += 1;
}
console.log(`Copied ${copied} briefing markdown files into ${target}`);
