import { ConflictError } from '@app/shared';
import { WAYBILL } from '../waybill.constants';
import type { IssueContext, WaybillRow } from '../waybill.types';

/** assertDispatchable 뒤에 거는 라벨 전용 조건(스펙 §5 의 4~6). */
export function assertLabelAvailable(wb: Pick<WaybillRow, 'id' | 'source' | 'carrier' | 'labelData'>): void {
  if (wb.source !== 'carrier') {
    throw new ConflictError(`${WAYBILL.ERROR.LABEL_UNAVAILABLE}: manual waybill ${wb.id} has no carrier label data`);
  }
  if (wb.carrier !== 'HANJIN') {
    throw new ConflictError(`${WAYBILL.ERROR.LABEL_UNAVAILABLE}: no label template for carrier ${wb.carrier}`);
  }
  if (wb.labelData === null || wb.labelData === undefined) {
    throw new Error(`waybill ${wb.id} was issued by a carrier but has no labelData`);
  }
}

/**
 * `assertDispatchable` 과 `loadIssueContext` 는 같은 트랜잭션 안이라도 별개 statement 다 — READ COMMITTED
 * 에서는 그 사이 커밋된 수하인 정정이 두 번째 읽기에만 보일 수 있다. 그러면 해시 검사(assertDispatchable)는
 * 통과했는데 실제로 조립하는 라벨은 **새** 주소를 쓰게 되어, 한진에 등록된 값과 달라진다(#913 최종리뷰).
 * `render` 는 `loadIssueContext` 직후 이 함수로 재확인한다.
 */
export function assertContextMatchesWaybill(
  waybill: Pick<WaybillRow, 'id' | 'manifestVersion' | 'recipientHash'>,
  ctx: Pick<IssueContext, 'manifestVersion' | 'recipientSnapshot'>,
  hashOf: (recipientSnapshot: unknown) => string,
): void {
  if (waybill.manifestVersion !== ctx.manifestVersion || waybill.recipientHash !== hashOf(ctx.recipientSnapshot)) {
    throw new ConflictError(
      `${WAYBILL.ERROR.STALE}: waybill ${waybill.id} manifest/recipient changed between guard and assembly`,
    );
  }
}
