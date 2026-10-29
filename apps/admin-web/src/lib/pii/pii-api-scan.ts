import * as ts from 'typescript';
import type { ImportGraph } from '../auth/mutation-guard-graph';

/**
 * «어느 화면이 개인정보 API 를 부르나» 를 이름 단위로 읽는다. 게이트(`pii-screens.gate.spec.ts`) 전용.
 *
 * API 계층(`lib/api/**`·`lib/services/**`)은 `export const fooApi = { get: …, list: … }` 처럼 한 파일에 개인정보
 * 경로와 아닌 경로를 같이 둔다. 파일 단위로 보면 `getMe` 하나 때문에 모든 화면이 걸리므로, 최상위 선언과 객체의
 * 멤버마다 «개인정보 경로를 부르나» 를 정하고 참조를 따라 번진다. 화면 쪽 파일은 그 이름(`fooApi.get`)을 쓰는지만 본다.
 */
export interface PiiApiScan {
  /** API 계층 파일 → 개인정보 경로를 부르는 이름(`name` 또는 `name.member`) */
  readonly piiSymbols: ReadonlyMap<string, readonly string[]>;
  /** 화면 진입 파일에서 import 를 따라가 닿는 개인정보 이름(`file#name`) */
  readonly reachedFrom: (entry: string) => readonly string[];
  /** 화면 진입 파일에서 닿는 개인정보 라우트 패턴(`PiiPath.path`, 예외 적용 뒤, `matchesExact` 기준) — [보기]·받는 분 판정에 쓴다 */
  readonly pathsFrom: (entry: string) => ReadonlySet<string>;
  /** 화면 쪽 파일이 쓰는 개인정보 이름의 경로 머리(예외 적용 전) — 죽은 예외를 가린다 */
  readonly headsOfUi: (file: string) => ReadonlySet<string>;
}

interface Refs {
  readonly idents: ReadonlySet<string>;
  /** `a.b` 의 (a, b) */
  readonly pairs: ReadonlySet<string>;
  /** `a.b.c` — `orders.waybills.issue` 처럼 묶음 객체를 거쳐 부르는 것 */
  readonly triples: ReadonlySet<string>;
}

interface Unit {
  readonly refs: Refs;
  /** 파일 안 문자열 상수를 펼친 원문 */
  readonly text: string;
  /** 문자열 상수 — 쓰는 쪽에 펼쳐 넣으므로 스스로는 개인정보 경로가 아니다 */
  readonly isString?: true;
  /** `{ waybills }`·`{ waybills: waybillsClient }` 처럼 다른 이름을 그대로 담은 멤버 */
  readonly alias?: string;
}

