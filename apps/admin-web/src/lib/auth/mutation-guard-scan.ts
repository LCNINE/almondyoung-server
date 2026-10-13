import * as ts from 'typescript';

/**
 * 관리자 화면의 «쓰기 동작 ↔ 권한 판정» 을 파일 단위로 읽는다. 게이트(`mutation-guard.gate.spec.ts`)가 쓴다.
 * 문자열 검색이 아니라 구문 트리로 읽는다 — 여러 줄 JSX·따옴표·줄바꿈에 흔들리지 않게.
 */
export type ScannedRequirement = readonly string[] | { readonly allOf: readonly (readonly string[])[] } | 'self';

export interface ScannedHook {
  readonly name: string;
  readonly line: number;
  /** 선언된 요구 권한. 선언이 없거나 읽을 수 없는 모양이면 null */
  readonly requirement: ScannedRequirement | null;
}

export interface ScannedInlineMutation {
  readonly line: number;
  readonly requirement: ScannedRequirement | null;
}

export interface FileScan {
  /** 이 파일이 export 하는 뮤테이션 훅 */
  readonly hooks: readonly ScannedHook[];
  /** 훅 선언 밖(컴포넌트 안)에서 부른 useMutation — `meta.permission` 으로 선언해야 한다 */
  readonly inline: readonly ScannedInlineMutation[];
  /** 이 파일이 부르는 `useX(` 의 이름 */
  readonly calledHooks: ReadonlySet<string>;
  /** 화면 판정이 직접 적은 권한 키(`<Can anyOf>`·`useCan`·`can`) */
  readonly guardKeys: ReadonlySet<string>;
  /** 화면 판정이 가리킨 훅 식별자(`<Can run>`·`useCanRun`·`canRun`·`blockedReason`·`<PermissionFieldset run>`) */
  readonly guardRuns: ReadonlySet<string>;
  /** `<RouteGuard screen="…">`·`<CanOpen screen="…">`·`useCanOpen('…')` 의 경로 */
  readonly screens: ReadonlySet<string>;
  /** 지역 이름 → (모듈 지정자, export 이름). `import X from` 은 'default' */
  readonly imports: ReadonlyMap<string, { readonly from: string; readonly name: string }>;
  /** `export * from` / `export { a as b } from` / 동적 import 대상 */
  readonly reexportAll: readonly string[];
  readonly reexportNamed: ReadonlyMap<string, { readonly from: string; readonly name: string }>;
  readonly dynamicImports: readonly string[];
}

const KEY_CALLS = new Set(['useCan', 'can']);
const RUN_CALLS = new Set(['useCanRun', 'canRun', 'blockedReason']);

function unwrap(e: ts.Expression): ts.Expression {
  let cur = e;
  while (ts.isAsExpression(cur) || ts.isSatisfiesExpression(cur) || ts.isParenthesizedExpression(cur) || ts.isTypeAssertionExpression(cur)) {
    cur = cur.expression;
  }
  return cur;
}

function stringList(e: ts.Expression): string[] | null {
  const u = unwrap(e);
  if (!ts.isArrayLiteralExpression(u)) return null;
  const out: string[] = [];
  for (const el of u.elements) {
    if (!ts.isStringLiteralLike(el)) return null;
    out.push(el.text);
  }
  return out;
}

/** `['a']` · `{ allOf: [['a'], ['b']] }` · `'self'` 만 읽는다. 빈 목록·그 밖의 모양은 null(선언 없음과 같게 본다). */
export function readRequirement(e: ts.Expression): ScannedRequirement | null {
  const u = unwrap(e);
  if (ts.isStringLiteralLike(u)) return u.text === 'self' ? 'self' : null;
  const list = stringList(u);
  if (list) return list.length > 0 ? list : null;
  if (!ts.isObjectLiteralExpression(u)) return null;
  const allOf = u.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'allOf');
  if (!allOf) return null;
  const arr = unwrap(allOf.initializer);
  if (!ts.isArrayLiteralExpression(arr) || arr.elements.length === 0) return null;
  const groups: string[][] = [];
  for (const g of arr.elements) {
    const l = stringList(g);
    if (!l || l.length === 0) return null;
    groups.push(l);
  }
  return { allOf: groups };
}

interface Decl {
  readonly name: string;
  readonly exported: boolean;
  /** 본문(함수) 또는 초기화식 */
  readonly node: ts.Node;
  readonly statement: ts.Statement;
}

