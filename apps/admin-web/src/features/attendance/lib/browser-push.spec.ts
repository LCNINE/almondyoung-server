import { client } from '@/lib/api/client';
import { enableAttendancePush, sendAttendanceTestPush } from './browser-push';

jest.mock('@/lib/api/client', () => ({
  client: { get: jest.fn(), post: jest.fn() },
}));

describe('attendance push on the current device', () => {
  const globals = ['navigator', 'window', 'Notification'] as const;
  const original = new Map(
    globals.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ])
  );
  const endpoint = 'https://web.push.apple.com/current-device';

  function setGlobal(name: string, value: unknown) {
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }

  beforeEach(() => {
    setGlobal('window', { PushManager: class {} });
    setGlobal('Notification', {
      permission: 'granted',
      requestPermission: jest.fn().mockResolvedValue('granted'),
    });
    setGlobal('navigator', {
      serviceWorker: {
        getRegistration: async () => ({
          pushManager: { getSubscription: async () => ({ endpoint }) },
        }),
      },
    });
    jest.mocked(client.post).mockResolvedValue({ data: { success: true } });
  });

  afterEach(() => {
    for (const name of globals) {
      const descriptor = original.get(name);

      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, name);
      }
    }

    jest.resetAllMocks();
  });

  it('requests permission before waiting for network configuration to retain the iPhone tap gesture', async () => {
    const calls: string[] = [];

    setGlobal('Notification', {
      permission: 'default',
      requestPermission: async () => {
        calls.push('permission');

        return 'denied';
      },
    });
    jest.mocked(client.get).mockImplementation(async () => {
      calls.push('network');

      return { data: { configured: true, publicKey: 'AQ' } };
    });

    await expect(enableAttendancePush()).rejects.toThrow('알림을 허용');
    expect(calls).toEqual(['permission']);
  });

  it('sends only the local subscription endpoint to the authenticated test API', async () => {
    await sendAttendanceTestPush();

    expect(client.post).toHaveBeenCalledWith(
      expect.stringMatching(/\/web-push\/test$/),
      { endpoint }
    );
  });

  it('requires notification permission before attempting a test', async () => {
    setGlobal('Notification', { permission: 'denied' });

    await expect(sendAttendanceTestPush()).rejects.toThrow('알림을 허용');
    expect(client.post).not.toHaveBeenCalled();
  });

  it('asks to connect first when this device has no subscription', async () => {
    setGlobal('navigator', {
      serviceWorker: { getRegistration: async () => undefined },
    });

    await expect(sendAttendanceTestPush()).rejects.toThrow('알림 연결하기');
    expect(client.post).not.toHaveBeenCalled();
  });

  it('propagates a server delivery failure so the caller cannot display success', async () => {
    const failure = new Error('알림 연결이 만료됐어요.');

    jest.mocked(client.post).mockRejectedValueOnce(failure);

    await expect(sendAttendanceTestPush()).rejects.toBe(failure);
  });
});
