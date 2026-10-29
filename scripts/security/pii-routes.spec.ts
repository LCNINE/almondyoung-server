import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import { PII_EXPORT_EXCEPTIONS, PII_RECIPIENT_ROUTES, PII_REVEAL_ROUTES, PII_ROUTES } from './pii-routes';

/**
 * 개인정보를 응답하는 관리자 라우트는 `@PiiResponse` 로 가릴 경로를 선언한다(ADR-0048).
 * 목록(`pii-routes.ts`)과 선언이 양쪽으로 맞아야 한다 — 선언만 있고 목록에 없거나, 목록에만 있으면 실패.
 */
const ROOT = join(__dirname, '..', '..');
const AUDIT = join(__dirname, 'route-authz-audit.js');

interface AuditRow {
  app: string;
  verb: string;
  route: string;
  file: string;
  handler: string;
  permissions: string[];
}

interface HandlerFacts {
  readonly pii: boolean;
  readonly export: boolean;
  readonly res: boolean;
  /** `@PiiResponse` 인자를 읽은 결과 — 못 읽으면 null(읽는 쪽을 고쳐야 한다) */
  readonly spec: SpecFacts | null;
}

interface SpecFacts {
  readonly reveal: boolean;
  /** 선언한 필드가 모두 받는 분 정보 권한으로 열린다 */
  readonly recipientOpensAll: boolean;
}

const unwrapExpr = (e: ts.Expression): ts.Expression => {
  let at = e;
  while (ts.isAsExpression(at) || ts.isSatisfiesExpression(at) || ts.isParenthesizedExpression(at)) at = at.expression;
  return at;
};

/** 인자 객체 — 인라인이거나 같은 파일 최상위 상수 */
function specObject(arg: ts.Expression, sf: ts.SourceFile): ts.ObjectLiteralExpression | null {
  const e = unwrapExpr(arg);
  if (ts.isObjectLiteralExpression(e)) return e;
  if (!ts.isIdentifier(e)) return null;
  for (const s of sf.statements) {
    if (!ts.isVariableStatement(s)) continue;
    for (const d of s.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === e.text && d.initializer) {
        const init = unwrapExpr(d.initializer);
        if (ts.isObjectLiteralExpression(init)) return init;
      }
    }
  }
  return null;
}

const propName = (p: ts.ObjectLiteralElementLike): string | null =>
  ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null;

/** 객체 리터럴의 이름 → 값. 펼치기·계산된 키처럼 못 읽는 꼴이 있으면 null */
function entriesOf(e: ts.Expression | undefined): Map<string, ts.Expression> | null {
  const obj = e && unwrapExpr(e);
  if (!obj || !ts.isObjectLiteralExpression(obj)) return null;
  const out = new Map<string, ts.Expression>();
  for (const p of obj.properties) {
    const name = propName(p);
    if (name === null || !ts.isPropertyAssignment(p)) return null;
    out.set(name, p.initializer);
  }
  return out;
}

/** 권한 목록 식이 받는 분 정보 권한을 담는가 */
const opensRecipient = (e: ts.Expression) => {
  const text = unwrapExpr(e).getText();
  return text === 'OPEN_WITH_RECIPIENT' || text.includes("'fulfillment.recipient.read'");
};

function specFacts(arg: ts.Expression | undefined, sf: ts.SourceFile): SpecFacts | null {
  const top = entriesOf(arg && (specObject(arg, sf) ?? undefined));
  const fields = entriesOf(top?.get('fields'));
  const byFieldExpr = top?.get('rawWithByField');
  const byField = byFieldExpr ? entriesOf(byFieldExpr) : new Map<string, ts.Expression>();
  if (!top || !fields || !byField) return null;
  const rawWith = top.get('rawWith');
  return {
    reveal: top.get('reveal')?.kind === ts.SyntaxKind.TrueKeyword,
    recipientOpensAll: [...fields.keys()].every((field) => {
      const opener = byField.get(field) ?? rawWith;
      return opener !== undefined && opensRecipient(opener);
    }),
  };
}

