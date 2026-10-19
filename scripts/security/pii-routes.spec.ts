import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import { PII_EXPORT_EXCEPTIONS, PII_ROUTES } from './pii-routes';

/**
 * 개인정보를 응답하는 관리자 라우트는 `@PiiResponse` 로 가릴 경로를 선언한다(ADR-0045).
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
  let facts: HandlerFacts = { pii: false, export: false, res: false };
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name?.text === className) {
      for (const member of node.members) {
        if (!ts.isMethodDeclaration(member) || member.name.getText() !== methodName) continue;
        const decorators = (ts.getDecorators(member) ?? []).map((d) => d.expression.getText());
        const paramDecorators = member.parameters.flatMap((p) => (ts.getDecorators(p) ?? []).map((d) => d.expression.getText()));
        facts = {
          pii: decorators.some((d) => d.startsWith('PiiResponse(')),
          export: decorators.some((d) => d.startsWith('PiiExport(')),
          res: paramDecorators.some((d) => /^Res\((?!\s*\{\s*passthrough:\s*true)/.test(d)),
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

  it('예외 목록은 실제 라우트를 가리킨다', () => {
    const live = new Set(rows.map(keyOf));
    expect(Object.keys(PII_EXPORT_EXCEPTIONS).filter((k) => !live.has(k))).toEqual([]);
  });
});
