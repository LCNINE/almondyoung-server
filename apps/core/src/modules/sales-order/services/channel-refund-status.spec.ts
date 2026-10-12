import { channelRefundStatus, manualTransferOf, needsManualTransferCheck } from './channel-refund-status';

const settling = (phase: 'in_progress' | 'delayed' | 'refused', mode: 'auto' | 'manual' = 'auto') =>
  ({ status: 'settling', mode, phase }) as const;
const applied = (mode: 'auto' | 'manual' = 'auto') => ({ status: 'applied', mode }) as const;

describe('channelRefundStatus — 정산 → 고객 환불 배지(스펙 §8.2)', () => {
  it('정산 중 → pending', () => {
    expect(channelRefundStatus([settling('in_progress')], null)).toBe('pending');
  });
  it('지연·거절 → delayed — 고객에겐 둘을 구분하지 않는다(§5.2)', () => {
    expect(channelRefundStatus([settling('delayed')], null)).toBe('delayed');
    expect(channelRefundStatus([settling('refused')], null)).toBe('delayed');
  });
  it('정산 중 하나라도 지연·거절이면 delayed(수동이 섞여도)', () => {
    expect(channelRefundStatus([settling('in_progress', 'manual'), settling('refused')], null)).toBe('delayed');
  });
  it('정산 중이 지연이어도 수동이면 transfer_pending / 거절이면 delayed', () => {
    expect(channelRefundStatus([settling('delayed', 'manual')], null)).toBe('transfer_pending');
    expect(channelRefundStatus([settling('refused', 'manual')], null)).toBe('delayed');
  });
  it('수동으로 정산 중 → transfer_pending', () => {
    expect(channelRefundStatus([settling('in_progress', 'manual')], null)).toBe('transfer_pending');
  });
  it('수동으로 끝남 · wallet 송금 대기 → transfer_pending / 송금 끝 → 기존 도출 / 모름 → transfer_pending', () => {
    expect(channelRefundStatus([applied('manual')], 'pending')).toBe('transfer_pending');
    expect(channelRefundStatus([applied('manual')], 'done')).toBeNull();
    expect(channelRefundStatus([applied('manual')], 'unknown')).toBe('transfer_pending');
    expect(channelRefundStatus([applied('auto'), applied('manual')], 'pending')).toBe('transfer_pending');
  });
  it('자동으로 끝남 → 기존 도출(수집된 환불)', () => {
    expect(channelRefundStatus([applied('auto')], null)).toBeNull();
  });
  it('요청 없음 → 기존 도출', () => {
    expect(channelRefundStatus([], null)).toBeNull();
  });
});

describe('needsManualTransferCheck — wallet 은 «수동으로 끝난 정산이 하나라도 있고 정산 중이 없는» 주문만 부른다', () => {
  it('수동으로 끝난 정산이 하나라도 있고 정산 중인 것이 없을 때만', () => {
    expect(needsManualTransferCheck([applied('manual'), applied('auto')])).toBe(true);
    expect(needsManualTransferCheck([applied('auto'), applied('manual')])).toBe(true);
    expect(needsManualTransferCheck([applied('auto')])).toBe(false);
    expect(needsManualTransferCheck([settling('in_progress'), applied('manual')])).toBe(false);
    expect(needsManualTransferCheck([])).toBe(false);
  });
});

describe('manualTransferOf', () => {
  it('MANUAL + PENDING 이 있으면 pending, 없으면 done, 응답 없음은 unknown', () => {
    expect(manualTransferOf([{ id: 'r1', status: 'PENDING', execution: 'MANUAL', amount: 1000 }])).toBe('pending');
    expect(manualTransferOf([{ id: 'r1', status: 'SUCCEEDED', execution: 'MANUAL', amount: 1000 }])).toBe('done');
    expect(manualTransferOf([{ id: 'r1', status: 'PENDING', execution: 'AUTO', amount: 1000 }])).toBe('done');
    expect(manualTransferOf(null)).toBe('unknown');
  });
});
