import { mergeGroupFees } from '../settlement/group-fees';
import type { ReturnSettlementRecord } from '../returns/return-settlement-record';
import type { PriorGroupFees } from './plan-shipping';

type FeeRecord = { orderVersion: number; groupFees: Record<string, number> };

/**
 * 부분취소의 «지금 그룹 요금». 부분취소 기록에 반품 정산 기록을 겹치되, 청구가 주문에 «실제로 붙은» 정산
 * (charged·refunded)만 쓴다. received 의 groupFees 는 아직 붙지 않은 청구를 말한다 — 그 청구가 끝내 안 붙으면
 * 그룹 요금을 부풀려 다음 부분취소가 받지 않은 돈을 돌려주게 된다.
 */
export function priorGroupFeesFor(partialCancelRecords: FeeRecord[], returnRecords: ReturnSettlementRecord[]): PriorGroupFees {
  return mergeGroupFees([...partialCancelRecords, ...returnRecords.filter((r) => r.stage === 'charged' || r.stage === 'refunded')]);
}
