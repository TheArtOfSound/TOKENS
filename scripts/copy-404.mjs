// Cross-platform replacement for `cp dist/index.html dist/404.html`.
// Works on Windows, macOS, and Linux without requiring shell utilities.
import { copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const src = join(root, 'dist', 'index.html');
const dst = join(root, 'dist', '404.html');

if (!existsSync(src)) {
  console.error(`copy-404: source not found: ${src}`);
  process.exit(1);
}

copyFileSync(src, dst);
console.log(`copy-404: copied index.html → 404.html`);
