/**
 * SEO generation: sitemap + JSON-LD structured data.
 *
 * Two gaps this closes.
 *
 * 1. The sitemap listed ONLY the homepage, so nine real routes and every member
 *    profile were invisible to crawlers that rely on it for discovery.
 *
 * 2. There was no structured data at all. For a people directory that is the
 *    single biggest miss: without schema.org markup, Google sees a wall of text
 *    instead of a Person with a job title, a URL, and known tools. This emits
 *    Organization + WebSite on the homepage and a Person + ProfilePage on each
 *    member route.
 *
 * The honesty rule still applies here, and it matters MORE in structured data
 * because search engines surface these claims out of context: we emit only what
 * the signed snapshot actually supports. No ratings, no aggregate scores, no
 * "expert" job titles we cannot substantiate — the same reason the product
 * refuses a universal score.
 *
 * Runs after vite build, over dist/.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const DIST = 'dist';
const SITE = 'https://ledger.imagineqira.com';

const ROUTES = [
  { path: '', priority: '1.0', freq: 'daily' },
  { path: 'people', priority: '0.9', freq: 'daily' },
  { path: 'employer', priority: '0.9', freq: 'weekly' },
  { path: 'join', priority: '0.8', freq: 'weekly' },
  { path: 'verify', priority: '0.7', freq: 'monthly' },
  { path: 'claims', priority: '0.7', freq: 'monthly' },
  { path: 'compare', priority: '0.6', freq: 'monthly' },
  { path: 'privacy', priority: '0.3', freq: 'yearly' },
  { path: 'terms', priority: '0.3', freq: 'yearly' },
];

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function readRegistry() {
  const p = path.join(DIST, 'data', 'profiles', 'index.json');
  if (!existsSync(p)) return { members: [] };
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return { members: [] };
  }
}

function readSnapshot() {
  const p = path.join(DIST, 'data', 'latest.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

// ---------- sitemap ----------
const registry = readRegistry();
const today = (readSnapshot()?.generatedAt ?? new Date(0).toISOString()).slice(0, 10);

const urls = [
  ...ROUTES.map((r) => ({ loc: `${SITE}/${r.path}`, priority: r.priority, freq: r.freq })),
  ...(registry.members ?? [])
    .filter((m) => m?.handle)
    .map((m) => ({ loc: `${SITE}/u/${m.handle}`, priority: '0.8', freq: 'daily' })),
];

writeFileSync(
  path.join(DIST, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map(
        (u) =>
          `  <url><loc>${esc(u.loc)}</loc><lastmod>${today}</lastmod>` +
          `<changefreq>${u.freq}</changefreq><priority>${u.priority}</priority></url>`,
      )
      .join('\n') +
    `\n</urlset>\n`,
);

// ---------- structured data ----------
/** Inject a JSON-LD block into a built HTML file, before </head>. */
function injectLd(file, data) {
  const full = path.join(DIST, file);
  if (!existsSync(full)) return false;
  let html = readFileSync(full, 'utf8');
  if (html.includes('application/ld+json')) return false; // already injected
  const block = `    <script type="application/ld+json">${JSON.stringify(data)}</script>\n  </head>`;
  html = html.replace('</head>', block);
  writeFileSync(full, html);
  return true;
}

const ORG = {
  '@type': 'Organization',
  '@id': `${SITE}/#org`,
  name: 'Ledger',
  url: SITE,
  logo: `${SITE}/favicon.svg`,
  description:
    'A local-first evidence layer for AI-assisted work. Members measure their own AI usage on their machine, ' +
    'sign it on their device, and publish a record anyone can verify in the browser.',
  parentOrganization: { '@type': 'Organization', name: 'Qira LLC', url: 'https://imagineqira.com' },
};

let injected = 0;

// Homepage: Organization + WebSite.
if (
  injectLd('index.html', {
    '@context': 'https://schema.org',
    '@graph': [
      ORG,
      {
        '@type': 'WebSite',
        '@id': `${SITE}/#website`,
        url: SITE,
        name: 'Ledger — Evidence layer for AI-assisted work',
        publisher: { '@id': `${SITE}/#org` },
      },
    ],
  })
) injected += 1;

// Directory: a CollectionPage listing the members.
if (
  injectLd('people/index.html', {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    url: `${SITE}/people`,
    name: 'People measuring their AI work',
    isPartOf: { '@id': `${SITE}/#website` },
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: (registry.members ?? [])
        .filter((m) => m?.handle)
        .map((m, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          url: `${SITE}/u/${m.handle}`,
          name: m.displayName ?? m.handle,
        })),
    },
  })
) injected += 1;

// Member profiles: ProfilePage + Person.
// Only fields the signed snapshot supports. No ratings and no aggregate score —
// search engines surface these out of context, so overclaiming here is worse
// than overclaiming on the page itself.
const snapshot = readSnapshot();
for (const m of registry.members ?? []) {
  if (!m?.handle) continue;
  const isOperator = m.operator === true;
  const profile = isOperator ? snapshot?.profile : null;

  const person = {
    '@type': 'Person',
    '@id': `${SITE}/u/${m.handle}#person`,
    name: m.displayName ?? m.handle,
    url: `${SITE}/u/${m.handle}`,
    ...(m.headline ? { description: m.headline } : {}),
    ...(m.location ? { address: { '@type': 'PostalAddress', addressLocality: m.location } } : {}),
    ...(Array.isArray(m.links) && m.links.length
      ? { sameAs: m.links.map((l) => l?.url).filter((u) => typeof u === 'string' && u.startsWith('https://')) }
      : {}),
    ...(Array.isArray(m.workCategories) && m.workCategories.length ? { knowsAbout: m.workCategories } : {}),
    ...(profile?.activity?.toolsUsed?.length
      ? { knowsAbout: [...new Set([...(m.workCategories ?? []), ...profile.activity.toolsUsed])] }
      : {}),
  };

  if (
    injectLd(path.join('u', m.handle, 'index.html'), {
      '@context': 'https://schema.org',
      '@type': 'ProfilePage',
      url: `${SITE}/u/${m.handle}`,
      isPartOf: { '@id': `${SITE}/#website` },
      ...(profile?.activity?.lastActiveDate ? { dateModified: profile.activity.lastActiveDate } : {}),
      mainEntity: person,
    })
  ) injected += 1;
}

console.log(`seo: sitemap ${urls.length} urls, JSON-LD on ${injected} pages`);
