import { readFileSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';

/**
 * 스펙 I5 — 박스의 «전진» 명령은 재출력 게이트를 지난다. 게이트 진입점은 계획이 코드에서 도출했다:
 * 작업 항목을 잠그는 `lockAndAssertPickerClaim` 을 부르는 전략 메서드 전부 + 검수·발송의 `lockAggregate`.
 * 되돌림 명령은 게이트를 지나면 안 된다 — 막으면 빼는 일이 끝나지 않는다(스펙 §10.4).
 */
const DIR = join(__dirname);
const STRATEGIES = ['discrete-picking.strategy.ts', 'pick-to-tote.strategy.ts', 'aggregate-then-sort.strategy.ts'];
const ROLLBACK = ['unpickShipment', 'handoff', 'releaseTote', 'toteHandoff', 'cartHandoff'];
const GATE = 'this.labels.assertCurrent(';

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

describe('재출력 게이트 배선', () => {
  it.each(STRATEGIES)('%s: lockAndAssertPickerClaim 을 부르는 메서드는 그 뒤에 게이트를 부른다', (file) => {
    const offenders = [...methodBodies(join(DIR, file))]
      .filter(([, body]) => body.includes('lockAndAssertPickerClaim('))
      .filter(([, body]) => {
        const claim = body.indexOf('lockAndAssertPickerClaim(');
        const gate = body.indexOf(GATE);
        return gate === -1 || gate < claim;
      })
      .map(([name]) => name);
    expect(offenders).toEqual([]);
  });

  it.each(STRATEGIES)('%s: 되돌림 메서드는 게이트를 부르지 않는다', (file) => {
    const bodies = methodBodies(join(DIR, file));
    expect(ROLLBACK.filter((name) => bodies.get(name)?.includes(GATE))).toEqual([]);
  });

  it('검수·발송 공통 잠금(lockAggregate)이 작업 항목 잠금 뒤에 게이트를 부른다', () => {
    const body = methodBodies(join(DIR, '../services/shipment-dispatch.service.ts')).get('lockAggregate') ?? '';
    expect(body).toContain('this.labels.assertCurrent(workItem.id');
    expect(body.indexOf('this.labels.assertCurrent(workItem.id')).toBeGreaterThan(
      body.indexOf(".for('update')", body.indexOf('initialWorkItem.id')),
    );
  });

  it('게이트 진입 메서드 수가 도출 목록과 같다 — 새 전진 명령이 생기면 이 목록과 계획을 같이 고친다', () => {
    const gated = STRATEGIES.flatMap((file) =>
      [...methodBodies(join(DIR, file))].filter(([, body]) => body.includes(GATE)).map(([name]) => `${file}#${name}`),
    ).sort();
    expect(gated).toEqual(
      [
        'aggregate-then-sort.strategy.ts#completePick',
        'aggregate-then-sort.strategy.ts#sortScan',
        'discrete-picking.strategy.ts#completePick',
        'discrete-picking.strategy.ts#scan',
        'pick-to-tote.strategy.ts#assignTote',
        'pick-to-tote.strategy.ts#completePick',
        'pick-to-tote.strategy.ts#toteScan',
      ].sort(),
    );
  });
});
