import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const sourceRoots = [
  'apps/extension/src',
  'packages/recommender-core/src',
  'packages/shared-types/src',
];
const optionalRoots = ['apps/extension/dist'];
const textExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.html', '.css']);

const forbiddenPatterns = [
  ['YouTube Data API host', /youtube\.googleapis\.com/i],
  ['Legacy YouTube Data API host/path', /(?:www\.)?googleapis\.com\/youtube\/v3/i],
  ['YouTube OAuth scope', /www\.googleapis\.com\/auth\/youtube(?:[.\w-]*)?/i],
  ['YouTube OAuth readonly scope', /youtube\.readonly/i],
  ['YouTube OAuth force-ssl scope', /youtube\.force-ssl/i],
  ['YouTube OAuth upload scope', /youtube\.upload/i],
  ['Google API client dependency', /(?:from\s+['"]googleapis['"]|require\(['"]googleapis['"]\))/i],
  ['Google auth client dependency', /(?:from\s+['"]google-auth-library['"]|require\(['"]google-auth-library['"]\))/i],
  ['YouTube API key identifier', /\bYOUTUBE_API_KEY\b/],
  ['Google OAuth client identifier', /\bGOOGLE_CLIENT_(?:ID|SECRET)\b/],
  ['OAuth refresh token identifier', /\brefresh_token\b/i],
  ['OAuth access token identifier', /\baccess_token\b/i],
  ['Data API resource-list call', /\b(?:subscriptions|playlistItems|channels|videos|search)\.list\b/],
];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (textExtensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

const roots = [];
for (const root of sourceRoots) roots.push(join(repoRoot, root));
for (const root of optionalRoots) {
  const absolute = join(repoRoot, root);
  if (await exists(absolute)) roots.push(absolute);
}

const files = (await Promise.all(roots.map(walk))).flat();
const findings = [];

for (const file of files) {
  const content = await readFile(file, 'utf8');
  for (const [label, pattern] of forbiddenPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) {
      findings.push({ label, file: relative(repoRoot, file) });
    }
  }
}

if (findings.length > 0) {
  console.error('YouTube API boundary audit failed:');
  for (const finding of findings) console.error(`- ${finding.label}: ${finding.file}`);
  console.error('The launch runtime must not introduce YouTube Data API/OAuth dependencies without reopening #168 and updating the policy boundary.');
  process.exitCode = 1;
} else {
  console.log(`YouTube API boundary audit passed (${files.length} launch source/artifact files inspected).`);
  console.log('No YouTube Data API hosts, OAuth scopes/token identifiers, API client dependencies, or resource-list calls were found.');
}
