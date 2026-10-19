import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import * as ts from 'typescript';

/**
 * K1a — 박스의 «전진» 명령은 커널(`runForwardWorkItemCommand`)을 지난다. 작업 항목 잠금과 재출력 게이트의 순서는
 * 커널 한 곳이 고정한다. 전략이 이 둘을 직접 부르기 시작하면 복사본이 다시 생겨 순서가 갈린다 — 이 가드가
 * «커널 밖에서 부르는 곳이 없다»를 지킨다. 되돌림 명령은 커널을 지나지 않는다(스펙 §10.4).
 */
const ROOT = join(__dirname, '../../../../../..');
const SRC = join(ROOT, 'apps/core/src');
const PICKING = 'apps/core/src/modules/fulfillment/picking';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

function filesMatching(pattern: RegExp): string[] {
  return walk(SRC)
    .filter((path) => pattern.test(readFileSync(path, 'utf8')))
    .map((path) => relative(ROOT, path))
    .sort();
}

function methodBodies(path: string): Map<string, string> {
  const src = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const bodies = new Map<string, string>();
  const visit = (node: ts.Node): void => {
    if (ts.isMethodDeclaration(node) && node.body && ts.isIdentifier(node.name)) {
      bodies.set(node.name.text, node.body.getText(src));
    }
    node.forEachChild(visit);
  };
  visit(src);
  return bodies;
}

function functionBody(path: string, name: string): string {
  const src = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  let body = '';
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.body && node.name?.text === name) body = node.body.getText(src);
    node.forEachChild(visit);
  };
  visit(src);
  return body;
}

describe('작업 항목 명령 커널 배선', () => {
  it('lockAndAssertPickerClaim 을 부르는 비-spec 파일은 커널과 정의 파일뿐이다', () => {
    expect(filesMatching(/\blockAndAssertPickerClaim\(/)).toEqual([
      `${PICKING}/allocation/allocation.queries.ts`,
      `${PICKING}/work-item-command.ts`,
    ]);
  });

  it('labels.assertCurrent 를 부르는 비-spec 파일은 커널과 검수·발송 잠금뿐이다', () => {
    expect(filesMatching(/\.assertCurrent\(/)).toEqual([
      `${PICKING}/work-item-command.ts`,
      'apps/core/src/modules/fulfillment/services/shipment-dispatch.service.ts',
    ]);
  });

  it('커널 문은 작업 항목 잠금 다음에 게이트를 부른다', () => {
    const body = functionBody(join(ROOT, PICKING, 'work-item-command.ts'), 'runForwardWorkItemCommand');
    expect(body).toContain('lockAndAssertPickerClaim(');
    expect(body).toContain('assertCurrent(');
    expect(body.indexOf('lockAndAssertPickerClaim(')).toBeLessThan(body.indexOf('assertCurrent('));
  });

  it('검수·발송 공통 잠금(lockAggregate)이 작업 항목 잠금 뒤에 게이트를 부른다', () => {
    const body =
      methodBodies(join(ROOT, 'apps/core/src/modules/fulfillment/services/shipment-dispatch.service.ts')).get(
        'lockAggregate',
      ) ?? '';
    expect(body).toContain('this.labels.assertCurrent(workItem.id');
    expect(body.indexOf('this.labels.assertCurrent(workItem.id')).toBeGreaterThan(
      body.indexOf(".for('update')", body.indexOf('initialWorkItem.id')),
    );
  });

  it('aggregate sortScan 은 카트 락을 선행 락 키로 넘긴다', () => {
    const body = methodBodies(join(ROOT, PICKING, 'aggregate-then-sort.strategy.ts')).get('sortScan') ?? '';
    expect(body).toContain('locksBefore:');
    expect(body).toContain('aggregate-cart:');
  });
});
