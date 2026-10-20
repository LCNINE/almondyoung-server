import type { PiiAccessRecord } from '../services/pii-access-recorder';
import { OutboxPiiAccessRecorder } from './outbox-pii-access.recorder';

const entry: PiiAccessRecord = {
  eventId: '0192f3a4-0000-4000-8000-0000000000aa',
  actorUserId: '0192f3a4-0000-7000-8000-000000000002',
  actorLoginId: 'kim',
  claimedIp: '203.0.113.9',
  peerIp: '10.0.0.5',
  forwardedFor: null,
  userAgent: 'Mozilla',
  requestId: 'r',
  sourceService: 'core',
  method: 'GET',
  route: '/sales-orders/:id',
  action: 'view',
  subjects: [{ type: 'sales_order', id: 'so-1' }],
  subjectCount: 1,
  kinds: ['name'],
  queryKeys: [],
  reason: null,
  occurredAt: new Date('2026-10-19T05:00:00.000Z'),
};

describe('OutboxPiiAccessRecorder', () => {
  it('enqueues a PiiAccessed event with the record on the app database', async () => {
    const enqueue = jest.fn().mockResolvedValue(undefined);
    const db = { insert: jest.fn() };
    const recorder = new OutboxPiiAccessRecorder({ enqueue }, { db });
    await recorder.record(entry);
    expect(enqueue).toHaveBeenCalledWith(
      {
        eventType: 'PiiAccessed',
        aggregateId: entry.actorUserId,
        idempotencyKey: entry.eventId,
        payload: { ...entry, occurredAt: '2026-10-19T05:00:00.000Z' },
      },
      db,
    );
  });

  it('lets an enqueue failure reach the interceptor', async () => {
    const recorder = new OutboxPiiAccessRecorder({ enqueue: jest.fn().mockRejectedValue(new Error('db down')) }, { db: { insert: jest.fn() } });
    await expect(recorder.record(entry)).rejects.toThrow('db down');
  });
});
