import { readFileSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';

/**
 * K3 PR 2 — 창고 흐름의 진입 함수는 상자의 창고 id 를 `warehouseIdOf` 로만 얻는다(스펙 §4.8). 입점사 상자(warehouse_id NULL)가
 * 들어오면 거기서 409 `SUPPLIER_SHIPMENT_IN_WAREHOUSE_FLOW` 로 끝난다.
 *
 * 1차 방어선은 타입이다 — `shipments.warehouse_id` 가 nullable 이라 창고 id 로 재고·예약·원장을 다루려면 좁혀야 컴파일된다.
 * 이 목록은 타입이 못 잡는 진입점(창고 id 를 안 쓰고 상자를 고르는 곳)과, 좁힘이 다른 길로 바뀌지 않게 지켜야 하는 곳이다.
 * 목록은 줄어드는 방향만 — K3 PR 5·6 이 입점사 갈래를 그 앞에서 가를 때만 빼고, 뺄 때 근거를 적는다.
 */
const MODULES = join(__dirname, '../..');

const WAREHOUSE_FLOW_ENTRIES: ReadonlyArray<{ file: string; fn: string }> = [
  // 예약·원장
  { file: 'fulfillment/services/shipment-reservation.service.ts', fn: 'loadLineContext' },
  { file: 'fulfillment/services/shipment-reservation.service.ts', fn: 'restoreForRecall' },
  { file: 'inventory/core/repositories/stock-event.store.ts', fn: 'reverseShipmentDispatchEvent' },
  { file: 'inventory/core/repositories/stock-event.store.ts', fn: 'authorizeAndLinkBatchSessionDispatch' },
  { file: 'inventory/core/services/inventory-command.service.ts', fn: 'reverseShipmentDispatch' },
  // 작성 중 상자 맞추기(예약 해제·추가)
  { file: 'fulfillment/draft-box/draft-box-amender.ts', fn: 'amendLocked' },
  // 계획·피킹·배치·합배송. 배치 작업 항목은 assertJoinableBox 를 지나야만 생긴다(addShipment·joinStartedBatch) — 그래서
  // 작업 항목을 전제로 하는 피킹·간이 출고·결품·라벨 상태는 따로 두지 않는다.
  { file: 'fulfillment/services/shipment-planning.service.ts', fn: 'plan' },
  { file: 'fulfillment/services/outbound-batch-orchestrator.service.ts', fn: 'assertJoinableBox' },
  { file: 'fulfillment/picking/allocation/allocation.locks.ts', fn: 'assertStartEligibility' },
  { file: 'fulfillment/services/location-outbound.service.ts', fn: 'assertWarehouse' },
  { file: 'fulfillment/services/consolidation.service.ts', fn: 'assertCompatibleSources' },
  { file: 'fulfillment/services/consolidation.service.ts', fn: 'activateConsolidation' },
  // 송장 채번(발급·재발급·일괄 발급·수기 등록이 모두 loadIssueContext 를 지난다)·스캔
  { file: 'fulfillment/waybill/waybill.reader.ts', fn: 'loadIssueContext' },
  { file: 'fulfillment/waybill/waybill.manager.ts', fn: 'assertDispatchable' },
  { file: 'fulfillment/reader/shipment-waybill.reader.ts', fn: 'byTrackingNo' },
  { file: 'fulfillment/reader/shipment-waybill.reader.ts', fn: 'withdrawnByVoidedWaybill' },
  // 발송
  { file: 'fulfillment/services/shipment-dispatch.service.ts', fn: 'dispatchLocked' },
];

const GUARD = 'warehouseIdOf';

type Verdict = 'missing' | 'no-guard' | 'ok';

/** 그 이름의 함수·메서드 선언을 찾아 본문 어딘가(중첩 콜백 포함)에서 `warehouseIdOf(...)` 를 부르는지 본다. */
function guardVerdict(sourceText: string, fnName: string): Verdict {
  const src = ts.createSourceFile('x.ts', sourceText, ts.ScriptTarget.Latest, true);
  const bodies: ts.Node[] = [];
  const findDecl = (node: ts.Node): void => {
    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      node.name.text === fnName &&
      node.body
    ) {
      bodies.push(node.body);
    }
    ts.forEachChild(node, findDecl);
  };
  findDecl(src);
  if (bodies.length === 0) return 'missing';
  const callsGuard = (node: ts.Node): boolean =>
    (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === GUARD) ||
    (ts.forEachChild(node, (child) => (callsGuard(child) ? true : undefined)) ?? false);
  return bodies.every(callsGuard) ? 'ok' : 'no-guard';
}

describe('창고 흐름 진입점은 입점사 상자를 거부한다 (K3 §4.8)', () => {
  const verdicts = WAREHOUSE_FLOW_ENTRIES.map((entry) => ({
    ...entry,
    verdict: guardVerdict(readFileSync(join(MODULES, entry.file), 'utf8'), entry.fn),
  }));

  it('목록의 함수가 모두 존재한다 — 이름을 바꾸면 가드가 조용히 꺼지지 않게', () => {
    expect(verdicts.filter((v) => v.verdict === 'missing').map((v) => `${v.file}#${v.fn}`)).toEqual([]);
  });

  it('목록의 함수가 모두 warehouseIdOf 를 직접 부른다', () => {
    expect(verdicts.filter((v) => v.verdict === 'no-guard').map((v) => `${v.file}#${v.fn}`)).toEqual([]);
  });

  it('패턴이 살아 있다', () => {
    expect(guardVerdict('function f(s) { return warehouseIdOf(s); }', 'f')).toBe('ok');
    expect(guardVerdict('class A { async m(s) { return run(async () => warehouseIdOf(s)); } }', 'm')).toBe('ok');
    expect(guardVerdict('function f(s) { return s.warehouseId; }', 'f')).toBe('no-guard');
    expect(guardVerdict('function g(s) { return warehouseIdOf(s); }', 'f')).toBe('missing');
  });
});
