import { ValidationPipe } from '@nestjs/common';
import { BrowserSubscriptionDto } from './dto/web-push.dto';
import { client } from '@/lib/api/client';
import { enableAttendancePush } from '../../../admin-web/src/features/attendance/lib/browser-push';

jest.mock('@/lib/api/client', () => ({ client: { get: jest.fn(), post: jest.fn() } }));

describe('browser push registration', () => {
  it('sends a standard browser subscription through the strict API validation', async () => {
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const keys = { auth: 'test-auth', p256dh: 'test-key' };
    const subscription = {
      toJSON: () => ({ endpoint: 'https://web.push.apple.com/token', expirationTime: null, keys }),
    };
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        serviceWorker: {
          register: async () => ({ active: {}, pushManager: { getSubscription: async () => subscription } }),
        },
      },
    });

    Object.assign(globalThis, {
      window: { PushManager: class {} },
      Notification: { requestPermission: async () => 'granted' },
    });

    jest.mocked(client.get).mockResolvedValue({ data: { configured: true, publicKey: 'AQ' } });
    jest.mocked(client.post).mockImplementation(async (_url, body) => {
      const accepted = await pipe.transform(body, { type: 'body', metatype: BrowserSubscriptionDto });

      return { data: accepted } as never;
    });

    try {
      await expect(enableAttendancePush()).resolves.toBeUndefined();
    } finally {
      if (originalNavigator) {
        Object.defineProperty(globalThis, 'navigator', originalNavigator);
      } else {
        Reflect.deleteProperty(globalThis, 'navigator');
      }

      Reflect.deleteProperty(globalThis, 'window');
      Reflect.deleteProperty(globalThis, 'Notification');
      jest.resetAllMocks();
    }
  });
});
