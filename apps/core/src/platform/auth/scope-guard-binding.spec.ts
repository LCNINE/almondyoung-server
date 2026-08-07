import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';

/**
 * `@RequireScopes` 는 메타데이터일 뿐이다 — `ScopeGuard` 가 같은 라우트에 바인딩돼 있지 않으면
 * 아무것도 막지 못한다. core 는 `ScopeGuard` 를 전역 등록하지 않고 컨트롤러마다 수동으로 붙이므로
 * 이 짝이 깨지는 건 **무증상**이다.
 *
 * 게다가 `AdminRealmGuard` 는 `@RequireScopes` 가 붙은 라우트를 "정책이 이미 명시됨" 으로 보고
 * 직원 역할 검사를 건너뛴다. 따라서 짝이 깨진 라우트는 두 가드를 모두 통과한다 — 스코프도,
 * 역할도 검사하지 않는 상태가 된다. 파일 단위가 아니라 **핸들러 단위**로 봐야 잡힌다.
 */
const MODULES_DIR = join(__dirname, '..', '..', 'modules');
const HTTP_METHODS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'All', 'Head', 'Options']);

interface Decorator {
  name: string;
  args: string[];
}

function collectControllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectControllerFiles(full));
    else if (/\.controllers?\.ts$/.test(entry) && !entry.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

function decoratorsOf(node: ts.Node): Decorator[] {
  return (ts.getDecorators(node as ts.HasDecorators) ?? []).map((d) => {
    const e = d.expression;
    return ts.isCallExpression(e)
      ? { name: e.expression.getText(), args: e.arguments.map((a) => a.getText()) }
      : { name: e.getText(), args: [] };
  });
}

const bindsScopeGuard = (decs: Decorator[]) =>
  decs.some((d) => d.name === 'UseGuards' && d.args.some((a) => /\bScopeGuard\b/.test(a)));

const requiresScopes = (decs: Decorator[]) => decs.some((d) => d.name === 'RequireScopes');

/** `@RequireScopes` 는 있는데 같은 라우트에 `ScopeGuard` 가 없는 핸들러. */
function findUnboundHandlers(file: string): string[] {
  const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const offenders: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node)) {
      const classDecs = decoratorsOf(node);
      if (classDecs.some((d) => d.name === 'Controller')) {
        const classGuard = bindsScopeGuard(classDecs);
        const classScopes = requiresScopes(classDecs);

        for (const member of node.members) {
          if (!ts.isMethodDeclaration(member)) continue;
          const decs = decoratorsOf(member);
          if (!decs.some((d) => HTTP_METHODS.has(d.name))) continue;

          const scoped = requiresScopes(decs) || classScopes;
          const guarded = bindsScopeGuard(decs) || classGuard;
          if (scoped && !guarded) {
            const { line } = src.getLineAndCharacterOfPosition(member.getStart());
            offenders.push(`${node.name?.getText() ?? '?'}.${member.name.getText()} (line ${line + 1})`);
          }
        }
      }
    }
    node.forEachChild(visit);
  };

  src.forEachChild(visit);
  return offenders;
}

describe('core: @RequireScopes ↔ ScopeGuard 바인딩', () => {
  const files = collectControllerFiles(MODULES_DIR);

  it('컨트롤러 파일을 실제로 수집한다 (수집 실패로 인한 위양성 방지)', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('@RequireScopes 가 붙은 모든 핸들러에 ScopeGuard 가 바인딩돼 있다', () => {
    const offenders = files.flatMap((file) =>
      findUnboundHandlers(file).map((h) => `${file.slice(file.indexOf('modules/'))} → ${h}`),
    );

    expect(offenders).toEqual([]);
  });
});
