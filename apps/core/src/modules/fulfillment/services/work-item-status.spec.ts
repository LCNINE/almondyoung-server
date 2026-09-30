import { outboundBatchWorkItemStatusEnum } from '../../inventory/schema/inventory.schema';
import { ACTIVE_WORK_ITEM_STATUSES, WITHDRAWABLE_WORK_ITEM_STATUSES } from './work-item-status';

describe('작업 항목 상태 정의', () => {
  it('활성 = completed·excluded 가 아닌 모든 값 — 부분 유니크 인덱스와 같은 정의', () => {
    const active = outboundBatchWorkItemStatusEnum.enumValues.filter((s) => s !== 'completed' && s !== 'excluded');
    expect([...ACTIVE_WORK_ITEM_STATUSES].sort()).toEqual([...active].sort());
  });

  it('이탈 가능 = 활성 중 결품 격리·이탈 중이 아닌 것', () => {
    expect([...WITHDRAWABLE_WORK_ITEM_STATUSES].sort()).toEqual(['packing', 'picking', 'queued', 'ready_to_pack']);
  });
});
