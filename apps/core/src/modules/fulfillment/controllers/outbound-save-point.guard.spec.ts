import { readFileSync } from 'fs';
import { dirname, join, relative } from 'path';
import * as ts from 'typescript';

/**
 * 물류앱은 아래 출고 저장 경로의 409 를 «반영된 것이 없는 거절»로 보고 그 기기의 작업을 묶지 않는다
 * (`native/warehouse-app/src/core/data/httpClient.ts` 의 `SAVE_POINT_OUTBOUND_ROUTES`).
 * 그 판단이 맞으려면 이 경로들이 명령 기록과 처리를 한 저장점 안에서 하고, 저장점이 끝난 뒤에는
 * 반영 없이 닫힌 결과만 409 로 바꿔야 한다. 이 가드가 그 구조를 지킨다.
 */
const ROOT = join(__dirname, '../../../../../..');
const APP_HTTP_CLIENT = 'native/warehouse-app/src/core/data/httpClient.ts';
const CONTROLLERS = [
  'apps/core/src/modules/fulfillment/controllers/simple-outbound.controller.ts',
  'apps/core/src/modules/fulfillment/controllers/location-outbound.controller.ts',
];
/**
 * 저장점이 끝난 뒤 올 수 있는 문장 — 그 결과를 돌려주거나, 반영 없이 닫힌 명령을 거절로 알리는 것뿐이다.
 * 그 밖의 호출은 커밋된 뒤 409 를 던질 수 있어 막는다.
 */
const afterSavePoint = (result: string) => [
  new RegExp(`^return ${result};$`),
  new RegExp(
    `^if \\(isForceRejection\\(${result}\\)\\) \\{ throw this\\.conflict\\(FORCE_NOT_APPLIED\\.code, '[^']*'\\); \\}$`,
  ),
];

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(join(ROOT, path), 'utf8'), ts.ScriptTarget.Latest, true);
}

function find<T extends ts.Node>(root: ts.Node, test: (node: ts.Node) => node is T): T[] {
  const found: T[] = [];
  const visit = (node: ts.Node): void => {
    if (test(node)) found.push(node);
    node.forEachChild(visit);
  };
  visit(root);
  return found;
}

function appRoutes(): string[] {
  const src = parse(APP_HTTP_CLIENT);
  const declaration = find(src, ts.isVariableDeclaration).find(
    (d) => ts.isIdentifier(d.name) && d.name.text === 'SAVE_POINT_OUTBOUND_ROUTES',
  );
  let list = declaration?.initializer;
  while (list && (ts.isAsExpression(list) || ts.isSatisfiesExpression(list))) list = list.expression;
  if (!list || !ts.isArrayLiteralExpression(list)) throw new Error('SAVE_POINT_OUTBOUND_ROUTES not found');
  return list.elements.map((e) => {
    if (!ts.isStringLiteral(e)) throw new Error('SAVE_POINT_OUTBOUND_ROUTES must hold string literals');
    return e.text;
  });
}

type Route = { route: string; controller: string; method: ts.MethodDeclaration; src: ts.SourceFile };

function controllerRoutes(): Route[] {
  return CONTROLLERS.flatMap((controller) => {
    const src = parse(controller);
    return find(src, ts.isMethodDeclaration).flatMap((method) =>
      (ts.getDecorators(method) ?? []).flatMap((decorator) => {
        const call = decorator.expression;
        if (!ts.isCallExpression(call) || call.expression.getText(src) !== 'Post') return [];
        const [arg] = call.arguments;
        const match = arg && ts.isStringLiteral(arg) ? /^:shipmentId\/(.+)$/.exec(arg.text) : null;
        return match ? [{ route: match[1], controller, method, src }] : [];
      }),
    );
  });
}

/** `unwrapPreparedOutbound(await this.<field>.<name>(…))` 의 field·name. */
function delegatedCall(route: Route): { field: string; name: string } {
  const returns = find(route.method, ts.isReturnStatement);
  if (returns.length !== 1) throw new Error(`${route.route}: expected one return`);
  const outer = returns[0].expression;
  if (!outer || !ts.isCallExpression(outer) || outer.expression.getText(route.src) !== 'unwrapPreparedOutbound')
    throw new Error(`${route.route}: must return unwrapPreparedOutbound(await this.<service>.<method>(…))`);
  const awaited = outer.arguments[0];
  const call = awaited && ts.isAwaitExpression(awaited) ? awaited.expression : undefined;
  const callee = call && ts.isCallExpression(call) ? call.expression : undefined;
  const owner = callee && ts.isPropertyAccessExpression(callee) ? callee.expression : undefined;
  if (!callee || !ts.isPropertyAccessExpression(callee) || !owner || !ts.isPropertyAccessExpression(owner))
    throw new Error(`${route.route}: must delegate to this.<service>.<method>(…)`);
  return { field: owner.name.text, name: callee.name.text };
}

