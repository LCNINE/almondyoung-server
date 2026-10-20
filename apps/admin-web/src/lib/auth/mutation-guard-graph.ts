import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { requirementCovered, scanFile, type FileScan, type ScannedRequirement } from './mutation-guard-scan';

/**
 * admin-web 전체를 읽어 «뮤테이션 훅 선언 · 그 훅을 부르는 화면 파일 · 그 파일과 그 위(import 한 쪽) 의 판정» 을 잇는다.
 * 게이트 전용(앱 코드가 import 하지 않는다).
 */
export interface HookRef {
  /** `<src 기준 파일>#<export 이름>` */
  readonly key: string;
  readonly file: string;
  readonly name: string;
  readonly line: number;
  readonly requirement: ScannedRequirement | null;
}

export interface Analysis {
  readonly files: ReadonlyMap<string, FileScan>;
  readonly hooks: ReadonlyMap<string, HookRef>;
  readonly inline: readonly { readonly file: string; readonly line: number; readonly requirement: ScannedRequirement | null }[];
  /** 화면 파일 → 그 파일이 부르는 (다른 파일의) 뮤테이션 훅 */
  readonly consumers: ReadonlyMap<string, readonly HookRef[]>;
  /** 화면 판정이 덮지 못한 «파일 :: 훅» (훅 선언이 없으면 판단하지 않는다 — 선언 누락은 따로 센다) */
  readonly uncovered: readonly string[];
}

const SKIP = /\.(spec|test)\.tsx?$|\.d\.ts$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !SKIP.test(e.name)) out.push(p);
  }
  return out;
}

/** 화면 쪽 파일인가(서비스·API 계층은 훅을 «정의»할 뿐 버튼을 그리지 않는다) */
const isUiFile = (rel: string) => !/^lib\/(services|api)\//.test(rel);

export function analyzeAdminWeb(srcDir: string, screenKeys: (screen: string) => readonly string[]): Analysis {
  const abs = walk(srcDir);
  const files = new Map<string, FileScan>();
  for (const f of abs) files.set(relative(srcDir, f), scanFile(f, readFileSync(f, 'utf8')));
  const fileSet = new Set(files.keys());

  const resolveModule = (fromRel: string, spec: string): string | null => {
    let base: string;
    if (spec.startsWith('@/')) base = spec.slice(2);
    else if (spec.startsWith('.')) base = relative(srcDir, resolve(srcDir, dirname(fromRel), spec));
    else return null;
    for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) if (fileSet.has(c)) return c;
    return null;
  };

  // export 이름 → 실제 선언 파일(re-export·barrel 을 따라간다)
  const resolveExport = (fileRel: string, name: string, seen = new Set<string>()): string | null => {
    const id = `${fileRel}#${name}`;
    if (seen.has(id)) return null;
    seen.add(id);
    const scan = files.get(fileRel);
    if (!scan) return null;
    if (scan.hooks.some((h) => h.name === name)) return fileRel;
    const named = scan.reexportNamed.get(name);
    if (named) {
      const m = resolveModule(fileRel, named.from);
      return m ? resolveExport(m, named.name, seen) : null;
    }
    for (const from of scan.reexportAll) {
      const m = resolveModule(fileRel, from);
      const r = m ? resolveExport(m, name, seen) : null;
      if (r) return r;
    }
    return null;
  };

  const hooks = new Map<string, HookRef>();
  for (const [file, scan] of files) for (const h of scan.hooks) hooks.set(`${file}#${h.name}`, { key: `${file}#${h.name}`, file, name: h.name, line: h.line, requirement: h.requirement });

  // 파일 안의 식별자 → 뮤테이션 훅
  const hookOf = (fileRel: string, ident: string): HookRef | null => {
    const scan = files.get(fileRel);
    if (!scan) return null;
    const local = hooks.get(`${fileRel}#${ident}`);
    if (local) return local;
    const imp = scan.imports.get(ident);
    if (!imp || imp.name === '*' || imp.name === 'default') return null;
    const m = resolveModule(fileRel, imp.from);
    const decl = m ? resolveExport(m, imp.name) : null;
    return decl ? hooks.get(`${decl}#${imp.name}`) ?? null : null;
  };

  // import 그래프(역방향) — 이 파일을 그리는 쪽
  const importers = new Map<string, Set<string>>();
  for (const [file, scan] of files) {
    const targets = [...new Set([...[...scan.imports.values()].map((i) => i.from), ...scan.reexportAll, ...[...scan.reexportNamed.values()].map((r) => r.from), ...scan.dynamicImports])];
    for (const t of targets) {
      const m = resolveModule(file, t);
      if (!m) continue;
      if (!importers.has(m)) importers.set(m, new Set());
      importers.get(m)!.add(file);
    }
  }
  // Next 레이아웃은 같은 폴더·하위 폴더의 페이지를 감싼다 — 레이아웃의 화면 판정도 그 페이지의 판정이다.
  for (const file of fileSet) {
    if (!/(^|\/)page\.tsx$/.test(file)) continue;
    for (let dir = dirname(file); dir !== '.' && dir !== ''; dir = dirname(dir)) {
      const layout = `${dir}/layout.tsx`;
      if (fileSet.has(layout)) {
        if (!importers.has(file)) importers.set(file, new Set());
        importers.get(file)!.add(layout);
      }
      if (dir === 'app') break;
    }
  }
  const ancestors = (file: string): Set<string> => {
    const seen = new Set([file]);
    const stack = [file];
    while (stack.length) for (const p of importers.get(stack.pop()!) ?? []) if (!seen.has(p)) { seen.add(p); stack.push(p); }
    return seen;
  };

  // 파일 하나가 보태는 판정 키: 직접 적은 키 + run 이 가리킨 훅의 요구 키 + 화면 진입 권한
  const ownKeys = new Map<string, Set<string>>();
  const keysOf = (file: string): Set<string> => {
    const cached = ownKeys.get(file);
    if (cached) return cached;
    const scan = files.get(file)!;
    const keys = new Set(scan.guardKeys);
    for (const id of scan.guardRuns) {
      const h = hookOf(file, id);
      const req = h?.requirement;
      if (!req || req === 'self') continue;
      for (const k of typeof req === 'object' && 'allOf' in req ? req.allOf.flat() : req) keys.add(k);
    }
    for (const s of scan.screens) for (const k of screenKeys(s)) keys.add(k);
    ownKeys.set(file, keys);
    return keys;
  };

  const consumers = new Map<string, HookRef[]>();
  const inline: { file: string; line: number; requirement: ScannedRequirement | null }[] = [];
  const uncovered: string[] = [];
  for (const [file, scan] of files) {
    for (const m of scan.inline) inline.push({ file, line: m.line, requirement: m.requirement });
    if (!isUiFile(file)) continue;
    const used = [...scan.calledHooks].map((id) => hookOf(file, id)).filter((h): h is HookRef => !!h && h.file !== file);
    const inlineReqs = scan.inline.map((m) => ({ label: `inline@${m.line}`, requirement: m.requirement }));
    if (used.length === 0 && inlineReqs.length === 0) continue;
    if (used.length) consumers.set(file, used);
    const keys = new Set<string>();
    for (const a of ancestors(file)) for (const k of keysOf(a)) keys.add(k);
    for (const h of used) if (h.requirement && !requirementCovered(h.requirement, keys)) uncovered.push(`${file} :: ${h.name}`);
    for (const m of inlineReqs) if (m.requirement && !requirementCovered(m.requirement, keys)) uncovered.push(`${file} :: ${m.label}`);
  }
  return { files, hooks, inline, consumers, uncovered: uncovered.sort() };
}
