import { Test, TestingModule } from '@nestjs/testing';
import { UserWithdrawalConsumer } from './user-withdrawal.consumer';
import { SubscriptionCancellationService } from '../services/subscription-cancellation.service';
import { SubscriptionContractReader } from '../services/subscription/subscription-contract.reader';

/**
 * 탈퇴한 회원의 정기결제가 계속 청구되던 구멍을 막는 컨슈머.
 * 돈이 나가는 경로라 "해지했는가" 뿐 아니라 "환불을 멋대로 집행하지 않는가" 도 함께 고정한다.
 */
describe('UserWithdrawalConsumer', () => {
  let consumer: UserWithdrawalConsumer;
  let forceCancelSubscription: jest.Mock;
  let findContractsByUserId: jest.Mock;

  const USER_ID = 'user-1';

  beforeEach(async () => {
    forceCancelSubscription = jest.fn().mockResolvedValue({ refundAmount: 0 });
    findContractsByUserId = jest.fn().mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserWithdrawalConsumer],
      providers: [
        { provide: SubscriptionCancellationService, useValue: { forceCancelSubscription } },
        { provide: SubscriptionContractReader, useValue: { findContractsByUserId } },
      ],
    }).compile();

    consumer = module.get<UserWithdrawalConsumer>(UserWithdrawalConsumer);
  });

  it('활성 구독을 해지한다', async () => {
    findContractsByUserId.mockResolvedValue([{ id: 'c-1', status: 'ACTIVE' }]);

    await consumer.onUserDeleted({ userId: USER_ID });

    expect(forceCancelSubscription).toHaveBeenCalledTimes(1);
    expect(forceCancelSubscription.mock.calls[0][0]).toBe('c-1');
  });

  // 탈퇴는 이후 자동결제를 끊는 데까지만 책임진다. 환불은 해지 창구(수취 계좌를 묻는 곳)의 몫이고,
  // 여기서 시작하면 효성 CMS·무통장 건이 보낼 곳 없는 수동 대기로만 쌓인다.
  it('환불은 집행하지 않는다', async () => {
    findContractsByUserId.mockResolvedValue([{ id: 'c-1', status: 'ACTIVE' }]);

    await consumer.onUserDeleted({ userId: USER_ID });

    // (contractId, adminId, reason, refundType, amount, ...)
    expect(forceCancelSubscription.mock.calls[0][3]).toBe('NONE');
    expect(forceCancelSubscription.mock.calls[0][4]).toBeUndefined();
  });

  it('자동이체 계좌까지 삭제한다 — 탈퇴는 개인정보 파기를 포함한다', async () => {
    findContractsByUserId.mockResolvedValue([{ id: 'c-1', status: 'ACTIVE' }]);

    await consumer.onUserDeleted({ userId: USER_ID });

    const call = forceCancelSubscription.mock.calls[0];
    expect(call[9]).toBe(true); // deleteBillingMethod
    expect(call[8]).toBeUndefined(); // customerEmail — 안내 메일 미발송
  });

  it('이미 해지된 계약은 건너뛴다 (재시도 멱등)', async () => {
    findContractsByUserId.mockResolvedValue([
      { id: 'c-1', status: 'CANCELLED' },
      { id: 'c-2', status: 'ACTIVE' },
    ]);

    await consumer.onUserDeleted({ userId: USER_ID });

    expect(forceCancelSubscription).toHaveBeenCalledTimes(1);
    expect(forceCancelSubscription.mock.calls[0][0]).toBe('c-2');
  });

  it('구독이 없으면 아무것도 하지 않는다', async () => {
    await consumer.onUserDeleted({ userId: USER_ID });

    expect(forceCancelSubscription).not.toHaveBeenCalled();
  });

  it('해지에 실패하면 던진다 — 청구가 살아있는 채로 조용히 넘어가지 않는다', async () => {
    findContractsByUserId.mockResolvedValue([{ id: 'c-1', status: 'ACTIVE' }]);
    forceCancelSubscription.mockRejectedValue(new Error('wallet down'));

    await expect(consumer.onUserDeleted({ userId: USER_ID })).rejects.toThrow(/c-1/);
  });

  it('여러 계약 중 하나가 실패해도 나머지는 해지한다', async () => {
    findContractsByUserId.mockResolvedValue([
      { id: 'c-1', status: 'ACTIVE' },
      { id: 'c-2', status: 'EXPIRED' },
    ]);
    forceCancelSubscription.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ refundAmount: 0 });

    await expect(consumer.onUserDeleted({ userId: USER_ID })).rejects.toThrow(/c-1/);
    expect(forceCancelSubscription).toHaveBeenCalledTimes(2);
  });
});