/** 생성자 주입 필드의 타입 → 그 클래스를 import 한 파일. */
function serviceFile(route: Route, field: string): string {
  const parameter = find(route.src, ts.isParameter).find(
    (p) => ts.isIdentifier(p.name) && p.name.text === field && ts.isConstructorDeclaration(p.parent),
  );
  const typeName = parameter?.type?.getText(route.src);
  const importDeclaration = find(route.src, ts.isImportDeclaration).find((d) =>
    d.importClause?.namedBindings && ts.isNamedImports(d.importClause.namedBindings)
      ? d.importClause.namedBindings.elements.some((e) => e.name.text === typeName)
      : false,
  );
  if (!importDeclaration || !ts.isStringLiteral(importDeclaration.moduleSpecifier))
    throw new Error(`${route.route}: cannot resolve ${field}`);
  return relative(ROOT, join(ROOT, dirname(route.controller), `${importDeclaration.moduleSpecifier.text}.ts`));
}

function methodOf(src: ts.SourceFile, name: string): ts.MethodDeclaration {
  const method = find(src, ts.isMethodDeclaration).find((m) => ts.isIdentifier(m.name) && m.name.text === name);
  if (!method?.body) throw new Error(`${src.fileName}: method ${name} not found`);
  return method;
}

function arrowBody(node: ts.Expression | undefined): ts.Expression | undefined {
  return node && ts.isArrowFunction(node) && !ts.isBlock(node.body) ? node.body : undefined;
}

/** `this.dbService.run((t) => t.transaction((sp) => this.commands.execute(…, sp)), tx)` */
function savePointCall(root: ts.Node, src: ts.SourceFile): ts.CallExpression | undefined {
  return find(root, ts.isCallExpression).find((run) => {
    if (run.expression.getText(src) !== 'this.dbService.run') return false;
    const transaction = arrowBody(run.arguments[0]);
    if (!transaction || !ts.isCallExpression(transaction)) return false;
    const access = transaction.expression;
    const outerParam = (run.arguments[0] as ts.ArrowFunction).parameters[0]?.name.getText(src);
    if (!ts.isPropertyAccessExpression(access) || access.getText(src) !== `${outerParam}.transaction`) return false;
    const execute = arrowBody(transaction.arguments[0]);
    if (!execute || !ts.isCallExpression(execute) || execute.expression.getText(src) !== 'this.commands.execute')
      return false;
    const savepoint = (transaction.arguments[0] as ts.ArrowFunction).parameters[0]?.name.getText(src);
    const last = execute.arguments[execute.arguments.length - 1];
    return !!savepoint && execute.arguments.length === 3 && last.getText(src) === savepoint;
  });
}

/** 메서드가 저장점을 직접 열거나, 그렇게 여는 this.<helper>(…) 하나를 부른다. 그 호출 노드를 돌려준다. */
function enteringCall(
  src: ts.SourceFile,
  method: ts.MethodDeclaration,
): { call: ts.Node; helper?: ts.MethodDeclaration } {
  const direct = savePointCall(method, src);
  if (direct) return { call: direct };
  for (const call of find(method, ts.isCallExpression)) {
    const callee = call.expression;
    if (!ts.isPropertyAccessExpression(callee) || callee.expression.kind !== ts.SyntaxKind.ThisKeyword) continue;
    const helper = find(src, ts.isMethodDeclaration).find(
      (m) => ts.isIdentifier(m.name) && m.name.text === callee.name.text,
    );
    if (helper && savePointCall(helper, src)) return { call, helper };
  }
  throw new Error(`${src.fileName}#${method.name.getText(src)} does not run inside the command save point`);
}

const inside = (src: ts.SourceFile, node: ts.Node, call: ts.Node) =>
  node.getStart(src) >= call.getStart(src) && node.getEnd() <= call.getEnd();

/** 저장점 밖에서 기다리는 일 — 저장점 호출 자신을 기다리는 것 말고는 없어야 한다(그 밖의 쓰기는 커밋된다). */
function awaitsOutside(src: ts.SourceFile, scope: ts.MethodDeclaration, call: ts.Node): string[] {
  return find(scope.body!, ts.isAwaitExpression)
    .filter((a) => a.expression !== call && !inside(src, a, call))
    .map((a) => a.getText(src));
}