interface FileUnits {
  /** 선언 이름 → 평범한 선언(함수·상수) */
  readonly plain: Map<string, Unit>;
  /** 선언 이름 → 객체 리터럴의 멤버 */
  readonly objects: Map<string, Map<string, Unit>>;
  /** export 이름 → 파일 안 이름(`export { a as b }`) */
  readonly exportAlias: Map<string, string>;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 경로 머리 바로 뒤에 경계 문자가 와야 같은 경로다(`/fulfillments-…` 를 거른다). */
export const hitsHead = (text: string, head: string) =>
  new RegExp(`${escape(head)}[\`'"/?$]`).test(text);

/** `:` 로 시작하는 첫 조각 앞까지 — 예외의 키가 된다. */
export const staticHead = (path: string) => {
  const parts = path.split('/');
  const cut = parts.findIndex((p) => p.startsWith(':'));
  return (cut === -1 ? parts : parts.slice(0, cut)).join('/');
};

export interface PiiPath {
  /** 받은 라우트 패턴 그대로 */
  readonly path: string;
  readonly head: string;
  readonly matches: (text: string) => boolean;
  /** 매개변수 자리가 `${…}` 일 때만 — `/sales-orders/stats` 가 `/sales-orders/:id` 로 잡히지 않는다 */
  readonly matchesExact: (text: string) => boolean;
}

/**
 * 문자열 잇기를 템플릿 꼴로 바꾼다 — `'/a/' + id + '/b'` → `'/a/${id}/b'`, `'/a/' + id` → `'/a/${id}'`.
 * 누락보다 과탐이 낫다(놓치면 안내가 빠진다).
 */
const EXPR = String.raw`[\w$.]+(?:\([^()]*\))?`;
const MID = new RegExp(
  String.raw`(['"\`])\s*\+\s*(${EXPR})\s*\+\s*(['"\`])`,
  'g'
);
const TAIL = new RegExp(String.raw`(['"\`])\s*\+\s*(${EXPR})`, 'g');
export function joinConcat(text: string): string {
  let out = text;
  for (let before = ''; before !== out; ) {
    before = out;
    out = out.replace(MID, (_m, _q1: string, expr: string) => `\${${expr}}`);
  }
  return out.replace(TAIL, (_m, q: string, expr: string) => `\${${expr}}${q}`);
}

/**
 * 라우트 패턴 → 코드 속 경로 문자열 판정(`joinConcat` 을 거친 원문에). 매개변수 조각은 `${…}` 나 아무 고정 조각과 맞고,
 * 경로는 따옴표·`?`·`${` 에서 끝나야 한다 — `/admin/users/:id` 가 `/admin/users/${id}/roles` 에 걸리지 않게.
 * 머리 이후 어느 조각에서든 `/${…}` 하나로 끝나면(뒤 조각을 모른다) 맞는 것으로 본다.
 */
export function piiPath(path: string): PiiPath {
  const normalized = path.replace(/\/{2,}/g, '/');
  const head = staticHead(normalized);
  const hole = String.raw`\$\{[^}]*\}`;
  const param = String.raw`(?:${hole}|[^/'"\`?$\s]+)`;
  const parts = normalized.split('/');
  const segsWith = (p: string) =>
    parts.map((seg) => (seg.startsWith(':') ? p : escape(seg)));
  const segs = segsWith(param);
  const end = String.raw`(?=[\`'"?]|\$\{)`;
  const full = new RegExp(`${segs.join('/')}${end}`);
  const exact = new RegExp(`${segsWith(hole).join('/')}${end}`);
  const headLen = head.split('/').length;
  const prefixes: string[] = [];
  for (let n = headLen; n < segs.length; n += 1)
    prefixes.push(segs.slice(0, n).join('/'));
  const open = prefixes.length
    ? new RegExp(String.raw`(?:${prefixes.join('|')})/\$\{[^}]*\}[\`'"]`)
    : null;
  return {
    path,
    head,
    matches: (text) => full.test(text) || (open?.test(text) ?? false),
    matchesExact: (text) => exact.test(text) || (open?.test(text) ?? false),
  };
}

function collectRefs(node: ts.Node, skip?: (n: ts.Node) => boolean): Refs {
  const idents = new Set<string>();
  const pairs = new Set<string>();
  const triples = new Set<string>();
  const visit = (n: ts.Node) => {
    if (skip?.(n)) return;
    if (ts.isPropertyAccessExpression(n)) {
      if (ts.isIdentifier(n.expression))
        pairs.add(`${n.expression.text}.${n.name.text}`);
      const inner = n.expression;
      if (
        ts.isPropertyAccessExpression(inner) &&
        ts.isIdentifier(inner.expression)
      )
        triples.add(
          `${inner.expression.text}.${inner.name.text}.${n.name.text}`
        );
      visit(n.expression);
      return;
    }
    if (ts.isIdentifier(n)) {
      const p = n.parent;
      const isKey =
        p &&
        (ts.isPropertyAssignment(p) ||
          ts.isMethodDeclaration(p) ||
          ts.isPropertySignature(p)) &&
        p.name === n;
      if (!isKey) idents.add(n.text);
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return { idents, pairs, triples };
}

const unwrap = (e: ts.Expression): ts.Expression => {
  let at = e;
  while (
    ts.isAsExpression(at) ||
    ts.isSatisfiesExpression(at) ||
    ts.isParenthesizedExpression(at)
  )
    at = at.expression;
  return at;
};

function fileUnits(fileName: string, source: string): FileUnits {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const plain = new Map<string, Unit>();
  const objects = new Map<string, Map<string, Unit>>();
  const exportAlias = new Map<string, string>();
  const strings = new Map<string, string>();
  for (const s of sf.statements) {
    if (!ts.isVariableStatement(s)) continue;
    for (const d of s.declarationList.declarations) {
      const init = d.initializer && unwrap(d.initializer);
      if (
        ts.isIdentifier(d.name) &&
        init &&
        (ts.isStringLiteral(init) ||
          ts.isNoSubstitutionTemplateLiteral(init) ||
          ts.isTemplateExpression(init))
      ) {
        strings.set(d.name.text, init.getText(sf).slice(1, -1));
      }
    }
  }
  // `${BASE}/${id}` 와 `client.get(BASE)` 를 실제 경로로 펼친다(상수가 다른 상수를 쓰면 몇 번 더 펼친다)
  const expand = (text: string) => {
    let out = text;
    for (let round = 0; round < 3; round += 1) {
      for (const [name, value] of strings) {
        out = out
          .split(`\${${name}}`)
          .join(value)
          .replace(
            new RegExp(`(?<![.\\w$])${name}(?![\\w$])`, 'g'),
            () => `'${value}'`
          );
      }
    }
    return out;
  };
  const unit = (n: ts.Node, extra?: Partial<Unit>): Unit => ({
    refs: collectRefs(n),
    text: expand(n.getText(sf)),
    ...extra,
  });
  for (const s of sf.statements) {
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        const init = unwrap(d.initializer);
        if (!ts.isObjectLiteralExpression(init)) {
          plain.set(
            d.name.text,
            unit(
              d.initializer,
              strings.has(d.name.text) ? { isString: true } : undefined
            )
          );
          continue;
        }
        const members = new Map<string, Unit>();
        for (const p of init.properties) {
          if (
            (ts.isPropertyAssignment(p) ||
              ts.isMethodDeclaration(p) ||
              ts.isShorthandPropertyAssignment(p)) &&
            (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))
          ) {
            const alias = ts.isShorthandPropertyAssignment(p)
              ? p.name.text
              : ts.isPropertyAssignment(p) && ts.isIdentifier(p.initializer)
                ? p.initializer.text
                : undefined;
            members.set(p.name.text, unit(p, alias ? { alias } : undefined));
          } else if (ts.isSpreadAssignment(p))
            members.set(`...${members.size}`, unit(p));
        }
        objects.set(d.name.text, members);
      }
    } else if (
      (ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) &&
      s.name
    ) {
      plain.set(s.name.text, unit(s));
    } else if (
      (ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) &&
      !s.name
    ) {
      plain.set('default', unit(s));
    } else if (ts.isExportAssignment(s)) {
      plain.set('default', unit(s.expression));
    } else if (
      ts.isExportDeclaration(s) &&
      !s.moduleSpecifier &&
      s.exportClause &&
      ts.isNamedExports(s.exportClause)
    ) {
      for (const el of s.exportClause.elements)
        if (el.propertyName)
          exportAlias.set(el.name.text, el.propertyName.text);
    }
    const isDefault =
      ts.canHaveModifiers(s) &&
      (ts.getModifiers(s) ?? []).some(
        (m) => m.kind === ts.SyntaxKind.DefaultKeyword
      );
    if (
      isDefault &&
      (ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) &&
      s.name
    )
      exportAlias.set('default', s.name.text);
  }
  return { plain, objects, exportAlias };
}

