import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import * as ts from 'typescript';
import { PII_ROUTES, PII_WRITE_EXEMPT, PII_WRITE_ROUTES } from './pii-routes';

/**
 * 개인정보 원문을 본문으로 받는 쓰기는 `@PiiWrite` 로 그 필드를 선언한다 — 원문을 볼 수 없는 사람이 가린 값을 그대로
 * 다시 저장하지 않게(ADR-0048). 목록과 선언이 양쪽으로 맞아야 하고, 선언한 앱은 개인정보 인터셉터를 등록해야 한다.
 */
const ROOT = join(__dirname, '..', '..');
const AUDIT = join(__dirname, 'route-authz-audit.js');
const ROOT_MODULES: Readonly<Record<string, string>> = {
  core: 'apps/core/src/app.module.ts',
  notification: 'apps/notification/src/notification.module.ts',
  'user-service': 'apps/user-service/src/app.module.ts',
};

interface AuditRow {
  app: string;
  verb: string;
  route: string;
  file: string;
  handler: string;
}

const rows: AuditRow[] = JSON.parse(
  execFileSync('node', [AUDIT, '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
);
const keyOf = (r: AuditRow) => `${r.app} ${r.verb} ${r.route}`;

function declaresPiiWrite(row: AuditRow): boolean {
  const [className, methodName] = row.handler.split('.');
  const source = ts.createSourceFile(row.file, readFileSync(join(ROOT, row.file), 'utf8'), ts.ScriptTarget.Latest, true);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name?.text === className) {
      for (const member of node.members) {
        if (!ts.isMethodDeclaration(member) || member.name.getText() !== methodName) continue;
        found = (ts.getDecorators(member) ?? []).some((d) => d.expression.getText().startsWith('PiiWrite('));
      }
    }
    node.forEachChild(visit);
  };
  source.forEachChild(visit);
  return found;
}

const declared = rows.filter(declaresPiiWrite).map(keyOf);

const parse = (file: string) => ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);

function methodOf(row: AuditRow): ts.MethodDeclaration | undefined {
  const [className, methodName] = row.handler.split('.');
  let found: ts.MethodDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name?.text === className) {
      for (const m of node.members) if (ts.isMethodDeclaration(m) && m.name.getText() === methodName) found = m;
    }
    node.forEachChild(visit);
  };
  parse(join(ROOT, row.file)).forEachChild(visit);
  return found;
}

const stringsOf = (node: ts.Node | undefined): string[] =>
  !node ? [] : ts.isStringLiteral(node) ? [node.text] : node.getChildren().flatMap(stringsOf);

