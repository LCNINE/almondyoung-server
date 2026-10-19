import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import * as ts from 'typescript';

/**
 * K1a — 박스의 «전진» 명령은 커널의 전진 문(`runForwardWorkItemCommand`)을 지난다. 작업 항목 잠금과 재출력 게이트의
 * 순서는 그 문 한 곳이 고정한다. 전략이 이 둘을 직접 부르기 시작하면 복사본이 다시 생겨 순서가 갈린다 — 이 가드가
 * «커널 밖에서 부르는 곳이 없다»를 지킨다. 되돌림 명령은 전진 문을 지나지 않는다(스펙 §10.4) — K1b 뒤 unpick·handoff 본문은
 * 커널 파일에 있지만 전진 문 밖이고, 그래서 아래의 «전진 문을 부르는 곳» 도출 목록과 `RollbackCommandDeps`(labels 없음)가 지킨다.
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

/**
 * `runForwardWorkItemCommand` 를 참조하는 곳(호출·별칭·인자로 넘기기 모두)을 `<파일>#<감싼 메서드/함수>` 로.
 * import·export 선언과 함수 선언 자신의 이름은 뺀다. 닫힌 쪽: 호출이 아니어도 이름이 나오면 잡는다.
 */
function forwardDoorReferences(): string[] {
  const NAME = 'runForwardWorkItemCommand';
  const hits = new Set<string>();
  for (const path of walk(SRC)) {
    const text = readFileSync(path, 'utf8');
    if (!text.includes(NAME)) continue;
    const rel = relative(ROOT, path);
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
      if (ts.isIdentifier(node) && node.text === NAME) {
        const parent = node.parent;
        const isOwnDeclaration = ts.isFunctionDeclaration(parent) && parent.name === node;
        if (!isOwnDeclaration) hits.add(`${rel}#${enclosingName(node)}`);
      }
      node.forEachChild(visit);
    };
    visit(parse(path));
  }
  return [...hits].sort();
}

function pickingFiles(): string[] {
  return walk(join(ROOT, PICKING));
}

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
}

function enclosingName(node: ts.Node): string {
  for (let cur: ts.Node | undefined = node; cur; cur = cur.parent) {
    if ((ts.isMethodDeclaration(cur) || ts.isFunctionDeclaration(cur)) && cur.name && ts.isIdentifier(cur.name)) {
      return cur.name.text;
    }
  }
  return '<top>';
}

function propOf(obj: ts.Expression | undefined, name: string): ts.Expression | undefined {
  if (!obj || !ts.isObjectLiteralExpression(obj)) return undefined;
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === name) return p.initializer;
    if (ts.isShorthandPropertyAssignment(p) && p.name.text === name) return p.name;
  }
  return undefined;
}

function unwrap(node: ts.Expression): ts.Expression {
  let cur = node;
  while (
    ts.isAsExpression(cur) ||
    ts.isSatisfiesExpression(cur) ||
    ts.isParenthesizedExpression(cur) ||
    ts.isTypeAssertionExpression(cur) ||
    ts.isNonNullExpression(cur)
  ) {
    cur = cur.expression;
  }
  return cur;
}

/** 값이 취할 수 있는 문자열 리터럴 전부(삼항은 두 갈래). 정적으로 풀리지 않으면 null. */
function literalValues(node: ts.Expression): string[] | null {
  const value = unwrap(node);
  if (ts.isStringLiteralLike(value)) return [value.text];
  if (ts.isConditionalExpression(value)) {
    const whenTrue = literalValues(value.whenTrue);
    const whenFalse = literalValues(value.whenFalse);
    return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : null;
  }
  return null;
}

/**
 * 커널 밖 picking/ 비-spec 파일 중 작업 항목 상태를 쓸 수 있는 `.set(<patch>)` 를 가진 파일.
 * 닫힌 쪽으로 실패한다: ready_to_pack·queued 리터럴(as const·괄호·삼항 포함)은 물론, `status` 값이 리터럴로
 * 안 풀리거나(변수·shorthand) patch 가 객체 리터럴이 아니면 위반이다. 두 인자 `.set(k, v)`(Map)는 제외.
 * 오늘 측정(2026-10-19): 커널 밖 1-인자 `.set` 중 status 를 쓰는 것은 pick-to-tote 의 tote 테이블
 * ('in_use'|'available' 리터럴)뿐이라 허용 목록이 필요 없다.
 * 알려진 한계: raw SQL `UPDATE … SET status`, 구조분해한 moveCustody 는 잡지 못한다.
 */
function filesWritingPackOrQueuedStatus(): string[] {
  return pickingFiles()
    .filter((path) => {
      let found = false;
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'set' &&
          node.arguments.length === 1
        ) {
          const patch = unwrap(node.arguments[0]);
          if (!ts.isObjectLiteralExpression(patch)) {
            found = true;
          } else {
            const status = propOf(patch, 'status');
            const values = status ? literalValues(status) : [];
            if (values === null || values.some((v) => ['ready_to_pack', 'queued'].includes(v))) found = true;
          }
        }
        node.forEachChild(visit);
      };
      visit(parse(path));
      return found;
    })
    .map((path) => relative(ROOT, path))
    .sort();
}