const READ_CALL = /\.get\s*(?:<[^>]*>)?\s*\(|method:\s*['"`]GET['"`]/i;
const WRITE_CALL =
  /\.(?:post|put|patch|delete)\s*(?:<[^>]*>)?\s*\(|method:\s*['"`](?:POST|PUT|PATCH|DELETE)['"`]/i;
/** 쓰기만 부르는 선언 — 응답을 화면에 다시 그리지 않으므로 [보기]·받는 분 판정에서 뺀다 */
const isWriteOnly = (text: string) =>
  WRITE_CALL.test(text) && !READ_CALL.test(text);

export function scanPiiApis(input: {
  graph: ImportGraph;
  paths: readonly PiiPath[];
  isApiFile: (rel: string) => boolean;
  /**
   * `<파일> :: <경로 머리>` 예외. API 계층 파일이면 그 파일에서 그 머리를 개인정보 경로로 보지 않고, 화면 쪽 파일이면
   * 그 파일이 그 머리에서 온 이름을 써도 개인정보를 그리지 않는 것으로 본다(건수만 세는 대시보드 등).
   */
  isException: (rel: string, head: string) => boolean;
  /** 쓰기로 부르지만 응답을 그리는 경로(본문 없이 응답으로만 개인정보가 나가는 만들기) — `pathsFrom` 이 쓰기여도 센다 */
  readLikePaths?: ReadonlySet<string>;
}): PiiApiScan {
  const { graph, paths, isApiFile, isException } = input;
  const readLike = input.readLikePaths ?? new Set<string>();
  const units = new Map<string, FileUnits>();
  for (const [rel, source] of graph.files)
    if (isApiFile(rel)) units.set(rel, fileUnits(rel, source));

  /** 개인정보 이름(`file#name`·`file#name.member`) → 그 이름이 부르는 개인정보 라우트 패턴 */
  const pii = new Map<string, Set<string>>();
  const headOf = new Map(paths.map((p) => [p.path, p.head]));
  const headsOf = (k: string) =>
    [...(pii.get(k) ?? [])].map((path) => headOf.get(path) ?? path);
  const localName = (file: string, name: string) =>
    units.get(file)?.exportAlias.get(name) ?? name;
  const membersOf = (file: string, name: string) =>
    units.get(file)?.objects.get(name);
  const objectKeys = (file: string, name: string) =>
    [...(membersOf(file, name)?.keys() ?? [])]
      .map((m) => `${file}#${name}.${m}`)
      .filter((k) => pii.has(k));
  const fileKeys = (file: string) =>
    [...pii.keys()].filter((k) => k.startsWith(`${file}#`));

  const targetIn = (
    file: string,
    ident: string,
    own: boolean
  ): { file: string; name: string } | null => {
    const u = units.get(file);
    if (own && u && (u.plain.has(ident) || u.objects.has(ident)))
      return { file, name: ident };
    const imp = graph.valueImportsOf(file).find((v) => v.local === ident);
    if (!imp || !isApiFile(imp.file)) return null;
    return {
      file: imp.file,
      name: imp.name === '*' ? '*' : localName(imp.file, imp.name),
    };
  };

  /** 이 참조 묶음이 쓰는 개인정보 이름 — `file` 은 참조가 놓인 파일, `own` 은 그 파일의 선언도 보는가 */
  const usedPii = (file: string, refs: Refs, own: boolean): string[] => {
    const out = new Set<string>();
    const bare = new Set(refs.idents);
    for (const pair of refs.pairs) {
      const [obj, member] = pair.split('.');
      const t = targetIn(file, obj, own);
      if (!t) continue;
      if (t.name === '*') {
        for (const k of fileKeys(t.file)) out.add(k);
        continue;
      }
      const members = membersOf(t.file, t.name);
      if (!members) continue;
      bare.delete(obj);
      const alias = members.get(member)?.alias;
      const deeper = [...refs.triples]
        .filter((x) => x.startsWith(`${pair}.`))
        .map((x) => x.split('.')[2]);
      const inner = alias ? targetIn(t.file, alias, true) : null;
      if (
        inner &&
        inner.name !== '*' &&
        deeper.length > 0 &&
        membersOf(inner.file, inner.name)
      ) {
        for (const c of deeper)
          if (pii.has(`${inner.file}#${inner.name}.${c}`))
            out.add(`${inner.file}#${inner.name}.${c}`);
        continue;
      }
      if (pii.has(`${t.file}#${t.name}.${member}`))
        out.add(`${t.file}#${t.name}.${member}`);
    }
    for (const ident of bare) {
      const t = targetIn(file, ident, own);
      if (!t) continue;
      if (t.name === '*') for (const k of fileKeys(t.file)) out.add(k);
      else if (pii.has(`${t.file}#${t.name}`)) out.add(`${t.file}#${t.name}`);
      else for (const k of objectKeys(t.file, t.name)) out.add(k);
    }
    return [...out];
  };

  const all: { key: string; file: string; unit: Unit }[] = [];
  for (const [file, u] of units) {
    for (const [name, unit] of u.plain)
      all.push({ key: `${file}#${name}`, file, unit });
    for (const [name, members] of u.objects)
      for (const [m, unit] of members)
        all.push({ key: `${file}#${name}.${m}`, file, unit });
  }
  /** 씨앗(경로를 직접 부르는 이름)을 심고 참조를 따라 고정점까지 번진다 */
  const spread = (
    into: Map<string, Set<string>>,
    hit: (p: PiiPath, text: string) => boolean
  ) => {
    for (const a of all) {
      if (a.unit.isString) continue;
      const text = joinConcat(a.unit.text);
      const hits = paths
        .filter((p) => hit(p, text) && !isException(a.file, p.head))
        .map((p) => p.path);
      if (hits.length) into.set(a.key, new Set(hits));
    }
    for (let changed = true; changed; ) {
      changed = false;
      for (const a of all) {
        const hits = into.get(a.key) ?? new Set<string>();
        const before = hits.size;
        for (const k of usedPii(a.file, a.unit.refs, true))
          if (k !== a.key) for (const h of into.get(k) ?? []) hits.add(h);
        if (hits.size > before) {
          into.set(a.key, hits);
          changed = true;
        }
      }
    }
  };
  spread(pii, (p, text) => p.matches(text));
  /** 같은 이름 → 매개변수 자리를 `${…}` 로 부르는 경로만 — 화면 표시의 [보기]·받는 분 판정용 */
  const exact = new Map<string, Set<string>>();
  spread(
    exact,
    (p, text) =>
      p.matchesExact(text) && (readLike.has(p.path) || !isWriteOnly(text))
  );

  const piiSymbols = new Map<string, string[]>();
  for (const k of [...pii.keys()].sort()) {
    const [file, name] = k.split('#');
    piiSymbols.set(file, [...(piiSymbols.get(file) ?? []), name]);
  }

  // 화면 쪽 파일 하나가 쓰는 개인정보 이름(예외 적용 전)
  const uiUses = new Map<string, readonly string[]>();
  const usesOfUi = (file: string): readonly string[] => {
    const cached = uiUses.get(file);
    if (cached) return cached;
    const source = graph.files.get(file) ?? '';
    const sf = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    const list = usedPii(
      file,
      collectRefs(sf, (n) => ts.isImportDeclaration(n)),
      false
    ).sort();
    uiUses.set(file, list);
    return list;
  };
  const headsOfUi = (file: string) => new Set(usesOfUi(file).flatMap(headsOf));
  /** 이 파일에서 예외가 아닌 라우트 패턴 */
  const pathsOfUse = (file: string, k: string, from = pii) =>
    [...(from.get(k) ?? [])].filter(
      (path) => !isException(file, headOf.get(path) ?? path)
    );

  /** 진입 파일에서 화면 쪽 import 를 따라가며 닿는 (파일, 개인정보 이름) */
  const usesFrom = (entry: string) => {
    const seen = new Set([entry]);
    const stack = [entry];
    const out: { file: string; key: string }[] = [];
    while (stack.length) {
      const at = stack.pop();
      if (at === undefined) break;
      for (const key of usesOfUi(at)) out.push({ file: at, key });
      for (const next of graph.importsOf(at)) {
        if (seen.has(next) || isApiFile(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    return out;
  };

  const reachedFrom = (entry: string): readonly string[] =>
    [
      ...new Set(
        usesFrom(entry)
          .filter((u) => pathsOfUse(u.file, u.key).length > 0)
          .map((u) => u.key)
      ),
    ].sort();

  const pathsFrom = (entry: string): ReadonlySet<string> =>
    new Set(usesFrom(entry).flatMap((u) => pathsOfUse(u.file, u.key, exact)));

  return { piiSymbols, reachedFrom, pathsFrom, headsOfUi };
}
