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
  domains: string[];
};

type Candidate = {
  dir: string;
  gitRoot: string | null;
  base: string;
  score: number;
  reasons: string[];
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
  { name: 'Qira Main', category: 'Company Surface', status: 'public', publicUrl: 'https://imagineqira.com', description: 'Primary Qira research and product site.', aliases: ['imagineqira', 'imagine-qira', 'qira-site', 'qira-main'], domains: ['imagineqira.com', 'www.imagineqira.com'] },
  { name: 'LOLM', category: 'Research', status: 'research', description: 'Latent Order Language Model architecture and validation work.', aliases: ['lolm', 'lolm-nfet', 'lolm-nfet-client', 'latent-order'], domains: ['lolm.autohustle.online', 'lolm.imagineqira.com'] },
  { name: 'NFET / QEV', category: 'Research', status: 'research', description: 'Verification, encryption, and proof-layer experiments.', aliases: ['qev', 'nfet', 'qev-desktop', 'qev-secure', 'secure-qev', 'bry-nfet', 'qira-encryption-vault'], domains: ['secure.imagineqira.com', 'qev-desktop', 'mydigital.imagineqira.com'] },
  { name: 'My Digital', category: 'Product', status: 'shipping', publicUrl: 'https://mydigital.imagineqira.com', description: 'QEV-backed digital goods and licensing surface.', aliases: ['my-digital', 'mydigital', 'mydigital-imagineqira', 'digital-marketplace'], domains: ['mydigital.imagineqira.com'] },
  { name: 'Codey', category: 'Product', status: 'shipping', publicUrl: 'https://codey.imagineqira.com', description: 'Qira builder and agent-product workspace.', aliases: ['codey', 'codey-imagineqira', 'codey-ai'], domains: ['codey.imagineqira.com', 'codey.autohustle.online'] },
  { name: 'PTI', category: 'Intelligence', status: 'active', publicUrl: 'https://pti.imagineqira.com', description: 'Phoenix traffic intelligence surface.', aliases: ['pti', 'pti-phoenix', 'pti-imagineqira', 'phoenix-traffic'], domains: ['pti.imagineqira.com'] },
  { name: 'Question', category: 'Public Experiment', status: 'active', publicUrl: 'https://question.imagineqira.com', description: 'Qira question and cognition experiment.', aliases: ['question', 'question-imagineqira', 'qira-question'], domains: ['question.imagineqira.com'] },
  { name: 'TOKENS', category: 'Proof Infrastructure', status: 'instrumented', description: 'Public AI-agent usage observatory.', aliases: ['tokens', 'qira-agent-usage-observatory', 'qira-ledger'], domains: ['ledger.imagineqira.com'] },
];

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.turbo', 'coverage', '.cache', 'vendor', '.venv', '__pycache__']);
const TEXT_EXT = new Set(['.json', '.md', '.txt', '.html', '.tsx', '.ts', '.jsx', '.js', '.css', '.py', '.toml', '.yml', '.yaml']);
const EXT_TO_KIND: Record<string, string> = { '.ts': 'ts', '.tsx': 'tsx', '.js': 'js', '.jsx': 'jsx', '.py': 'py', '.md': 'docs', '.json': 'json', '.css': 'css', '.html': 'html', '.sol': 'sol', '.rs': 'rs', '.go': 'go', '.sql': 'sql' };

function homePath(...parts: string[]) { return path.join(process.env.HOME || process.cwd(), ...parts); }
function expandHome(value: string) { return value.startsWith('~/') ? path.join(process.env.HOME || '', value.slice(2)) : value; }
function normalize(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function safeStat(target: string) { try { return statSync(target); } catch { return null; } }

function scanRoots() {
  const fromEnv = process.env.QIRA_SCAN_ROOTS?.split(',').map((item) => expandHome(item.trim())).filter(Boolean);
  if (fromEnv?.length) return fromEnv;
  return [homePath('Projects'), homePath('nous'), homePath('Developer'), homePath('Code'), homePath('Desktop'), homePath('Sites'), homePath('Documents')];
}

function localConfig(): Record<string, string> {
  const configPath = process.env.QIRA_PROJECT_CONFIG || path.join(process.cwd(), 'collector', 'local-qira-projects.json');
  if (!existsSync(configPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, string>;
    return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [normalize(key), expandHome(value)]));
  } catch {
    return {};
  }
}