/** 데코레이터 객체 인자의 `fields` 속성 이름들(응답 가림 경로 / 쓰기 필드). */
function declaredPaths(method: ts.MethodDeclaration, decorator: string): string[] {
  for (const d of ts.getDecorators(method) ?? []) {
    const call = d.expression;
    if (!ts.isCallExpression(call) || call.expression.getText() !== decorator) continue;
    const arg = call.arguments[0];
    if (!arg || !ts.isObjectLiteralExpression(arg)) return [];
    for (const prop of arg.properties) {
      if (!ts.isPropertyAssignment(prop) || prop.name.getText() !== 'fields') continue;
      if (ts.isObjectLiteralExpression(prop.initializer)) {
        return prop.initializer.properties.flatMap((p) => (ts.isPropertyAssignment(p) ? [p.name.getText().replace(/['"]/g, '')] : []));
      }
      return stringsOf(prop.initializer);
    }
  }
  return [];
}

/** 본문(@Body) DTO 클래스의 최상위 속성 이름 — 컨트롤러의 import 를 따라 파일·재수출을 찾는다. */
function bodyProperties(row: AuditRow, method: ts.MethodDeclaration): string[] {
  const param = method.parameters.find((p) => (ts.getDecorators(p) ?? []).some((d) => d.expression.getText().startsWith('Body(')));
  const typeName = param?.type?.getText();
  if (!typeName) return [];
  const controller = parse(join(ROOT, row.file));
  let specifier: string | undefined;
  controller.forEachChild((node) => {
    if (!ts.isImportDeclaration(node) || !node.importClause?.namedBindings) return;
    const bindings = node.importClause.namedBindings;
    if (ts.isNamedImports(bindings) && bindings.elements.some((e) => e.name.text === typeName)) {
      specifier = (node.moduleSpecifier as ts.StringLiteral).text;
    }
  });
  if (!specifier?.startsWith('.')) return [];
  const seen = new Set<string>();
  const find = (base: string): string[] => {
    const file = [`${base}.ts`, join(base, 'index.ts')].find(existsSync);
    if (!file || seen.has(file)) return [];
    seen.add(file);
    const source = parse(file);
    let props: string[] | undefined;
    const nested: string[] = [];
    source.forEachChild((node) => {
      if (ts.isClassDeclaration(node) && node.name?.text === typeName) {
        props = node.members.flatMap((m) => (ts.isPropertyDeclaration(m) ? [m.name.getText()] : []));
      }
      if (ts.isExportDeclaration(node) && !node.exportClause && node.moduleSpecifier) {
        nested.push(resolve(dirname(file), (node.moduleSpecifier as ts.StringLiteral).text));
      }
    });
    return props ?? nested.flatMap(find);
  };
  return find(resolve(dirname(join(ROOT, row.file)), specifier));
}

/** 응답 경로의 첫 이름 — 목록 감싸기(`data[]`·`[]`)는 건너뛴다. */
const headOf = (path: string): string =>
  path.replace(/^(data\[\]\.|data\.|\[\]\.)/, '').split(/[.[]/)[0];


describe('개인정보 쓰기 라우트', () => {
  it('목록과 선언을 찾는다', () => {
    expect(PII_WRITE_ROUTES.length).toBeGreaterThan(0);
    expect(declared.length).toBeGreaterThan(0);
  });

  it('목록의 모든 라우트가 PiiWrite 를 선언한다', () => {
    expect(PII_WRITE_ROUTES.filter((key) => !declared.includes(key))).toEqual([]);
  });

  it('PiiWrite 를 선언한 라우트는 목록에 있다', () => {
    expect(declared.filter((key) => !PII_WRITE_ROUTES.includes(key))).toEqual([]);
  });

  it('선언한 앱은 개인정보 인터셉터를 등록한다', () => {
    const apps = [...new Set(declared.map((key) => key.split(' ')[0]))];
    const unwired = apps.filter((app) => {
      const file = ROOT_MODULES[app];
      return !file || !readFileSync(join(ROOT, file), 'utf8').includes('piiMaskingProviders(');
    });
    expect(unwired).toEqual([]);
  });

  it('찾는다: 개인정보를 응답하는 쓰기 라우트의 본문 DTO', () => {
    const writes = rows.filter((r) => r.verb !== 'GET' && PII_ROUTES.includes(keyOf(r)));
    expect(writes.some((r) => { const m = methodOf(r); return m !== undefined && bodyProperties(r, m).length > 0; })).toBe(true);
  });

  it('응답에서 가리는 필드를 본문으로 받는 쓰기는 PiiWrite 로 그 필드를 덮는다', () => {
    const uncovered = rows
      .filter((r) => r.verb !== 'GET' && PII_ROUTES.includes(keyOf(r)) && !(keyOf(r) in PII_WRITE_EXEMPT))
      .flatMap((r) => {
        const method = methodOf(r);
        if (!method) return [];
        const body = new Set(bodyProperties(r, method));
        const written = declaredPaths(method, 'PiiWrite').map((p) => p.split('.')[0]);
        return declaredPaths(method, 'PiiResponse')
          .map(headOf)
          .filter((head) => body.has(head) && !written.includes(head))
          .map((head) => `${keyOf(r)} ${head}`);
      });
    expect([...new Set(uncovered)]).toEqual([]);
  });

  it('예외 목록은 실제로 있는 쓰기 라우트만 가리킨다', () => {
    const live = new Set(rows.filter((r) => r.verb !== 'GET').map(keyOf));
    expect(Object.keys(PII_WRITE_EXEMPT).filter((key) => !live.has(key))).toEqual([]);
  });
});