function isExported(s: ts.Statement): boolean {
  return ts.canHaveModifiers(s) && (ts.getModifiers(s) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function topLevelDecls(sf: ts.SourceFile): Decl[] {
  const out: Decl[] = [];
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && s.name) out.push({ name: s.name.text, exported: isExported(s), node: s, statement: s });
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer) out.push({ name: d.name.text, exported: isExported(s), node: d.initializer, statement: s });
      }
    }
  }
  return out;
}

function callsAny(node: ts.Node, names: ReadonlySet<string>): boolean {
  let hit = false;
  const visit = (n: ts.Node): void => {
    if (hit) return;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && names.has(n.expression.text)) hit = true;
    else ts.forEachChild(n, visit);
  };
  visit(node);
  return hit;
}

/** `useX.permission = …` 와 `export const useX = Object.assign(factory(...), { permission: … })` */
function declaredPermissions(sf: ts.SourceFile, decls: readonly Decl[]): Map<string, ScannedRequirement | null> {
  const out = new Map<string, ScannedRequirement | null>();
  for (const s of sf.statements) {
    if (!ts.isExpressionStatement(s) || !ts.isBinaryExpression(s.expression)) continue;
    const { left, operatorToken, right } = s.expression;
    if (operatorToken.kind !== ts.SyntaxKind.EqualsToken) continue;
    if (ts.isPropertyAccessExpression(left) && ts.isIdentifier(left.expression) && left.name.text === 'permission') {
      out.set(left.expression.text, readRequirement(right));
    }
  }
  for (const d of decls) {
    const init = d.node;
    if (!ts.isCallExpression(init)) continue;
    const callee = init.expression;
    const isAssign = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'Object' && callee.name.text === 'assign';
    if (!isAssign || init.arguments.length !== 2) continue;
    const extra = unwrap(init.arguments[1]);
    if (!ts.isObjectLiteralExpression(extra)) continue;
    const p = extra.properties.find((x): x is ts.PropertyAssignment => ts.isPropertyAssignment(x) && ts.isIdentifier(x.name) && x.name.text === 'permission');
    if (p) out.set(d.name, readRequirement(p.initializer));
  }
  return out;
}

function inlineRequirement(call: ts.CallExpression): ScannedRequirement | null {
  const opts = call.arguments[0] ? unwrap(call.arguments[0]) : undefined;
  if (!opts || !ts.isObjectLiteralExpression(opts)) return null;
  const meta = opts.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'meta');
  if (!meta) return null;
  const m = unwrap(meta.initializer);
  if (!ts.isObjectLiteralExpression(m)) return null;
  const perm = m.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'permission');
  return perm ? readRequirement(perm.initializer) : null;
}

function identifiersIn(e: ts.Expression): string[] {
  const u = unwrap(e);
  if (ts.isIdentifier(u)) return [u.text];
  if (ts.isArrayLiteralExpression(u)) return u.elements.flatMap((x) => identifiersIn(x));
  // `run={editing ? useUpdateX : useCreateX}` — 상태에 따라 둘 중 하나를 판정한다
  if (ts.isConditionalExpression(u)) return [...identifiersIn(u.whenTrue), ...identifiersIn(u.whenFalse)];
  return [];
}