function runGit(dir: string, args: string[]) {
  const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function gitRoot(dir: string) { return runGit(dir, ['rev-parse', '--show-toplevel']); }

function listDirs(root: string, depth = 0, maxDepth = 5, out: string[] = []) {
  const st = safeStat(root);
  if (!st?.isDirectory() || depth > maxDepth || out.length > 20000) return out;
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

function packageInfo(dir: string) {
  const pkgPath = path.join(dir, 'package.json');
  if (!existsSync(pkgPath)) return { name: '', scripts: [] as string[], deps: [] as string[], raw: '' };
  try {
    const raw = readFileSync(pkgPath, 'utf8');
    const pkg = JSON.parse(raw) as { name?: string; scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    return { name: pkg.name || '', scripts: Object.keys(pkg.scripts || {}).slice(0, 14), deps: Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }), raw };
  } catch {
    return { name: '', scripts: [] as string[], deps: [] as string[], raw: '' };
  }
}

function readTextEvidence(dir: string, maxFiles = 80) {
  const chunks: string[] = [];
  let files = 0;
  function walk(current: string, depth: number) {
    if (depth > 3 || files >= maxFiles) return;
    let entries: string[] = [];
    try { entries = readdirSync(current); } catch { return; }
    for (const entry of entries) {
      if (entry.startsWith('.') || SKIP.has(entry) || files >= maxFiles) continue;
      const full = path.join(current, entry);
      const st = safeStat(full);
      if (!st) continue;
      if (st.isDirectory()) { walk(full, depth + 1); continue; }
      const ext = path.extname(entry).toLowerCase();
      if (!TEXT_EXT.has(ext) || st.size > 250_000) continue;
      try { chunks.push(readFileSync(full, 'utf8').slice(0, 20_000)); files += 1; } catch {}
    }
  }
  walk(dir, 0);
  return chunks.join('\n').toLowerCase();
}

function scoreCandidate(def: ProjectDef, dir: string): Candidate {
  const base = normalize(path.basename(dir));
  const aliases = def.aliases.map(normalize);
  const pkg = packageInfo(dir);
  const evidence = `${pkg.name}\n${pkg.raw}\n${runGit(dir, ['config', '--get', 'remote.origin.url']) || ''}\n${readTextEvidence(dir)}`.toLowerCase();
  const reasons: string[] = [];
  let score = 0;
  for (const alias of aliases) {
    if (base === alias) { score += 340; reasons.push(`folder=${alias}`); }
    else if (base.includes(alias)) { score += 170; reasons.push(`folder~${alias}`); }
    if (normalize(pkg.name) === alias || normalize(pkg.name).includes(alias)) { score += 260; reasons.push(`package~${alias}`); }
    if (evidence.includes(alias.replace(/-/g, ' ')) || evidence.includes(alias)) { score += 55; reasons.push(`text~${alias}`); }
  }
  for (const domain of def.domains) {
    if (evidence.includes(domain.toLowerCase())) { score += 420; reasons.push(`domain=${domain}`); }
  }
  if (existsSync(path.join(dir, 'package.json'))) { score += 30; reasons.push('package.json'); }
  if (existsSync(path.join(dir, 'vite.config.ts')) || existsSync(path.join(dir, 'vite.config.js'))) { score += 25; reasons.push('vite'); }
  if (existsSync(path.join(dir, 'next.config.ts')) || existsSync(path.join(dir, 'next.config.js'))) { score += 25; reasons.push('next'); }
  if (existsSync(path.join(dir, 'requirements.txt')) || existsSync(path.join(dir, 'pyproject.toml'))) { score += 20; reasons.push('python'); }
  return { dir, gitRoot: gitRoot(dir), base, score, reasons: [...new Set(reasons)].slice(0, 8) };
}

function explicitPathFor(def: ProjectDef, config: Record<string, string>) {
  const keys = [def.name, ...def.aliases].map(normalize);
  for (const key of keys) {
    const candidate = config[key];
    if (candidate && safeStat(candidate)?.isDirectory()) return candidate;
  }
  return null;
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
  addIf('SQLite', existsSync(path.join(dir, 'sqlite.db')) || existsSync(path.join(dir, 'database.sqlite')));
  return [...stack].slice(0, 10);
}

function countFiles(dir: string) {
  const counts: Record<string, number> = {};
  let latest = 0;
  let seen = 0;
  function walk(current: string, depth: number) {
    if (depth > 6 || seen > 12000) return;
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

function analyze(def: ProjectDef, candidate: Candidate, explicit = false): QiraProjectScan {
  const dir = candidate.dir;
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
    scannerWarnings: [`match:${explicit ? 'explicit' : 'scored'} score:${candidate.score} ${candidate.reasons.join(', ')}`],
  };
}

function allCandidates() {
  const roots = scanRoots();
  const dirs = [...new Set(roots.flatMap((root) => listDirs(root)))];
  return { roots, dirs };
}

function bestCandidates(def: ProjectDef, dirs: string[]) {
  return dirs.map((dir) => scoreCandidate(def, dir)).filter((candidate) => candidate.score >= 120).sort((a, b) => b.score - a.score).slice(0, 12);
}

export function debugQiraCandidates() {
  const { roots, dirs } = allCandidates();
  return { roots, projects: PROJECTS.map((def) => ({ name: def.name, candidates: bestCandidates(def, dirs).slice(0, 8).map((candidate) => ({ path: candidate.dir, score: candidate.score, reasons: candidate.reasons })) })) };
}

export function scanQiraProjects() {
  const config = localConfig();
  const { roots, dirs } = allCandidates();
  const used = new Set<string>();
  const scans = PROJECTS.map((def) => {
    const explicit = explicitPathFor(def, config);
    if (explicit) {
      const candidate = scoreCandidate(def, explicit);
      used.add(candidate.gitRoot || candidate.dir);
      return analyze(def, { ...candidate, score: Math.max(candidate.score, 10000), reasons: ['explicit-path', ...candidate.reasons] }, true);
    }
    const candidates = bestCandidates(def, dirs).filter((candidate) => !used.has(candidate.gitRoot || candidate.dir));
    const candidate = candidates[0];
    if (!candidate) return { name: def.name, category: def.category, status: def.status, publicUrl: def.publicUrl, description: def.description, found: false, stack: [], scripts: [], fileCounts: {}, lastModified: null, scannerWarnings: ['no-scored-candidate'] } satisfies QiraProjectScan;
    used.add(candidate.gitRoot || candidate.dir);
    return analyze(def, candidate);
  });
  return { projects: scans, scanner: { rootsChecked: roots.length, allowlistedProjects: PROJECTS.length, foundProjects: scans.filter((scan) => scan.found).length, privacyMode: 'allowlist_no_paths' as const } };
}
