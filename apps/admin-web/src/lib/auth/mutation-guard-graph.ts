import { readdirSync, readFileSync } from 'node:fs';
import * as ts from 'typescript';
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

/** `@/…`·상대 경로 지정자 → src 기준 파일(src 밖·패키지는 null) */
function moduleResolver(srcDir: string, known: { has(rel: string): boolean }) {
  return (fromRel: string, spec: string): string | null => {
    let base: string;
    if (spec.startsWith('@/')) base = spec.slice(2);
    else if (spec.startsWith('.')) base = relative(srcDir, resolve(srcDir, dirname(fromRel), spec));
    else return null;
    for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) if (known.has(c)) return c;
    return null;
  };
}

interface ValueEdges {
  /** 값으로 쓰는 import — local: 이 파일 안 이름, name: export 이름, '*'(네임스페이스), null(부수효과 import) */
  readonly imports: readonly { readonly local: string; readonly from: string; readonly name: string | null }[];
  readonly reexportNamed: ReadonlyMap<string, { readonly from: string; readonly name: string }>;
  readonly reexportAll: readonly string[];
  readonly dynamicImports: readonly string[];
  /** 이 파일이 직접 선언해 내보내는 값 이름('default' 포함)과 타입 이름 */
  readonly ownExports: ReadonlySet<string>;
  readonly ownTypes: ReadonlySet<string>;
  /** 타입 전용까지 포함한 모든 import·re-export·동적 import 지정자(부수효과 import 제외) — 파일 단위 간선 */
  readonly moduleSpecs: readonly string[];
}

const hasExport = (n: ts.Node) => ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
const hasDefault = (n: ts.Node) => ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);

function scanValueEdges(fileName: string, source: string): ValueEdges {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, /\.tsx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const imports: { local: string; from: string; name: string | null }[] = [];
  const reexportNamed = new Map<string, { from: string; name: string }>();
  const reexportAll: string[] = [];
  const dynamicImports: string[] = [];
  const ownExports = new Set<string>();
  const ownTypes = new Set<string>();
  for (const s of sf.statements) {
    if (ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier)) {
      const from = s.moduleSpecifier.text;
      const clause = s.importClause;
      if (!clause) imports.push({ local: '', from, name: null });
      else if (!clause.isTypeOnly) {
        if (clause.name) imports.push({ local: clause.name.text, from, name: 'default' });
        const nb = clause.namedBindings;
        if (nb && ts.isNamespaceImport(nb)) imports.push({ local: nb.name.text, from, name: '*' });
        if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) if (!el.isTypeOnly) imports.push({ local: el.name.text, from, name: (el.propertyName ?? el.name).text });
      }
    } else if (ts.isExportDeclaration(s)) {
      if (s.isTypeOnly) continue;
      const from = s.moduleSpecifier && ts.isStringLiteral(s.moduleSpecifier) ? s.moduleSpecifier.text : null;
      if (from && !s.exportClause) reexportAll.push(from);
      else if (s.exportClause && ts.isNamedExports(s.exportClause)) {
        for (const el of s.exportClause.elements) {
          if (el.isTypeOnly) continue;
          if (from) reexportNamed.set(el.name.text, { from, name: (el.propertyName ?? el.name).text });
          else ownExports.add(el.name.text);
        }
      }
    } else if (ts.isExportAssignment(s)) ownExports.add('default');
    else if (hasExport(s)) {
      if (hasDefault(s)) ownExports.add('default');
      else if (ts.isVariableStatement(s)) {
        for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) ownExports.add(d.name.text);
      } else if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isEnumDeclaration(s)) && s.name) ownExports.add(s.name.text);
      else if (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) ownTypes.add(s.name.text);
    }
  }
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) dynamicImports.push(n.arguments[0].text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  const moduleSpecs: string[] = [];
  for (const s of sf.statements) {
    if (ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) && s.importClause) moduleSpecs.push(s.moduleSpecifier.text);
    if (ts.isExportDeclaration(s) && s.moduleSpecifier && ts.isStringLiteral(s.moduleSpecifier)) moduleSpecs.push(s.moduleSpecifier.text);
  }
  moduleSpecs.push(...dynamicImports);
  return { imports, reexportNamed, reexportAll, dynamicImports, ownExports, ownTypes, moduleSpecs };
}

/**
 * src 기준 파일 → 원문, 그리고 그 파일이 «실제로 쓰는» src 안의 파일. 타입만 가져오는 import 는 빼고, 이름으로 가져온
 * import 는 barrel(`export * from`)을 지나 그 이름을 선언한 파일로 잇는다 — barrel 하나가 모든 도메인을 끌고 오지 않게.
 * 네임스페이스 import 는 그 barrel 이 내보내는 파일 전부로 잇는다.
 */
export interface ImportedValue {
  /** 가져온 파일 안에서 쓰는 이름(부수효과 import 는 '') */
  readonly local: string;
  readonly file: string;
  /** 그 파일이 선언한 export 이름. 네임스페이스·부수효과 import 나 선언을 못 찾으면 '*' */
  readonly name: string;
}

