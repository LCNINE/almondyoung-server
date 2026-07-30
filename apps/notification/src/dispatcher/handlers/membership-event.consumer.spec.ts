import { Test, TestingModule } from '@nestjs/testing';
import type { MembershipStatusChangedPayload } from '@packages/event-contracts/streams/membership.stream';
import { MembershipEventConsumer } from './membership-event.consumer';
import { NotificationDispatcherService } from '../services/notification-dispatcher.service';
import { EventMappingService } from '../../shared/services/event-mapping.service';

describe('MembershipEventConsumer', () => {
  let consumer: MembershipEventConsumer;

  const send = jest.fn();
  const getEventMapping = jest.fn();

  const envelope = { correlationId: 'corr-1' } as never;

  function payload(overrides: Partial<MembershipStatusChangedPayload> = {}): MembershipStatusChangedPayload {
    return {
      userId: 'user_1',
      email: 'a@b.com',
      status: 'RECURRING_CANCELLED',
      occurredAt: '2026-07-30T00:00:00.000Z',
      contractId: 'contract_1',
      ...overrides,
    };
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    getEventMapping.mockResolvedValue({
      eventKey: 'MEMBERSHIP_RECURRING_CANCELLED',
      templateKey: 'MEMBERSHIP_RECURRING_CANCELLED_EMAIL',
      category: 'TRANSACTIONAL',
      defaultChannels: ['EMAIL'],
      priority: 'HIGH',
      isActive: true,
    });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MembershipEventConsumer],
      providers: [
        { provide: NotificationDispatcherService, useValue: { send } },
        { provide: EventMappingService, useValue: { getEventMapping } },
      ],
    }).compile();

    consumer = module.get(MembershipEventConsumer);
  });

  it('해지 예약은 이용 종료일을 담아 발송한다', async () => {
    await consumer.onMembershipStatusChanged(envelope, payload({ periodEndsAt: '2026-08-28' }));

    expect(getEventMapping).toHaveBeenCalledWith('MEMBERSHIP_RECURRING_CANCELLED');
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_1',
        variables: expect.objectContaining({ email: 'a@b.com', endsAt: '2026-08-28' }),
      }),
    );
  });

  it('즉시 해지는 환불 완료 문구를 담는다', async () => {
    await consumer.onMembershipStatusChanged(
      envelope,
      payload({ status: 'CANCELLED', refundAmount: 34930, refundStatus: 'COMPLETED' }),
    );

    expect(getEventMapping).toHaveBeenCalledWith('MEMBERSHIP_CANCELLED');
    const dto = send.mock.calls[0][0];
    expect(dto.variables.refundNotice).toContain('34,930원');
    expect(dto.variables.refundNotice).toContain('환불 처리되었습니다');
    expect(dto.variables.endsAt).toBe('즉시 종료');
  });

  it('수동 송금 대기(PENDING)는 "완료" 로 안내하지 않는다', async () => {
    await consumer.onMembershipStatusChanged(
      envelope,
      payload({ status: 'CANCELLED', refundAmount: 4990, refundStatus: 'PENDING' }),
    );

    const dto = send.mock.calls[0][0];
    expect(dto.variables.refundNotice).toContain('접수');
    expect(dto.variables.refundNotice).not.toContain('처리되었습니다');
  });

  it('환불 실패는 고객센터 확인 안내로 바뀐다', async () => {
    await consumer.onMembershipStatusChanged(
      envelope,
      payload({ status: 'CANCELLED', refundAmount: 4990, refundStatus: 'FAILED' }),
    );

    expect(send.mock.calls[0][0].variables.refundNotice).toContain('고객센터');
  });

  it('환불이 없으면 환불 금액 문구를 넣지 않는다', async () => {
    await consumer.onMembershipStatusChanged(envelope, payload({ status: 'CANCELLED', refundAmount: 0 }));

    expect(send.mock.calls[0][0].variables.refundNotice).toBe('환불 대상 금액은 없습니다.');
  });

  it('해지와 무관한 상태(가입/일시정지/만료)는 알림을 보내지 않는다', async () => {
    for (const status of ['ACTIVE', 'PAUSED', 'RESUMED', 'EXPIRED'] as const) {
      await consumer.onMembershipStatusChanged(envelope, payload({ status }));
    }

    expect(getEventMapping).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('email 이 없으면 발송을 시도하지 않는다 (디스패처가 사용자 조회를 못 한다)', async () => {
    await consumer.onMembershipStatusChanged(envelope, payload({ email: undefined }));

    expect(send).not.toHaveBeenCalled();
  });

  it('이벤트 매핑이 없으면 조용히 건너뛴다', async () => {
    getEventMapping.mockResolvedValue(null);

    await consumer.onMembershipStatusChanged(envelope, payload());

    expect(send).not.toHaveBeenCalled();
  });

  it('발송 실패는 DLQ 로 보내기 위해 다시 throw 한다', async () => {
    send.mockRejectedValue(new Error('resend down'));

    await expect(consumer.onMembershipStatusChanged(envelope, payload())).rejects.toThrow('resend down');
  });
});
