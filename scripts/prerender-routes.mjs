/**
 * Emit a real 200-status HTML file for every route, with per-route meta.
 *
 * WHY THIS EXISTS. The SPA fallback (dist/404.html) makes clean URLs work, but
 * GitHub Pages serves it with an HTTP 404 STATUS. Browsers render it fine, so
 * navigation looked correct — but many link-preview crawlers (Slack, Discord,
 * X, LinkedIn) skip non-200 responses, so a shared /u/<handle> link produced no
 * card at all. Sharing a profile is the product's whole growth loop.
 *
 * Writing dist/<route>/index.html gives each route a genuine 200, and lets each
 * one carry its own <title>/og:title/og:description instead of the generic
 * homepage copy every route otherwise inherited.
 *
 * 404.html is still emitted as the catch-all for unknown paths.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const DIST = 'dist';
const SITE = 'https://ledger.imagineqira.com';

const html = readFileSync(path.join(DIST, 'index.html'), 'utf8');

/** Escape for an HTML attribute — route copy is ours, member names are not. */
const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Replace the meta values the crawler reads. */
function withMeta(source, { title, description, url }) {
  let out = source;
  out = out.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  // Tags are pretty-printed across multiple lines in index.html, so the pattern
  // must tolerate arbitrary whitespace between attributes.
  const set = (attr, key, value) => {
    const re = new RegExp(`(<meta\\s+${attr}="${key}"\\s+content=")[^"]*(")`, 'is');
    if (!re.test(out)) throw new Error(`prerender: could not find meta ${attr}="${key}"`);
    out = out.replace(re, `$1${esc(value)}$2`);
  };
  set('property', 'og:title', title);
  set('property', 'og:description', description);
  set('property', 'og:url', url);
  set('name', 'twitter:title', title);
  set('name', 'twitter:description', description);
  set('name', 'description', description);
  out = out.replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${esc(url)}$2`);
  return out;
}

const ROUTES = [
  ['people', 'People measuring their AI work — Ledger', 'Browse professionals whose AI work is backed by a signed, browser-verifiable record instead of a self-written résumé.'],
  ['employer', 'Find people by evidence, not by résumé — Ledger', 'Search candidates backed by signed snapshots you verify in your own browser. Evidence and availability first; activity volume is never the ranking.'],
  ['join', 'Measure your own AI work — Ledger', 'Run an open-source collector on your machine. It measures the AI work you already do and produces a signed summary you publish yourself. No account.'],
  ['verify', 'How verification works — Ledger', 'Paste any snapshot URL and verify its Ed25519 signature yourself, in your own browser. You do not have to trust us.'],
  ['claims', 'What evidence can and cannot establish — Ledger', 'Every badge maps to one signal, one allowed claim, and stated limitations. No universal score: a combined figure never inherits more authority than its weakest evidence.'],
  ['compare', 'Where TOKENS fits — Ledger', 'Not a better usage monitor — the portable evidence layer above them. Honest comparison against metering and audit tools, including where they are stronger.'],
  ['privacy', 'Privacy — Ledger', 'No analytics, no accounts, no data collected from visitors. Local-first by design: your prompts, code, and file paths never leave your computer.'],
  ['terms', 'Terms of use — Ledger', 'A free, open-source, local-first tool plus a public directory. No identity guarantee, no skill rating, no warranty.'],
];

function emit(routePath, meta) {
  const dir = path.join(DIST, routePath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'index.html'), withMeta(html, meta));
}

let count = 0;
for (const [route, title, description] of ROUTES) {
  emit(route, { title, description, url: `${SITE}/${route}` });
  count += 1;
}

// Member profiles: give each a card naming the actual person.
const registryPath = path.join(DIST, 'data', 'profiles', 'index.json');
if (existsSync(registryPath)) {
  try {
    const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
    for (const member of registry.members ?? []) {
      if (!member?.handle) continue;
      const name = member.displayName ?? member.handle;
      emit(path.join('u', member.handle), {
        title: `${name} — verified AI-work profile`,
        description:
          `${member.headline ?? 'AI-work evidence record'} — measured on their machine, signed on their device, ` +
          'and verified in your browser.',
        url: `${SITE}/u/${member.handle}`,
      });
      count += 1;
    }
  } catch {
    /* registry optional; routes above still emitted */
  }
}

console.log(`prerendered ${count} routes with per-route meta (real 200 responses)`);
