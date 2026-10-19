import type { PiiAccessRecord } from '@app/authorization';
import { HttpPiiAccessRecorder } from './http-pii-access.recorder';

const entry: PiiAccessRecord = {
  eventId: '0192f3a4-0000-4000-8000-0000000000dd',
  actorUserId: '0192f3a4-0000-7000-8000-000000000005',
  actorLoginId: 'cs1',
  claimedIp: null,
  peerIp: '10.0.0.7',
  forwardedFor: null,
  userAgent: null,
  requestId: 'req-3',
  sourceService: 'notification',
  method: 'GET',
  route: '/notifications/:id',
  action: 'view',
  subjects: [{ type: 'notification', id: 'n-1' }],
  subjectCount: 1,
  kinds: ['phone'],
  queryKeys: [],
  reason: null,
  occurredAt: new Date('2026-10-19T05:00:00.000Z'),
};

const config = (values: Record<string, string | undefined>) => ({ get: (key: string) => values[key] });

describe('HttpPiiAccessRecorder', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('posts the record to the user-service internal path with the internal key', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 204 }));
    global.fetch = fetchMock;
    const recorder = new HttpPiiAccessRecorder(config({ USER_SERVICE_URL: 'http://user', USER_SERVICE_INTERNAL_KEY: 'k' }));
    await recorder.record(entry);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://user/internal/iam/pii-access-logs');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ authorization: 'Bearer k', 'content-type': 'application/json' });
    expect(JSON.parse(init.body)).toMatchObject({ eventId: entry.eventId, occurredAt: '2026-10-19T05:00:00.000Z' });
  });

  it('throws when the internal call fails', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('no', { status: 500 }));
    const recorder = new HttpPiiAccessRecorder(config({ USER_SERVICE_URL: 'http://user', USER_SERVICE_INTERNAL_KEY: 'k' }));
    await expect(recorder.record(entry)).rejects.toThrow('500');
  });

  it('throws when the user-service address or key is not configured', async () => {
    const recorder = new HttpPiiAccessRecorder(config({}));
    await expect(recorder.record(entry)).rejects.toThrow('not configured');
  });
});