export interface ImportGraph {
  readonly files: ReadonlyMap<string, string>;
  readonly importsOf: (rel: string) => readonly string[];
  readonly valueImportsOf: (rel: string) => readonly ImportedValue[];
  /** `@/…`·상대 지정자 → src 기준 파일 */
  readonly resolveModule: (fromRel: string, spec: string) => string | null;
  /** 파일 단위 간선 — 타입 import·barrel 을 그대로 잇는다(무엇을 그리는 쪽인지 넓게 볼 때) */
  readonly moduleImportsOf: (rel: string) => readonly string[];
}

export function importGraph(srcDir: string): ImportGraph {
  const files = new Map<string, string>();
  for (const f of walk(srcDir)) files.set(relative(srcDir, f), readFileSync(f, 'utf8'));
  return importGraphOf(srcDir, files);
}

/** 디스크 대신 주어진 원문으로 — 시험에서 가상 파일로 쓴다. */
export function importGraphOf(srcDir: string, files: ReadonlyMap<string, string>): ImportGraph {
  const edges = new Map<string, ValueEdges>();
  for (const [rel, source] of files) edges.set(rel, scanValueEdges(join(srcDir, rel), source));
  const resolveModule = moduleResolver(srcDir, files);

  // 이름을 선언한 파일과 그 파일 안의 export 이름(`export { a as b } from` 을 지나면 a). 타입이면 false, 못 찾으면 null
  type Declared = { readonly file: string; readonly name: string };
  const declaringFile = (rel: string, name: string, seen = new Set<string>()): Declared | false | null => {
    const id = `${rel}#${name}`;
    if (seen.has(id)) return null;
    seen.add(id);
    const e = edges.get(rel);
    if (!e) return null;
    if (e.ownExports.has(name)) return { file: rel, name };
    if (e.ownTypes.has(name)) return false;
    const named = e.reexportNamed.get(name);
    if (named) {
      const m = resolveModule(rel, named.from);
      return m ? declaringFile(m, named.name, seen) : null;
    }
    for (const from of e.reexportAll) {
      const m = resolveModule(rel, from);
      const d = m ? declaringFile(m, name, seen) : null;
      if (d !== null) return d;
    }
    return null;
  };
  const wholeBarrel = (rel: string, out = new Set<string>()): Set<string> => {
    if (out.has(rel)) return out;
    out.add(rel);
    for (const from of edges.get(rel)?.reexportAll ?? []) {
      const m = resolveModule(rel, from);
      if (m) wholeBarrel(m, out);
    }
    return out;
  };

  // 이 파일이 값으로 가져오는 것 — 이름 import 는 선언 파일로, 네임스페이스·부수효과 import 는 barrel 전체(name '*')로
  const valueImports = new Map<string, readonly ImportedValue[]>();
  const valueImportsOf = (rel: string): readonly ImportedValue[] => {
    const cached = valueImports.get(rel);
    if (cached) return cached;
    const out: ImportedValue[] = [];
    for (const i of edges.get(rel)?.imports ?? []) {
      const m = resolveModule(rel, i.from);
      if (!m) continue;
      if (i.name === null || i.name === '*') {
        for (const f of wholeBarrel(m)) out.push({ local: i.local, file: f, name: '*' });
        continue;
      }
      const d = declaringFile(m, i.name);
      if (d !== false) out.push({ local: i.local, file: d?.file ?? m, name: d?.name ?? '*' });
    }
    valueImports.set(rel, out);
    return out;
  };

  const resolved = new Map<string, readonly string[]>();
  const importsOf = (rel: string): readonly string[] => {
    const cached = resolved.get(rel);
    if (cached) return cached;
    const e = edges.get(rel);
    const out = new Set(valueImportsOf(rel).map((v) => v.file));
    for (const r of e?.reexportNamed.values() ?? []) {
      const m = resolveModule(rel, r.from);
      const d = m ? declaringFile(m, r.name) : null;
      if (m && d !== false) out.add(d?.file ?? m);
    }
    for (const spec of e?.dynamicImports ?? []) {
      const m = resolveModule(rel, spec);
      if (m) for (const f of wholeBarrel(m)) out.add(f);
    }
    const list = [...out].sort();
    resolved.set(rel, list);
    return list;
  };

  const moduleImportsOf = (rel: string): readonly string[] => {
    const specs = [...new Set(edges.get(rel)?.moduleSpecs ?? [])];
    return [...new Set(specs.map((t) => resolveModule(rel, t)).filter((m): m is string => m !== null))];
  };

  return { files, importsOf, valueImportsOf, resolveModule, moduleImportsOf };
}

export function analyzeAdminWeb(srcDir: string, screenKeys: (screen: string) => readonly string[]): Analysis {
  const graph = importGraph(srcDir);
  const files = new Map<string, FileScan>();
  for (const [rel, source] of graph.files) files.set(rel, scanFile(join(srcDir, rel), source));
  const fileSet = new Set(files.keys());
  const { resolveModule } = graph;

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
  for (const file of fileSet) {
    for (const m of graph.moduleImportsOf(file)) {
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