export function scanFile(fileName: string, source: string): FileScan {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, /\.tsx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const decls = topLevelDecls(sf);
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  // 뮤테이션을 만드는 선언(전이): useMutation 을 부르거나, 그런 지역 선언을 부른다
  const makesMutation = new Set<string>();
  for (let changed = true; changed; ) {
    changed = false;
    const names = new Set(['useMutation', ...makesMutation]);
    for (const d of decls) {
      // `export const useLegacySave = useSave` — 같은 함수(같은 permission 속성)를 다른 이름으로 낸다
      const aliasOf = ts.isIdentifier(d.node) && names.has(d.node.text);
      if (!makesMutation.has(d.name) && (aliasOf || callsAny(d.node, names))) {
        makesMutation.add(d.name);
        changed = true;
      }
    }
  }
  const declared = declaredPermissions(sf, decls);
  const hookDecls = decls.filter((d) => d.exported && /^use[A-Z]/.test(d.name) && makesMutation.has(d.name));
  const requirementOf = (d: Decl, seen = new Set<string>()): ScannedRequirement | null => {
    const own = declared.get(d.name);
    if (own !== undefined) return own;
    const node = d.node;
    if (!ts.isIdentifier(node) || seen.has(d.name)) return null;
    seen.add(d.name);
    const target = decls.find((x) => x.name === node.text);
    return target ? requirementOf(target, seen) : null;
  };
  const hooks: ScannedHook[] = hookDecls.map((d) => ({ name: d.name, line: lineOf(d.statement), requirement: requirementOf(d) }));

  // 훅이 (전이적으로) 부르는 비공개 헬퍼 — 그 안의 useMutation 은 훅 선언이 대표한다
  const covered = new Set(hookDecls.map((d) => d.name));
  for (let changed = true; changed; ) {
    changed = false;
    for (const d of decls) {
      if (covered.has(d.name)) continue;
      if (!makesMutation.has(d.name) || d.exported) continue;
      if (decls.some((h) => covered.has(h.name) && callsAny(h.node, new Set([d.name])))) {
        covered.add(d.name);
        changed = true;
      }
    }
  }
  const ownerOf = new Map<ts.Node, string>(decls.map((d) => [d.node, d.name]));

  const inline: ScannedInlineMutation[] = [];
  const calledHooks = new Set<string>();
  const guardKeys = new Set<string>();
  const guardRuns = new Set<string>();
  const screens = new Set<string>();
  const dynamicImports: string[] = [];

  const visit = (n: ts.Node, owner: string | undefined): void => {
    const nextOwner = ownerOf.get(n) ?? owner;
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
      if (name === 'useMutation' && ts.isIdentifier(callee) && !(nextOwner && covered.has(nextOwner))) {
        inline.push({ line: lineOf(n), requirement: inlineRequirement(n) });
      }
      if (ts.isIdentifier(callee) && /^use[A-Z]/.test(callee.text)) calledHooks.add(callee.text);
      if (name && KEY_CALLS.has(name) && n.arguments[0]) for (const k of stringList(n.arguments[0]) ?? []) guardKeys.add(k);
      if (name && RUN_CALLS.has(name)) for (const a of n.arguments) for (const id of identifiersIn(a)) guardRuns.add(id);
      if (name === 'useCanOpen' && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) screens.add(n.arguments[0].text);
      if (callee.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) dynamicImports.push(n.arguments[0].text);
    }
    if (ts.isJsxAttribute(n) && ts.isIdentifier(n.name) && n.initializer) {
      const attr = n.name.text;
      const init = n.initializer;
      const expr = ts.isJsxExpression(init) ? init.expression : undefined;
      if (attr === 'anyOf' && expr) for (const k of stringList(expr) ?? []) guardKeys.add(k);
      if (attr === 'run' && expr) for (const id of identifiersIn(expr)) guardRuns.add(id);
      if (attr === 'screen' && ts.isStringLiteral(init)) screens.add(init.text);
    }
    ts.forEachChild(n, (c) => visit(c, nextOwner));
  };
  visit(sf, undefined);

  const imports = new Map<string, { from: string; name: string }>();
  const reexportAll: string[] = [];
  const reexportNamed = new Map<string, { from: string; name: string }>();
  for (const s of sf.statements) {
    if (ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) && s.importClause) {
      const from = s.moduleSpecifier.text;
      if (s.importClause.name) imports.set(s.importClause.name.text, { from, name: 'default' });
      const nb = s.importClause.namedBindings;
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) imports.set(el.name.text, { from, name: (el.propertyName ?? el.name).text });
      if (nb && ts.isNamespaceImport(nb)) imports.set(nb.name.text, { from, name: '*' });
    }
    if (ts.isExportDeclaration(s) && s.moduleSpecifier && ts.isStringLiteral(s.moduleSpecifier)) {
      const from = s.moduleSpecifier.text;
      if (!s.exportClause) reexportAll.push(from);
      else if (ts.isNamedExports(s.exportClause)) for (const el of s.exportClause.elements) reexportNamed.set(el.name.text, { from, name: (el.propertyName ?? el.name).text });
    }
  }
  return { hooks, inline, calledHooks, guardKeys, guardRuns, screens, imports, reexportAll, reexportNamed, dynamicImports };
}

/** 판정 키 g 가 요구 키 k 를 덮는가: 같은 키, 또는 같은 대상의 조회(쓰기 권한이 있으면 그 대상 조회는 함께 켜진다 — 역할 편집 화면 규칙과 같다). */
export function implies(g: string, k: string): boolean {
  if (g === k) return true;
  const [gd, gr] = g.split('.');
  const [kd, kr, ka] = k.split('.');
  return gd === kd && gr === kr && ka === 'read';
}

export function requirementCovered(req: ScannedRequirement, keys: ReadonlySet<string>): boolean {
  if (req === 'self') return true;
  const covers = (anyOf: readonly string[]) => anyOf.some((k) => [...keys].some((g) => implies(g, k)));
  return typeof req === 'object' && 'allOf' in req ? req.allOf.every(covers) : covers(req);
}

export function requirementKeys(req: ScannedRequirement): string[] {
  if (req === 'self') return [];
  return typeof req === 'object' && 'allOf' in req ? req.allOf.flat() : [...req];
}
