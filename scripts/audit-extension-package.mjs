import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const root = new URL('../apps/extension/dist/', import.meta.url);
const textExtensions = new Set(['.js', '.json', '.html', '.css', '.map', '.txt']);
const secretPatterns = [
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/g],
  ['OpenAI-style secret key', /sk-[A-Za-z0-9_-]{20,}/g],
  ['GitHub personal access token', /gh[pousr]_[A-Za-z0-9]{20,}/g],
  ['PEM private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

const files = await walk(root);
const findings = [];
for (const file of files) {
  if (!textExtensions.has(extname(file))) continue;
  const content = await readFile(file, 'utf8');
  for (const [label, pattern] of secretPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) findings.push(`${label}: ${relative(root.pathname, file)}`);
  }
}

if (findings.length > 0) {
  console.error('Potential secrets found in extension artifact:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(`Extension artifact secret scan passed (${files.length} files inspected).`);
}
