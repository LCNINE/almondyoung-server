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
        variables: { name: '홍길동', title: '배송 문의' },
      }),
    );
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
