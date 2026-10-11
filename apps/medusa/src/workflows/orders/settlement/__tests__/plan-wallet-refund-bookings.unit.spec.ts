import type { WalletRefundListItem } from '../../../../modules/almond-payment/wallet-refund-list';
import { planWalletRefundBookings } from '../plan-wallet-refund-bookings';

const row = (id: string, amount: number, extra: Partial<WalletRefundListItem> = {}): WalletRefundListItem => ({
  id,
  amount,
  status: 'SUCCEEDED',
  reasonCode: 'MEDUSA_REFUND',
  createdAt: `2026-10-11T00:00:0${id.slice(-1)}.000Z`,
  ...extra,
});

describe('planWalletRefundBookings — 장부 맞추기 판정 (#1016 36번 재설계 §6.2)', () => {
  it('장부에 없는 SUCCEEDED·PENDING 만 넣는다 — FAILED 는 돈이 안 움직였고, 장부에 있는 것은 두 번 넣지 않는다', () => {
    const plan = planWalletRefundBookings({
      walletRefunds: [
        row('w1', 1000, { reasonCode: 'ADMIN_REFUND' }),
        row('w2', 2000, { reasonCode: 'ADMIN_REFUND', status: 'PENDING' }),
        row('w3', 3000, { reasonCode: 'ADMIN_REFUND', status: 'FAILED' }),
        row('w4', 4000, { reasonCode: 'ADMIN_REFUND' }),
      ],
      bookedWalletRefundIds: ['w4'],
      attempt: null,
    });
    expect(plan).toEqual([
      { walletRefundId: 'w1', amount: 1000, note: 'wallet:w1' },
      { walletRefundId: 'w2', amount: 2000, note: 'wallet:w2' },
    ]);
  });

  it('시도 표식이 없으면 장부에 없는 MEDUSA_REFUND(응답 유실)도 wallet: 메모로 넣는다 — 지금 투영은 건너뛰던 것', () => {
    expect(planWalletRefundBookings({ walletRefunds: [row('w1', 5000)], bookedWalletRefundIds: [], attempt: null })).toEqual([
      { walletRefundId: 'w1', amount: 5000, note: 'wallet:w1' },
    ]);
  });

  it('시도 표식이 남아 있으면 장부에 없는 MEDUSA_REFUND 를 그 메모로 — 부분취소가 «이 요청의 환불»로 세어 다시 내지 않는다', () => {
    expect(
      planWalletRefundBookings({
        walletRefunds: [row('w1', 20000), row('w2', 10000)],
        bookedWalletRefundIds: [],
        attempt: { note: 'partial-cancel:r1', amount: 30000 },
      }),
    ).toEqual([
      { walletRefundId: 'w1', amount: 20000, note: 'partial-cancel:r1' },
      { walletRefundId: 'w2', amount: 10000, note: 'partial-cancel:r1' },
    ]);
  });

  it('표식 금액까지만 귀속시키고 넘는 것은 wallet: — 다른 경로의 유실분을 이 요청 몫으로 부풀리지 않는다', () => {
    expect(
      planWalletRefundBookings({
        walletRefunds: [row('w1', 20000), row('w2', 20000)],
        bookedWalletRefundIds: [],
        attempt: { note: 'partial-cancel:r1', amount: 30000 },
      }),
    ).toEqual([
      { walletRefundId: 'w1', amount: 20000, note: 'partial-cancel:r1' },
      { walletRefundId: 'w2', amount: 20000, note: 'wallet:w2' },
    ]);
  });

  it('외부 환불(MEDUSA_REFUND 아님)은 표식이 있어도 wallet: — 37번 판정이 «외부 환불»로 읽는다', () => {
    expect(
      planWalletRefundBookings({
        walletRefunds: [row('w1', 5000, { reasonCode: 'ADMIN_REFUND' })],
        bookedWalletRefundIds: [],
        attempt: { note: 'channel-cancel:o1', amount: 33000 },
      }),
    ).toEqual([{ walletRefundId: 'w1', amount: 5000, note: 'wallet:w1' }]);
  });

  it('만든 순서대로 — 목록 순서와 무관하게', () => {
    const plan = planWalletRefundBookings({
      walletRefunds: [row('w2', 2000, { reasonCode: null }), row('w1', 1000, { reasonCode: null })],
      bookedWalletRefundIds: [],
      attempt: null,
    });
    expect(plan.map((b) => b.walletRefundId)).toEqual(['w1', 'w2']);
  });

  it('금액이 양의 정수가 아니면 건너뛴다', () => {
    expect(
      planWalletRefundBookings({ walletRefunds: [row('w1', 0), row('w2', 1.5)], bookedWalletRefundIds: [], attempt: null }),
    ).toEqual([]);
  });
});
