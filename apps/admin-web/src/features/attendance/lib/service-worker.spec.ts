import { readFileSync } from 'fs';
import { runInNewContext } from 'vm';

function worker(responses: { status: number; data: unknown }[]) {
  const listeners: Record<string, (event: any) => void> = {};
  const showNotification = jest.fn().mockResolvedValue(undefined);
  const fetch = jest.fn().mockImplementation(async () => {
    const response = responses.shift()!;

    return {
      ok: response.status === 200,
      status: response.status,
      json: async () => response.data,
    };
  });
  const self = {
    addEventListener: (name: string, callback: (event: any) => void) => {
      listeners[name] = callback;
    },
    registration: { showNotification },
    navigator: {},
    clients: {
      claim: jest.fn(),
      matchAll: jest.fn().mockResolvedValue([]),
      openWindow: jest.fn(),
    },
    skipWaiting: jest.fn(),
    location: { origin: 'https://admin.example.test' },
  };

  runInNewContext(
    readFileSync('apps/admin-web/public/attendance/sw.js', 'utf8'),
    { self, fetch, URL }
  );

  async function push(userId: string) {
    let work: Promise<void>;

    listeners.push({
      data: {
        json: () => ({ userId, title: '출결 알림', url: '/attendance' }),
      },
      waitUntil: (promise: Promise<void>) => {
        work = promise;
      },
    });

    await work!;
  }

  return { push, showNotification, fetch };
}

describe('attendance service worker account binding', () => {
  it('displays only notifications for the current account', async () => {
    const same = worker([{ status: 200, data: { userId: 'owner' } }]);

    await same.push('owner');

    expect(same.showNotification).toHaveBeenCalledTimes(1);

    const other = worker([{ status: 200, data: { userId: 'other' } }]);

    await other.push('owner');

    expect(other.showNotification).not.toHaveBeenCalled();
  });

  it('refreshes an expired access token before rechecking the account', async () => {
    const expired = worker([
      { status: 401, data: {} },
      { status: 200, data: {} },
      { status: 200, data: { userId: 'owner' } },
    ]);

    await expired.push('owner');

    expect(expired.showNotification).toHaveBeenCalledTimes(1);

    expect(expired.fetch).toHaveBeenCalledWith(
      '/api/auth/refresh',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