/** 저장점 밖에서 부를 수 있는 것 — 입력 확인·값 다듬기뿐이다. 기다리지 않는 쓰기도 커밋될 수 있어 막는다. */
const CALLS_OUTSIDE_SAVE_POINT =
  /^(this\.(assert\w*|normalize\w*|conflict|workflowGate\.assert\w*)|is\w+|Number\.isSafeInteger|[\w.]+\.trim)$/;

/** 같은 클래스의 도우미는 동기이고 DB 에 닿지 않아야 저장점 밖에서 부를 수 있다. */
function touchesStorage(src: ts.SourceFile, callee: string): boolean {
  const own = /^this\.(\w+)$/.exec(callee);
  if (!own) return false;
  const helper = find(src, ts.isMethodDeclaration).find((m) => ts.isIdentifier(m.name) && m.name.text === own[1]);
  if (!helper?.body) return true;
  const async = helper.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
  return async || /\bawait\b|dbService|commands|\.run\(|\.transaction\(/.test(helper.body.getText(src));
}

function callsOutside(src: ts.SourceFile, scope: ts.MethodDeclaration, call: ts.Node): string[] {
  return find(scope.body!, ts.isCallExpression)
    .filter((c) => c !== call && !inside(src, c, call))
    .map((c) => c.expression.getText(src))
    .filter((callee) => !CALLS_OUTSIDE_SAVE_POINT.test(callee) || touchesStorage(src, callee));
}

const normalized = (src: ts.SourceFile, node: ts.Node) =>
  node.getText(src).replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/,? \)/g, ')');

/**
 * 메서드가 저장점 호출의 결과를 그대로 돌려주는지 — `return <call>` 이거나, `const x = await <call>` 한 선언 뒤에
 * x 를 돌려주는 문장과 반영 없는 거절만 온다. 어긋난 문장을 돌려준다.
 */
function savePointReturnProblems(src: ts.SourceFile, scope: ts.MethodDeclaration, call: ts.Node): string[] {
  const statements = scope.body!.statements;
  const index = statements.findIndex((st) => inside(src, call, st));
  const holder = statements[index];
  if (!holder) return ['save point call is not a top-level statement'];
  const after = statements.slice(index + 1);
  if (ts.isReturnStatement(holder) && holder.expression === call) return after.map((st) => normalized(src, st));
  const [declaration, ...others] = ts.isVariableStatement(holder) ? holder.declarationList.declarations : [];
  if (
    !declaration ||
    others.length > 0 ||
    !ts.isIdentifier(declaration.name) ||
    !declaration.initializer ||
    !ts.isAwaitExpression(declaration.initializer) ||
    declaration.initializer.expression !== call
  )
    return [normalized(src, holder)];
  const allowed = afterSavePoint(declaration.name.text);
  const last = after[after.length - 1];
  return [
    ...after.map((st) => normalized(src, st)).filter((text) => !allowed.some((rule) => rule.test(text))),
    ...(last && normalized(src, last) === `return ${declaration.name.text};`
      ? []
      : ['must return the save point result']),
  ];
}

describe('물류앱이 «반영 안 된 거절»로 보는 출고 저장 경로', () => {
  const routes = appRoutes();
  const declared = controllerRoutes();

  it('앱 목록의 경로는 모두 core 에 있다', () => {
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.filter((r) => !declared.some((d) => d.route === r))).toEqual([]);
  });

  it.each(routes)('%s 는 명령 기록과 처리를 한 저장점 안에서 하고, 그 뒤에는 반영 없는 거절만 던진다', (name) => {
    const route = declared.find((d) => d.route === name)!;
    const { field, name: methodName } = delegatedCall(route);
    const file = serviceFile(route, field);
    const src = parse(file);
    const method = methodOf(src, methodName);
    const { call, helper } = enteringCall(src, method);

    expect(savePointReturnProblems(src, method, call)).toEqual([]);
    expect(awaitsOutside(src, method, call)).toEqual([]);
    expect(callsOutside(src, method, call)).toEqual([]);
    if (helper) {
      const inner = savePointCall(helper, src)!;
      expect(savePointReturnProblems(src, helper, inner)).toEqual([]);
      expect(awaitsOutside(src, helper, inner)).toEqual([]);
      expect(callsOutside(src, helper, inner)).toEqual([]);
    }
  });
});
