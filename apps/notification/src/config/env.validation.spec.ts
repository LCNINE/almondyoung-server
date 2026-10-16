import { createECDH } from 'crypto';
import { notificationEnvSchema } from './env.validation';

describe('Web Push startup configuration', () => {
  const base = { DATABASE_URL: 'postgres://localhost/notification' };
  const ecdh = createECDH('prime256v1');

  ecdh.setPrivateKey(Buffer.alloc(32, 1));

  const complete = {
    ...base,
    WEB_PUSH_PUBLIC_KEY: ecdh.getPublicKey().toString('base64url'),
    WEB_PUSH_PRIVATE_KEY: ecdh.getPrivateKey().toString('base64url'),
    WEB_PUSH_SUBJECT: 'mailto:admin@example.test',
  };

  it('allows the feature to remain unconfigured', () => {
    expect(notificationEnvSchema.safeParse(base).success).toBe(true);
  });

  it('accepts a valid matching VAPID key pair', () => {
    expect(notificationEnvSchema.safeParse(complete).success).toBe(true);
  });

  it('fails startup for partial or malformed configuration', () => {
    expect(
      notificationEnvSchema.safeParse({ ...base, WEB_PUSH_PUBLIC_KEY: complete.WEB_PUSH_PUBLIC_KEY }).success,
    ).toBe(false);
    expect(notificationEnvSchema.safeParse({ ...complete, WEB_PUSH_PRIVATE_KEY: 'broken' }).success).toBe(false);
    expect(notificationEnvSchema.safeParse({ ...complete, WEB_PUSH_SUBJECT: 'not-a-contact' }).success).toBe(false);
  });

  it('fails startup for keys from different pairs', () => {
    const other = createECDH('prime256v1');

    other.setPrivateKey(Buffer.alloc(32, 2));

    expect(
      notificationEnvSchema.safeParse({ ...complete, WEB_PUSH_PUBLIC_KEY: other.getPublicKey().toString('base64url') })
        .success,
    ).toBe(false);
  });
});
