import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import {
  SCAN_CACHE_VERSION,
  computeProjectSignature,
  computeRootSignature,
  loadCheckpoint,
  saveCheckpoint,
} from './lib/scanCache';

/** Bump to invalidate every cached scan result after changing scan semantics. */
const SCAN_CACHE_VERSION_TAG = 'scanner-0.4.0';
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

/**
 * Filesystem safety for a scanner that walks the user's home directory.
 *
 * Three holes this closes:
 *  1. SYMLINK ESCAPE — statSync follows links, so a symlink inside an approved
 *     root could point anywhere (~/.ssh, /etc) and be walked or read.
 *  2. SPECIAL FILES — a FIFO/socket/device node named `notes.md` would be opened
 *     by readFileSync and could block the collector forever.
 *  3. TOCTOU — the path could be swapped between the stat and the read.
 *
 * Approved roots are captured once per scan; every resolved path must still sit
 * inside one of them AFTER symlink resolution.
 */
let approvedRoots: string[] = [];

export function setApprovedRoots(roots: string[]): void {
  approvedRoots = roots
    .map((root) => {
      try {
        return realpathSync(root);
      } catch {
        return null;
      }
    })
    .filter((root): root is string => root !== null);
}

function withinApprovedRoot(resolved: string): boolean {
  if (!approvedRoots.length) return true; // no roots configured => scanner not in use
  return approvedRoots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`));
}

/** Resolve symlinks and confirm the target is still inside an approved root. */
function safeResolve(target: string): string | null {
  try {
    const resolved = realpathSync(target);
    return withinApprovedRoot(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

/** True only for a real directory that does not escape the approved roots. */
function isSafeDir(target: string): boolean {
  try {
    if (lstatSync(target).isSymbolicLink()) {
      const resolved = safeResolve(target);
      if (!resolved) return false;
      return statSync(resolved).isDirectory();
    }
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Read a file only if it is a REGULAR file inside an approved root.
 * Rejects symlink escapes, FIFOs, sockets, and device nodes, and re-checks the
 * descriptor's identity after opening to close the TOCTOU window.
 */
function safeReadTextFile(target: string, maxBytes: number): string | null {
  try {
    const link = lstatSync(target);
    let real = target;
    if (link.isSymbolicLink()) {
      const resolved = safeResolve(target);
      if (!resolved) return null;
      real = resolved;
    } else if (!link.isFile()) {
      return null; // FIFO, socket, device node, etc.
    }
    const st = statSync(real);
    if (!st.isFile() || st.size > maxBytes) return null;
    if (!withinApprovedRoot(realpathSync(real))) return null;
    return readFileSync(real, 'utf8');
  } catch {
    return null;
  }
}

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
  if (!isSafeDir(root) || depth > maxDepth || out.length > 20000) return out;
  let entries: string[] = [];
  try { entries = readdirSync(root); } catch { return out; }
  for (const entry of entries) {
    if (entry.startsWith('.') || SKIP.has(entry)) continue;
    const full = path.join(root, entry);
    if (!isSafeDir(full)) continue; // rejects symlink escapes and non-directories
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

/**
 * Per-run memo for readTextEvidence.
 *
 * scoreCandidate() runs once per (project definition x candidate directory), but
 * the text evidence depends ONLY on the directory. Without this memo the same
 * directory was read up to 8 times per scan — 8x the file I/O for identical
 * bytes. This alone removes most of the cold-scan cost.
 */
const textEvidenceMemo = new Map<string, string>();

function readTextEvidence(dir: string, maxFiles = 80) {
  const memoized = textEvidenceMemo.get(dir);
  if (memoized !== undefined) return memoized;
  const chunks: string[] = [];
  let files = 0;
  function walk(current: string, depth: number) {
    if (depth > 3 || files >= maxFiles) return;
    let entries: string[] = [];
    try { entries = readdirSync(current); } catch { return; }
    for (const entry of entries) {
      if (entry.startsWith('.') || SKIP.has(entry) || files >= maxFiles) continue;
      const full = path.join(current, entry);
      if (isSafeDir(full)) { walk(full, depth + 1); continue; }
      const ext = path.extname(entry).toLowerCase();
      if (!TEXT_EXT.has(ext)) continue;
      // Regular files only, inside an approved root, size-capped, TOCTOU-rechecked.
      const text = safeReadTextFile(full, 250_000);
      if (text === null) continue;
      chunks.push(text.slice(0, 20_000));
      files += 1;
    }
  }
  walk(dir, 0);
  const evidence = chunks.join('\n').toLowerCase();
  textEvidenceMemo.set(dir, evidence);
  return evidence;
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
      let st;
      try { st = lstatSync(full); } catch { continue; }
      if (st.isSymbolicLink()) continue; // never follow links while counting
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
  // Capture the approved roots BEFORE walking: every path we later resolve must
  // still live inside one of them, so a symlink cannot lead the scanner out.
  setApprovedRoots(roots);
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

const notFound = (def: ProjectDef, reason: string): QiraProjectScan => ({
  name: def.name,
  category: def.category,
  status: def.status,
  publicUrl: def.publicUrl,
  description: def.description,
  found: false,
  stack: [],
  scripts: [],
  fileCounts: {},
  lastModified: null,
  scannerWarnings: [reason],
});

export interface ScanOptions {
  /** Ignore the checkpoint and re-walk everything. */
  force?: boolean;
}

export interface ScanStats {
  reusedFromCheckpoint: number;
  rescanned: number;
  fullDiscovery: boolean;
}

/**
 * Scan the allowlisted projects, reusing the previous run's work when nothing
 * relevant changed.
 *
 * Fast path: the root signature is unchanged and each project's git/mtime
 * signature is unchanged, so every result is reused and no directory walk
 * happens at all.
 *
 * Slow path: the root signature changed (a project appeared or disappeared) or a
 * project has no cached directory, so we fall back to the full depth-5 discovery
 * walk. Correctness never depends on the cache — it only skips recomputation.
 */
export function scanQiraProjects(options: ScanOptions = {}) {
  const config = localConfig();
  const roots = scanRoots();
  setApprovedRoots(roots);
  textEvidenceMemo.clear();

  const force = options.force || process.env.TOKENS_SCAN_FORCE === '1';
  const rootSignature = computeRootSignature(roots);
  const checkpoint = force ? null : loadCheckpoint<QiraProjectScan>(SCAN_CACHE_VERSION_TAG);
  const rootsUnchanged = checkpoint?.rootSignature === rootSignature;

  const stats: ScanStats = { reusedFromCheckpoint: 0, rescanned: 0, fullDiscovery: false };
  const nextProjects: Record<string, { dir: string; signature: string; result: QiraProjectScan }> = {};

  // Discovery is lazy: only pay for the depth-5 walk if some project actually
  // needs it. In steady state this stays null and the scan is near-instant.
  let discovered: string[] | null = null;
  const dirsForDiscovery = () => {
    if (discovered === null) {
      stats.fullDiscovery = true;
      discovered = [...new Set(roots.flatMap((root) => listDirs(root)))];
    }
    return discovered;
  };

  const used = new Set<string>();
  const scans = PROJECTS.map((def) => {
    const explicit = explicitPathFor(def, config);
    const cached = rootsUnchanged ? checkpoint?.projects[def.name] : undefined;

    // Fast path A: previously searched for and not found. With the root name set
    // unchanged, re-running discovery would reach the same conclusion, so reuse
    // it. Without this, every unfound project forced a full depth-5 walk.
    if (!explicit && cached && cached.dir === '') {
      stats.reusedFromCheckpoint += 1;
      nextProjects[def.name] = cached;
      return cached.result;
    }

    // Fast path B: known directory whose signature has not moved.
    if (!explicit && cached && safeStat(cached.dir)?.isDirectory()) {
      const signature = computeProjectSignature(cached.dir);
      if (signature === cached.signature) {
        stats.reusedFromCheckpoint += 1;
        used.add(cached.dir);
        nextProjects[def.name] = cached;
        return cached.result;
      }
      // Changed, but we still know where it lives — re-analyze just this project
      // without re-running discovery across every root.
      stats.rescanned += 1;
      const candidate = scoreCandidate(def, cached.dir);
      used.add(candidate.gitRoot || candidate.dir);
      const result = analyze(def, candidate);
      nextProjects[def.name] = { dir: cached.dir, signature, result };
      return result;
    }

    if (explicit) {
      const candidate = scoreCandidate(def, explicit);
      used.add(candidate.gitRoot || candidate.dir);
      const result = analyze(def, { ...candidate, score: Math.max(candidate.score, 10000), reasons: ['explicit-path', ...candidate.reasons] }, true);
      nextProjects[def.name] = { dir: explicit, signature: computeProjectSignature(explicit), result };
      return result;
    }

    // Slow path: full discovery.
    stats.rescanned += 1;
    const candidates = bestCandidates(def, dirsForDiscovery()).filter((candidate) => !used.has(candidate.gitRoot || candidate.dir));
    const candidate = candidates[0];
    if (!candidate) {
      // Cache the negative result so the next run does not re-walk every root.
      const missing = notFound(def, 'no-scored-candidate');
      nextProjects[def.name] = { dir: '', signature: 'not-found', result: missing };
      return missing;
    }
    used.add(candidate.gitRoot || candidate.dir);
    const result = analyze(def, candidate);
    nextProjects[def.name] = { dir: candidate.dir, signature: computeProjectSignature(candidate.dir), result };
    return result;
  });

  saveCheckpoint<QiraProjectScan>({
    schemaVersion: SCAN_CACHE_VERSION,
    collectorVersion: SCAN_CACHE_VERSION_TAG,
    rootSignature,
    projects: nextProjects,
    updatedAt: new Date().toISOString(),
  });

  return {
    projects: scans,
    scanner: {
      rootsChecked: roots.length,
      allowlistedProjects: PROJECTS.length,
      foundProjects: scans.filter((scan) => scan.found).length,
      privacyMode: 'allowlist_no_paths' as const,
    },
    stats,
  };
}
