import type { UserContactClient } from '@app/shared';
import type { EnvelopeOf } from '@packages/event-contracts/types';
import type { UGC_EVENT_STREAM } from '@packages/event-contracts/streams/ugc.stream';
import type { EventMappingService } from '../../shared/services/event-mapping.service';
import type { NotificationDispatcherService } from '../services/notification-dispatcher.service';
import { UgcEventConsumer } from './ugc-event.consumer';

const answered = {
  questionId: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000002',
  title: '배송 문의',
  answerContent: '내일 출고됩니다.\n감사합니다.',
  answeredAt: '2026-09-22T01:00:00.000Z',
};
const envelope = { correlationId: 'c-1' } as EnvelopeOf<typeof UGC_EVENT_STREAM, 'QuestionAnswered'>;

function make(isActive: boolean, email: string | undefined) {
  const send = jest.fn().mockResolvedValue({ notificationIds: [] });
  const mapping = {
    eventKey: 'QNA_ANSWERED',
    isActive,
    defaultChannels: ['EMAIL'],
    category: 'CUSTOMER_SERVICE',
    templateKey: 'QNA_ANSWERED_EMAIL',
    priority: 'NORMAL',
  };
  const contacts = email
    ? new Map([
        [
          answered.userId,
          { userId: answered.userId, email, username: '홍길동', phoneNumber: null, marketingConsent: false },
        ],
      ])
    : new Map();
  const consumer = new UgcEventConsumer(
    { send } as unknown as NotificationDispatcherService,
    { getEventMapping: jest.fn().mockResolvedValue(mapping) } as unknown as EventMappingService,
    { findContacts: jest.fn().mockResolvedValue(contacts) } as unknown as UserContactClient,
  );
  return { consumer, send };
}

describe('UgcEventConsumer 문의 답변 알림', () => {
  it('회원 메일을 조회해 문의 제목과 함께 보낸다', async () => {
    const { consumer, send } = make(true, 'buyer@example.com');

    await consumer.onQuestionAnswered(envelope, answered);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ email: 'buyer@example.com' }),
        variables: {
          name: '홍길동',
          title: '배송 문의',
          answer: '내일 출고됩니다.\n감사합니다.',
          inquiryUrl: `https://almondyoung.com/kr/mypage/inquiries?questionId=${answered.questionId}`,
        },
      }),
    );
  });

  it('긴 답변은 300자에서 자르고, 답변이 없는 옛 이벤트는 빈 값으로 보낸다', async () => {
    const { consumer, send } = make(true, 'buyer@example.com');

    await consumer.onQuestionAnswered(envelope, { ...answered, answerContent: '가'.repeat(301) });
    await consumer.onQuestionAnswered(envelope, { ...answered, answerContent: undefined });

    expect(send.mock.calls[0][0].variables.answer).toBe(`${'가'.repeat(300)}…`);
    expect(send.mock.calls[1][0].variables.answer).toBe('');
  });

  it('꺼져 있거나 메일을 못 찾으면 보내지 않는다', async () => {
    const off = make(false, 'buyer@example.com');
    await off.consumer.onQuestionAnswered(envelope, answered);
    const noMail = make(true, undefined);
    await noMail.consumer.onQuestionAnswered(envelope, answered);

    expect(off.send).not.toHaveBeenCalled();
    expect(noMail.send).not.toHaveBeenCalled();
  });
});

describe('UgcEventConsumer 재전달 (#1073)', () => {
  it('같은 메시지가 다시 오면 같은 멱등 키로 보낸다 — 디스패처가 두 번째를 버린다', async () => {
    const { consumer, send } = make(true, 'buyer@example.com');
    const redelivered = { ...envelope, messageId: 'msg-1' } as typeof envelope;

    await consumer.onQuestionAnswered(redelivered, answered);
    await consumer.onQuestionAnswered(redelivered, answered);

    const [first, second] = send.mock.calls.map(([dto]) => dto.idempotencyKey);
    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });
});
