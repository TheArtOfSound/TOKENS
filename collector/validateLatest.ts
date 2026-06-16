import { readFileSync } from 'node:fs';
import path from 'node:path';

const latestPath = path.join(process.cwd(), 'public', 'data', 'latest.json');
const text = readFileSync(latestPath, 'utf8');
const data = JSON.parse(text) as Record<string, unknown>;

const forbiddenPatterns: Array<[RegExp, string]> = [
  [/\/Users\/[A-Za-z0-9._-]+/i, 'macOS user path'],
  [/C:\\\\Users\\\\[A-Za-z0-9._-]+/i, 'Windows user path'],
  [/sk-[A-Za-z0-9_-]{16,}/, 'API key shaped string'],
  [/ANTHROPIC_API_KEY/i, 'Anthropic key name'],
  [/OPENAI_API_KEY/i, 'OpenAI key name'],
  [/BEGIN (RSA|OPENSSH|PRIVATE) KEY/i, 'private key'],
  [/\.env/i, '.env reference'],
];

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

assert(data.generatedAt, 'generatedAt is required');
assert(data.totals && typeof data.totals === 'object', 'totals object is required');
assert(data.verification && typeof data.verification === 'object', 'verification object is required');
assert((data.verification as Record<string, unknown>).rawLogsPublished === false, 'rawLogsPublished must be false');

for (const [pattern, label] of forbiddenPatterns) {
  if (pattern.test(text)) {
    throw new Error(`Public data failed safety validation: found ${label}`);
  }
}

console.log(`Validated ${latestPath}`);
