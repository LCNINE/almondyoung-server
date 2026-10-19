import { IAM_STREAM } from '../iam.stream';
import { streamForTopic } from '../registry';

const VALID = {
  eventId: '0192f3a4-5b6c-7d8e-9f00-112233445566',
  actorUserId: '0192f3a4-5b6c-7d8e-9f00-aabbccddeeff',
  actorLoginId: 'kim',
  claimedIp: '203.0.113.7',
  peerIp: '10.0.0.5',
  forwardedFor: null,
  userAgent: 'Mozilla/5.0',
  requestId: 'req-1',
  sourceService: 'core',
  method: 'GET',
  route: '/sales-orders/:id',
  action: 'view',
  subjects: [{ type: 'sales_order', id: 'so-1' }],
  subjectCount: 1,
  kinds: ['name', 'phone'],
  queryKeys: [],
  reason: null,
  occurredAt: '2026-10-19T05:00:00.000Z',
};

describe('IAM_STREAM', () => {
  const schema = IAM_STREAM.events.PiiAccessed.schema!;

  it('registers the iam stream', () => {
    expect(IAM_STREAM.topic.topic).toBe('iam.events.v1');
    expect(streamForTopic('iam.events.v1')).toBe(IAM_STREAM);
  });

  it('accepts a minimal view record', () => {
    expect(schema.safeParse(VALID).success).toBe(true);
  });

  it('rejects a PiiAccessed payload carrying more than 1000 subjects', () => {
    const subjects = Array.from({ length: 1001 }, (_, i) => ({ type: 'user', id: `u${i}` }));
    expect(schema.safeParse({ ...VALID, subjects, subjectCount: 1001 }).success).toBe(false);
  });

  it('requires a reason for export', () => {
    expect(schema.safeParse({ ...VALID, action: 'export' }).success).toBe(false);
    expect(schema.safeParse({ ...VALID, action: 'export', reason: '월말 정산 대조' }).success).toBe(true);
  });

  it('rejects a subject count smaller than the subjects carried', () => {
    expect(schema.safeParse({ ...VALID, subjectCount: 0 }).success).toBe(false);
  });

  it('partitions by actor', () => {
    expect(IAM_STREAM.partitionKey?.(VALID)).toBe(VALID.actorUserId);
  });
});
