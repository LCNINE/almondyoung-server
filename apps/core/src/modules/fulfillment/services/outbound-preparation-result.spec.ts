import { isPreparationBlocked } from './outbound-preparation-result';
import { unwrapPreparedOutbound } from '../controllers/outbound-preparation-http';

// 옛 outbound-preparation-policy.spec.ts 에서 옮겨 왔다. 초안 교체 정책(canReplaceDraft)은 계획과 함께
// 사라졌지만, 준비 차단 표지는 현장 앱과의 와이어 계약이라 그 검증은 남긴다.
describe('outbound preparation HTTP boundary', () => {
  it('maps only known durable markers and preserves success snapshots', () => {
    const marker = {
      outcome: 'preparation_blocked',
      code: 'SIMPLE_OUTBOUND_PLAN_INVALIDATED',
      reasonCode: 'SOURCE_INSUFFICIENT',
      batchId: 'b',
      invalidatedPlanId: null,
      recovery: 'retry_preparation',
    } as const;
    expect(isPreparationBlocked(marker)).toBe(true);
    expect(isPreparationBlocked({ ...marker, reasonCode: 'DB_ERROR' })).toBe(false);
    expect(() => unwrapPreparedOutbound(marker)).toThrow('재고');
    const success = { shipmentId: 's' };
    expect(unwrapPreparedOutbound(success)).toBe(success);
  });
});
