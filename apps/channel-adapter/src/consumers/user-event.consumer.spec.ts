import { UserEventConsumer } from './user-event.consumer';
import { cafe24MemberMappings, inboxEvents, processedEvents } from '../schema';

function createDbMock(existingProcessedEvents: unknown[] = []) {
  const inserts: Array<{ table: unknown; values: any }> = [];
  const deletes: unknown[] = [];
  const limit = jest.fn().mockResolvedValue(existingProcessedEvents);
  const where = jest.fn(() => ({ limit }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));
  const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
  const insert = jest.fn((table: unknown) => ({
    values: jest.fn((values: any) => {
      inserts.push({ table, values });
      // cafe24MemberMappings upsert 는 체이닝, 나머지는 await
      return Object.assign(Promise.resolve(), { onConflictDoUpdate });
    }),
  }));
  const del = jest.fn((table: unknown) => ({ where: jest.fn(async () => { deletes.push(table); }) }));
  return { db: { select, insert, delete: del }, inserts, deletes };
}

const USER_ID = '3f9a1c2e-1111-4222-8333-444455556666';
const envelope = { messageId: 'msg-1', correlationId: 'corr-1', chainId: 'chain-1' } as any;

describe('UserEventConsumer (#786)', () => {
  describe('UserDeleted', () => {
    it('processed_events 기록 후 inbox 에 MedusaCustomer 행을 넣는다', async () => {
      const dbMock = createDbMock();
      const consumer = new UserEventConsumer({ db: dbMock.db } as any);

      await consumer.onUserDeleted(envelope, { userId: USER_ID });

      expect(dbMock.inserts).toHaveLength(2);
      expect(dbMock.inserts[0].table).toBe(processedEvents);
      expect(dbMock.inserts[0].values).toMatchObject({
        idempotencyKey: 'msg-1',
        source: 'users.events.v1',
        eventType: 'UserDeleted',
        resourceId: USER_ID,
        status: 'PROCESSED',
      });
      expect(dbMock.inserts[1].table).toBe(inboxEvents);
      expect(dbMock.inserts[1].values).toMatchObject({
        eventType: 'UserDeleted',
        aggregateType: 'MedusaCustomer',
        aggregateId: USER_ID,
        partitionKey: USER_ID,
        payload: { userId: USER_ID },
        metadata: { correlationId: 'corr-1', messageId: 'msg-1', chainId: 'chain-1' },
        status: 'pending',
      });
    });

    it('같은 messageId 가 다시 오면 아무것도 넣지 않는다', async () => {
      const dbMock = createDbMock([{ idempotencyKey: 'msg-1' }]);
      const consumer = new UserEventConsumer({ db: dbMock.db } as any);

      await consumer.onUserDeleted(envelope, { userId: USER_ID });

      expect(dbMock.inserts).toHaveLength(0);
    });

    it('messageId 가 없으면 UserDeleted:<userId> 를 멱등키로 쓴다', async () => {
      const dbMock = createDbMock();
      const consumer = new UserEventConsumer({ db: dbMock.db } as any);

      await consumer.onUserDeleted({ ...envelope, messageId: undefined }, { userId: USER_ID });

      expect(dbMock.inserts[0].values.idempotencyKey).toBe(`UserDeleted:${USER_ID}`);
    });
  });

  describe('UserUpdated', () => {
    it('email 이 있으면 inbox 에 { userId, email } 만 싣는다', async () => {
      const dbMock = createDbMock();
      const consumer = new UserEventConsumer({ db: dbMock.db } as any);

      await consumer.onUserUpdated(envelope, { userId: USER_ID, email: 'new@example.com', nickname: '닉' });

      expect(dbMock.inserts).toHaveLength(2);
      expect(dbMock.inserts[1].values).toMatchObject({
        eventType: 'UserUpdated',
        aggregateType: 'MedusaCustomer',
        aggregateId: USER_ID,
        payload: { userId: USER_ID, email: 'new@example.com' },
      });
      expect(dbMock.inserts[1].values.payload).not.toHaveProperty('nickname');
    });

    it('email 이 없는 프로필 수정은 processed 만 기록하고 inbox 에 넣지 않는다', async () => {
      const dbMock = createDbMock();
      const consumer = new UserEventConsumer({ db: dbMock.db } as any);

      await consumer.onUserUpdated(envelope, { userId: USER_ID, nickname: '닉' });

      expect(dbMock.inserts).toHaveLength(1);
      expect(dbMock.inserts[0].table).toBe(processedEvents);
    });
  });

  describe('기존 Cafe24 핸들러는 헬퍼를 지나도 같은 행을 만든다', () => {
    it('Cafe24Linked: processed + inbox(FirebaseMembership) + 매핑 upsert', async () => {
      const dbMock = createDbMock();
      const consumer = new UserEventConsumer({ db: dbMock.db } as any);

      await consumer.onCafe24Linked(envelope, {
        userId: USER_ID,
        cafe24MemberId: 'c24-1',
        mallId: 'lcnine',
        email: 'a@example.com',
        linkedAt: '2026-09-07T00:00:00.000Z',
      });

      expect(dbMock.inserts.map((i) => i.table)).toEqual([processedEvents, inboxEvents, cafe24MemberMappings]);
      expect(dbMock.inserts[1].values).toMatchObject({
        eventType: 'Cafe24Linked',
        aggregateType: 'FirebaseMembership',
        aggregateId: 'c24-1',
        partitionKey: 'c24-1',
      });
    });

    it('Cafe24Linked: messageId 가 없으면 Cafe24Linked:<userId>:<cafe24MemberId> 를 멱등키로 쓴다', async () => {
      const dbMock = createDbMock();
      const consumer = new UserEventConsumer({ db: dbMock.db } as any);

      await consumer.onCafe24Linked(
        { ...envelope, messageId: undefined },
        {
          userId: USER_ID,
          cafe24MemberId: 'c24-1',
          mallId: 'lcnine',
          email: 'a@example.com',
          linkedAt: '2026-09-07T00:00:00.000Z',
        },
      );

      expect(dbMock.inserts[0].values.idempotencyKey).toBe(`Cafe24Linked:${USER_ID}:c24-1`);
    });

    it('Cafe24Unlinked: processed + inbox + 매핑 delete', async () => {
      const dbMock = createDbMock();
      const consumer = new UserEventConsumer({ db: dbMock.db } as any);

      await consumer.onCafe24Unlinked(envelope, {
        userId: USER_ID,
        cafe24MemberId: 'c24-1',
        mallId: 'lcnine',
        email: 'a@example.com',
        unlinkedAt: '2026-09-07T00:00:00.000Z',
      });

      expect(dbMock.inserts.map((i) => i.table)).toEqual([processedEvents, inboxEvents]);
      expect(dbMock.deletes).toEqual([cafe24MemberMappings]);
    });

    it('Cafe24Unlinked: messageId 가 없으면 Cafe24Unlinked:<userId>:<cafe24MemberId> 를 멱등키로 쓴다', async () => {
      const dbMock = createDbMock();
      const consumer = new UserEventConsumer({ db: dbMock.db } as any);

      await consumer.onCafe24Unlinked(
        { ...envelope, messageId: undefined },
        {
          userId: USER_ID,
          cafe24MemberId: 'c24-1',
          mallId: 'lcnine',
          email: 'a@example.com',
          unlinkedAt: '2026-09-07T00:00:00.000Z',
        },
      );

      expect(dbMock.inserts[0].values.idempotencyKey).toBe(`Cafe24Unlinked:${USER_ID}:c24-1`);
    });
  });
});
