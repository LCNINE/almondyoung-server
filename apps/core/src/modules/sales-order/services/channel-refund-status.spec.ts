import { channelRefundStatus, manualTransferOf, needsTransferCheck } from './channel-refund-status';

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
  it('자동으로 끝남 → wallet 이 송금 대기(무통장 계좌 없음 폴백)를 갖고 있으면 transfer_pending, 아니면 기존 도출', () => {
    expect(channelRefundStatus([applied('auto')], 'pending')).toBe('transfer_pending');
    expect(channelRefundStatus([applied('auto')], 'done')).toBeNull();
  });
  it('자동으로만 끝남 + wallet 모름 → 기존 도출 — 대부분 카드 환불로 진짜 끝났다, «송금 예정»도 거짓일 수 있다', () => {
    expect(channelRefundStatus([applied('auto')], 'unknown')).toBeNull();
    expect(channelRefundStatus([applied('auto')], null)).toBeNull();
  });
  it('자동·수동 섞임 + wallet 모름 → 수동이 있으니 transfer_pending(지금 그대로)', () => {
    expect(channelRefundStatus([applied('auto'), applied('manual')], 'unknown')).toBe('transfer_pending');
  });
  it('요청 없음 → 기존 도출', () => {
    expect(channelRefundStatus([], null)).toBeNull();
  });
});

describe('needsTransferCheck — 정산이 끝났고 정산 중인 것이 없으면 wallet 의 송금 대기를 묻는다(자동도 — wallet 이 수동으로 떨어뜨릴 수 있다)', () => {
  it('끝난 정산이 하나라도 있고 정산 중인 것이 없을 때만', () => {
    expect(needsTransferCheck([applied('auto')])).toBe(true);
    expect(needsTransferCheck([applied('manual'), applied('auto')])).toBe(true);
    expect(needsTransferCheck([settling('in_progress'), applied('manual')])).toBe(false);
    expect(needsTransferCheck([])).toBe(false);
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