const rows: AuditRow[] = JSON.parse(
  execFileSync('node', [AUDIT, '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
);
const keyOf = (r: AuditRow) => `${r.app} ${r.verb} ${r.route}`;

const sources = new Map<string, ts.SourceFile>();
function sourceOf(file: string): ts.SourceFile {
  const hit = sources.get(file);
  if (hit) return hit;
  const parsed = ts.createSourceFile(file, readFileSync(join(ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true);
  sources.set(file, parsed);
  return parsed;
}

function factsOf(row: AuditRow): HandlerFacts {
  const [className, methodName] = row.handler.split('.');
  let facts: HandlerFacts = { pii: false, export: false, res: false, spec: null };
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name?.text === className) {
      for (const member of node.members) {
        if (!ts.isMethodDeclaration(member) || member.name.getText() !== methodName) continue;
        const decoratorNodes = ts.getDecorators(member) ?? [];
        const decorators = decoratorNodes.map((d) => d.expression.getText());
        const paramDecorators = member.parameters.flatMap((p) => (ts.getDecorators(p) ?? []).map((d) => d.expression.getText()));
        const piiCall = decoratorNodes
          .map((d) => d.expression)
          .find((e): e is ts.CallExpression => ts.isCallExpression(e) && e.expression.getText() === 'PiiResponse');
        facts = {
          pii: decorators.some((d) => d.startsWith('PiiResponse(')),
          export: decorators.some((d) => d.startsWith('PiiExport(')),
          res: paramDecorators.some((d) => /^Res\((?!\s*\{\s*passthrough:\s*true)/.test(d)),
          spec: piiCall ? specFacts(piiCall.arguments[0], member.getSourceFile()) : null,
        };
      }
    }
    node.forEachChild(visit);
  };
  sourceOf(row.file).forEachChild(visit);
  return facts;
}

const declared = rows.filter((r) => factsOf(r).pii);
const listed = new Set(PII_ROUTES);

describe('개인정보 응답 라우트', () => {
  it('목록과 선언을 찾는다', () => {
    expect(PII_ROUTES.length).toBeGreaterThan(0);
    expect(declared.length).toBeGreaterThan(0);
  });

  it('목록의 모든 라우트가 PiiResponse 를 선언한다', () => {
    const live = new Map(rows.map((r) => [keyOf(r), r]));
    const missing = PII_ROUTES.filter((key) => {
      const row = live.get(key);
      return !row || !factsOf(row).pii;
    });
    expect(missing).toEqual([]);
  });

  it('PiiResponse 를 선언한 라우트는 모두 목록에 있다', () => {
    expect(declared.map(keyOf).filter((key) => !listed.has(key))).toEqual([]);
  });

  it('PiiResponse 라우트는 응답 객체를 직접 쓰지 않는다(@Res 는 인터셉터를 건너뛴다)', () => {
    expect(declared.filter((r) => factsOf(r).res).map(keyOf)).toEqual([]);
  });

  it('개인정보를 응답하는 내보내기 라우트는 PiiExport 로 사유를 받는다 — 예외는 이유와 함께', () => {
    const offenders = declared
      .filter((r) => r.permissions.some((p) => p.endsWith('.export')))
      .filter((r) => !factsOf(r).export && !(keyOf(r) in PII_EXPORT_EXCEPTIONS))
      .map(keyOf);
    expect(offenders).toEqual([]);
  });

  it('PiiResponse 의 인자를 읽는다 — 못 읽는 꼴이면 아래 두 목록 검사가 비어 통과한다', () => {
    expect(declared.filter((r) => factsOf(r).spec === null).map(keyOf)).toEqual([]);
  });

  it('[보기]로 원문을 다시 받는 라우트 목록이 선언(reveal: true)과 맞는다', () => {
    const fromSource = declared.filter((r) => factsOf(r).spec?.reveal).map(keyOf).sort();
    expect([...PII_REVEAL_ROUTES].sort()).toEqual(fromSource);
  });

  it('필드가 모두 받는 분 정보 권한으로 열리는 라우트 목록이 선언과 맞는다', () => {
    const fromSource = declared.filter((r) => factsOf(r).spec?.recipientOpensAll).map(keyOf).sort();
    expect([...PII_RECIPIENT_ROUTES].sort()).toEqual(fromSource);
  });

  it('예외 목록은 실제 라우트를 가리킨다', () => {
    const live = new Set(rows.map(keyOf));
    expect(Object.keys(PII_EXPORT_EXCEPTIONS).filter((k) => !live.has(k))).toEqual([]);
  });
});
