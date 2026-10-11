import { JudgedShipmentRow } from '../order-progress/order-progress.reader';
import { ReconcileSituationRef } from './order-reconcile.rule';

/**
 * 상자 규칙이 건드리면 안 되는 주문 판정(스펙 D16). 상자에 라인이 있는 주문 중 하나라도 이 판정이면 그 상자는 후보가 아니다.
 * 채널 취소 요청 중(출고 보류) · 셀메이트 출고(D1) · 반품·교환. 취소된 주문(cancel_open·cancelled)은 30번이 다뤄야 하므로 통과한다.
 * 규칙마다 허용 상태를 선언하게 하지 않는 이유: 하나가 빠뜨리면 셀메이트 출고 주문을 건드린다.
 * 채널 취소의 정산(cancel_settle)은 넣지 않는다 — 확정됐고 보류가 없다. 부분취소의 남은 상자는 상자 규칙의 도움을 받는다(#1016 36번 재설계 D5).
 * 상자 판정은 정산 중이어도 판매주문의 종료 사실(external_shipped·cancel_open·cancelled·return_exchange)을 그대로 싣는다(judgedShipmentsSql) —
 * 셀메이트가 남은 몫을 출고한 부분취소 주문은 정산이 열려 있어도 여기서 제외된다.
 */
export const SHIPMENT_EXCLUDED_ORDER_RULES = ['cancel_request', 'external_shipped', 'return_exchange'] as const;

/** 상자 하나가 지금 규칙의 칸 안인가. 후보 선택·떠남·실행 직전 게이트가 모두 이 함수를 쓴다(판단이 한 벌이어야 엇갈리지 않는다) */
export function shipmentInSituation(
  situation: ReconcileSituationRef,
  row: Pick<JudgedShipmentRow, 'stage' | 'state' | 'orderRules'> | undefined,
): boolean {
  if (!row || row.state === null) return false;
  const excluded: readonly string[] = SHIPMENT_EXCLUDED_ORDER_RULES;
  if (row.orderRules.some((r) => excluded.includes(r))) return false;
  return row.stage === situation.stage && situation.states.includes(row.state);
}

/** 칸 안인 상자 id — 단계 진입 오래된 순(추정 시각이 없으면 뒤), 같으면 id 순. 주문 후보의 «stage_entered_at 오래된 순»과 같은 뜻이다 */
export function inSituationShipmentIds(rows: JudgedShipmentRow[], situation: ReconcileSituationRef): string[] {
  // ISO 문자열은 판정 SQL 이 같은 형식으로 내므로 문자열 비교가 곧 시각 비교다
  return rows
    .filter((r) => shipmentInSituation(situation, r))
    .sort((a, b) => {
      if (a.estimatedEnteredAt !== b.estimatedEnteredAt) {
        if (a.estimatedEnteredAt === null) return 1;
        if (b.estimatedEnteredAt === null) return -1;
        return a.estimatedEnteredAt < b.estimatedEnteredAt ? -1 : 1;
      }
      return a.shipmentId < b.shipmentId ? -1 : a.shipmentId > b.shipmentId ? 1 : 0;
    })
    .map((r) => r.shipmentId);
}