/** picking/ 의 moveCustody 호출 중 목적지가 리터럴 'PACKING' 이거나 리터럴이 아닌 곳. `calls` 는 전체 호출 수. */
function packingDestinationMoves(): { hits: string[]; calls: number } {
  const hits = new Set<string>();
  let calls = 0;
  for (const path of pickingFiles()) {
    const rel = relative(ROOT, path);
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'moveCustody'
      ) {
        calls += 1;
        const custodyType = propOf(propOf(node.arguments[0], 'to'), 'custodyType');
        // 커널은 파일 통째로 허용 대상이라 메서드까지 쪼개지 않는다(handoff 는 같은 보관 종류 안에서 소유자만 바꾼다).
        if (!custodyType || !ts.isStringLiteralLike(custodyType)) {
          hits.add(rel.endsWith('/work-item-command.ts') ? rel : `${rel}#${enclosingName(node)}`);
        } else if (custodyType.text === 'PACKING') hits.add(rel);
      }
      node.forEachChild(visit);
    };
    visit(parse(path));
  }
  return { hits: [...hits].sort(), calls };
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

  it('aggregate 카트 락 키는 cartLockKey 하나가 만들고, sortScan 선행 락과 acquireCartLock 이 둘 다 그것을 쓴다', () => {
    const path = join(ROOT, PICKING, 'aggregate-then-sort.strategy.ts');
    const bodies = methodBodies(path);
    // sortScan 의 상호 배제는 «다른 카트 명령과 같은 키»에 달려 있다 — 문자열을 손으로 다시 쓰면 갈린다.
    expect(bodies.get('sortScan') ?? '').toContain('locksBefore: [cartLockKey(cartId)]');
    expect(bodies.get('acquireCartLock') ?? '').toContain('advisoryXactLock(tx, cartLockKey(cartId))');
    const text = readFileSync(path, 'utf8');
    expect(text.split('aggregate-cart:').length - 1).toBe(1); // cartLockKey 본문 한 곳
    expect(functionBody(path, 'cartLockKey')).toContain('aggregate-cart:');
  });

  it('커널 선행 락 루프는 공유 락 함수(advisoryXactLock)를 쓴다', () => {
    const body = functionBody(join(ROOT, PICKING, 'work-item-command.ts'), 'runForwardWorkItemCommand');
    expect(body).toContain('advisoryXactLock(trx, key)');
    expect(body).not.toContain('pg_advisory_xact_lock');
  });

  it('전진 문(runForwardWorkItemCommand)을 부르는 곳은 도출 목록과 같다 — 되돌림이 들어오거나 전진 명령이 빠지면 빨갛다', () => {
    // 2026-10-19 실측(HEAD). 되돌림(unpick·handoff·releaseTote·toteHandoff·cartHandoff·returnCartSurplus)은 없어야 한다 —
    // 송장 게이트가 빠지는 박스를 거절하므로 되돌림이 문을 지나면 빼는 일이 끝나지 않는다.
    expect(forwardDoorReferences()).toEqual([
      `${PICKING}/aggregate-then-sort.strategy.ts#sortScan`,
      `${PICKING}/discrete-picking.strategy.ts#scan`,
      `${PICKING}/pick-to-tote.strategy.ts#assignTote`,
      `${PICKING}/pick-to-tote.strategy.ts#toteScan`,
      `${PICKING}/work-item-command.ts#completeWorkItemPick`,
    ]);
  });

  it('picking/ 에서 작업 항목을 ready_to_pack·queued 로 쓰는 비-spec 파일은 커널뿐이다', () => {
    // 2026-10-19 실측: 전환 전 세 전략의 복사본이 커널로 모였고, allocation/ 등 다른 파일은 없다.
    expect(filesWritingPackOrQueuedStatus()).toEqual([`${PICKING}/work-item-command.ts`]);
  });

  it('picking/ 에서 PACKING 을 목적지로 moveCustody 하는 곳은 커널과 aggregate sortScan 뿐이다', () => {
    const { hits, calls } = packingDestinationMoves();
    expect(calls).toBeGreaterThan(0); // 걷기가 비면 아래 단언이 공허하게 통과한다
    expect(hits).toEqual([
      `${PICKING}/aggregate-then-sort.strategy.ts#sortScan`, // 목적지가 input.destinationCustody — 리터럴이 아니다
      `${PICKING}/work-item-command.ts`,
    ]);
  });

  it('커널의 되돌림 진입(unpickWorkItemShipment·handoffWorkItemPicker) 본문에는 assertCurrent 가 없다', () => {
    const path = join(ROOT, PICKING, 'work-item-command.ts');
    for (const name of ['unpickWorkItemShipment', 'handoffWorkItemPicker']) {
      const body = functionBody(path, name);
      expect(body).not.toBe('');
      expect(body).not.toContain('assertCurrent(');
    }
  });
});
