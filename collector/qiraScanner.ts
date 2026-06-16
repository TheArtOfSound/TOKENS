import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

type ProjectDef = {
  name: string;
  category: string;
  status: string;
  publicUrl?: string;
  description: string;
  aliases: string[];
};

export type QiraProjectScan = {
  name: string;
  category: string;
  status: string;
  publicUrl?: string;
  description: string;
  found: boolean;
  git?: { branch: string | null; commit: string | null; changedFiles: number | null };
  stack: string[];
  scripts: string[];
  fileCounts: Record<string, number>;
  lastModified: string | null;
  scannerWarnings: string[];
};

const PROJECTS: ProjectDef[] = [
  { name: 'Qira Main', category: 'Company Surface', status: 'public', publicUrl: 'https://imagineqira.com', description: 'Primary Qira research and product site.', aliases: ['imagineqira', 'imagine-qira', 'qira-site', 'qira-main'] },
  { name: 'LOLM', category: 'Research', status: 'research', description: 'Latent Order Language Model architecture and validation work.', aliases: ['lolm', 'lolm-nfet', 'lolm-nfet-client'] },
  { name: 'NFET / QEV', category: 'Research', status: 'research', description: 'Verification, encryption, and proof-layer experiments.', aliases: ['qev', 'nfet', 'qev-desktop', 'qev-secure', 'secure-qev'] },
  { name: 'My Digital', category: 'Product', status: 'shipping', publicUrl: 'https://mydigital.imagineqira.com', description: 'QEV-backed digital goods and licensing surface.', aliases: ['my-digital', 'mydigital', 'mydigital-imagineqira'] },
  { name: 'Codey', category: 'Product', status: 'shipping', publicUrl: 'https://codey.imagineqira.com', description: 'Qira builder and agent-product workspace.', aliases: ['codey', 'codey-imagineqira'] },
  { name: 'PTI', category: 'Intelligence', status: 'active', publicUrl: 'https://pti.imagineqira.com', description: 'Phoenix traffic intelligence surface.', aliases: ['pti', 'pti-phoenix', 'pti-imagineqira'] },
  { name: 'Question', category: 'Public Experiment', status: 'active', publicUrl: 'https://question.imagineqira.com', description: 'Qira question and cognition experiment.', aliases: ['question', 'question-imagineqira'] },
  { name: 'TOKENS', category: 'Proof Infrastructure', status: 'instrumented', description: 'Public AI-agent usage observatory.', aliases: ['tokens', 'qira-agent-usage-observatory'] },
];

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.turbo', 'coverage', '.cache']);
const EXT_TO_KIND: Record<string, string> = { '.ts': 'ts', '.tsx': 'tsx', '.js': 'js', '.jsx': 'jsx', '.py': 'py', '.md': 'docs', '.json': 'json', '.css': 'css', '.html': 'html', '.sol': 'sol', '.rs': 'rs' };

function homePath(...parts: string[]) {
  return path.join(process.env.HOME || process.cwd(), ...parts);
}

function scanRoots() {
  const fromEnv = process.env.QIRA_SCAN_ROOTS?.split(',').map((item) => item.trim()).filter(Boolean);
  return fromEnv?.length ? fromEnv : [homePath('Projects'), homePath('Developer'), homePath('Code'), homePath('Desktop')];
}

function safeStat(target: string) {
  try { return statSync(target); } catch { return null; }
}

function listDirs(root: string, depth = 0, maxDepth = 2, out: string[] = []) {
  const st = safeStat(root);
  if (!st?.isDirectory() || depth > maxDepth) return out;
  let entries: string[] = [];
  try { entries = readdirSync(root); } catch { return out; }
  for (const entry of entries) {
    if (entry.startsWith('.') || SKIP.has(entry)) continue;
    const full = path.join(root, entry);
    const childStat = safeStat(full);
    if (!childStat?.isDirectory()) continue;
    out.push(full);
    if (depth < maxDepth) listDirs(full, depth + 1, maxDepth, out);
  }
  return out;
}

function matches(def: ProjectDef, dir: string) {
  const base = path.basename(dir).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return def.aliases.some((alias) => base === alias || base.includes(alias));
}

function runGit(dir: string, args: string[]) {
  const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function packageInfo(dir: string) {
  const pkgPath = path.join(dir, 'package.json');
  if (!existsSync(pkgPath)) return { scripts: [] as string[], deps: [] as string[] };
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    return { scripts: Object.keys(pkg.scripts || {}).slice(0, 14), deps: Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }) };
  } catch {
    return { scripts: [] as string[], deps: [] as string[] };
  }
}

function detectStack(dir: string, deps: string[]) {
  const stack = new Set<string>();
  const addIf = (name: string, condition: boolean) => { if (condition) stack.add(name); };
  addIf('React', deps.includes('react'));
  addIf('Next.js', deps.includes('next'));
  addIf('Vite', deps.includes('vite') || existsSync(path.join(dir, 'vite.config.ts')) || existsSync(path.join(dir, 'vite.config.js')));
  addIf('TypeScript', deps.includes('typescript') || existsSync(path.join(dir, 'tsconfig.json')));
  addIf('Tailwind', deps.includes('tailwindcss') || existsSync(path.join(dir, 'tailwind.config.js')) || existsSync(path.join(dir, 'tailwind.config.ts')));
  addIf('Prisma', deps.includes('prisma') || existsSync(path.join(dir, 'prisma')));
  addIf('Supabase', deps.includes('@supabase/supabase-js'));
  addIf('Three.js', deps.includes('three'));
  addIf('Python', existsSync(path.join(dir, 'requirements.txt')) || existsSync(path.join(dir, 'pyproject.toml')));
  addIf('Solana', deps.some((dep) => dep.includes('solana')));
  return [...stack].slice(0, 10);
}

function countFiles(dir: string) {
  const counts: Record<string, number> = {};
  let latest = 0;
  let seen = 0;
  function walk(current: string, depth: number) {
    if (depth > 5 || seen > 9000) return;
    let entries: string[] = [];
    try { entries = readdirSync(current); } catch { return; }
    for (const entry of entries) {
      if (entry.startsWith('.') || SKIP.has(entry)) continue;
      const full = path.join(current, entry);
      const st = safeStat(full);
      if (!st) continue;
      latest = Math.max(latest, st.mtimeMs);
      if (st.isDirectory()) walk(full, depth + 1);
      if (st.isFile()) {
        seen += 1;
        const kind = EXT_TO_KIND[path.extname(entry).toLowerCase()];
        if (kind) counts[kind] = (counts[kind] || 0) + 1;
      }
    }
  }
  walk(dir, 0);
  return { counts, lastModified: latest ? new Date(latest).toISOString() : null };
}

function analyze(def: ProjectDef, dir: string): QiraProjectScan {
  const warnings: string[] = [];
  const { scripts, deps } = packageInfo(dir);
  const { counts, lastModified } = countFiles(dir);
  const branch = runGit(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const commit = runGit(dir, ['rev-parse', '--short', 'HEAD']);
  const status = runGit(dir, ['status', '--porcelain']);
  return {
    name: def.name,
    category: def.category,
    status: def.status,
    publicUrl: def.publicUrl,
    description: def.description,
    found: true,
    git: { branch, commit, changedFiles: status === null ? null : status.split('\n').filter(Boolean).length },
    stack: detectStack(dir, deps),
    scripts,
    fileCounts: counts,
    lastModified,
    scannerWarnings: warnings,
  };
}

export function scanQiraProjects() {
  const roots = scanRoots();
  const dirs = roots.flatMap((root) => listDirs(root));
  const scans = PROJECTS.map((def) => {
    const dir = dirs.find((candidate) => matches(def, candidate));
    if (!dir) return { name: def.name, category: def.category, status: def.status, publicUrl: def.publicUrl, description: def.description, found: false, stack: [], scripts: [], fileCounts: {}, lastModified: null, scannerWarnings: [] } satisfies QiraProjectScan;
    return analyze(def, dir);
  });
  return {
    projects: scans,
    scanner: { rootsChecked: roots.length, allowlistedProjects: PROJECTS.length, foundProjects: scans.filter((scan) => scan.found).length, privacyMode: 'allowlist_no_paths' as const },
  };
}
