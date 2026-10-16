import { DbService } from '@app/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createECDH, randomBytes } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as webpush from 'web-push';
import {
  type NotificationSchema,
  notificationTables,
  webPushDeliveries,
  webPushSubscriptions,
} from '../../../database/schemas/notification-schema';
import { BrowserSubscriptionDto, SendBrowserPushDto } from '../dto/web-push.dto';
import { WebPushService } from './web-push.service';

const run = process.env.REQUIRE_ATTENDANCE_DB === '1' ? describe : describe.skip;
const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const vapidVariables = ['WEB_PUSH_PUBLIC_KEY', 'WEB_PUSH_PRIVATE_KEY', 'WEB_PUSH_SUBJECT'] as const;

run('WebPushService PostgreSQL delivery and subscription ownership', () => {
  let container: StartedPostgreSqlContainer;
  let database: DbService<NotificationSchema>;
  let service: WebPushService;
  let sendNotification: jest.SpyInstance<
    ReturnType<typeof webpush.sendNotification>,
    Parameters<typeof webpush.sendNotification>
  >;

  const originalEnvironment = Object.fromEntries(vapidVariables.map((name) => [name, process.env[name]]));
  const vapid = createECDH('prime256v1');

  vapid.generateKeys();

  const accepted = { statusCode: 201, body: '', headers: {} };

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();

    database = new DbService({ connectionString: container.getConnectionUri() }, notificationTables);

    // Only the newly created container URI is used, even if DATABASE_URL is present.
    const migrationsDirectory = join(__dirname, '../../../database/drizzle');
    const journal = JSON.parse(readFileSync(join(migrationsDirectory, 'meta/_journal.json'), 'utf8')) as {
      entries: { tag: string }[];
    };

    for (const entry of journal.entries) {
      const migration = readFileSync(join(migrationsDirectory, `${entry.tag}.sql`), 'utf8');

      for (const statement of migration.split('--> statement-breakpoint')) {
        if (statement.trim()) {
          await database.db.execute(sql.raw(statement));
        }
      }
    }

    service = new WebPushService(database);
  }, 120_000);

  beforeEach(async () => {
    process.env.WEB_PUSH_PUBLIC_KEY = vapid.getPublicKey().toString('base64url');
    process.env.WEB_PUSH_PRIVATE_KEY = vapid.getPrivateKey().toString('base64url');
    process.env.WEB_PUSH_SUBJECT = 'mailto:attendance@example.test';

    await database.db.execute(sql`TRUNCATE web_push_deliveries, web_push_subscriptions`);

    sendNotification = jest.spyOn(webpush, 'sendNotification').mockResolvedValue(accepted);
  });

  afterEach(() => {
    sendNotification?.mockRestore();

    for (const name of vapidVariables) {
      const original = originalEnvironment[name];

      if (original === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = original;
      }
    }
  });

  afterAll(async () => {
    await database?.onApplicationShutdown();

    await container?.stop();
  });

  function subscription(token: string): BrowserSubscriptionDto {
    const encryption = createECDH('prime256v1');

    encryption.generateKeys();

    return {
      endpoint: `https://fcm.googleapis.com/fcm/send/${token}`,
      keys: {
        auth: randomBytes(16).toString('base64url'),
        p256dh: encryption.getPublicKey().toString('base64url'),
      },
    };
  }

  function message(overrides: Partial<SendBrowserPushDto> = {}): SendBrowserPushDto {
    return {
      userId: owner,
      key: 'attendance-reminder-2026-10-16',
      title: '출근 확인',
      body: '오늘 출근 기록을 확인해 주세요.',
      url: '/attendance',
      ...overrides,
    };
  }

  it.each(vapidVariables)('rejects registration and sending with 503 when %s is missing', async (name) => {
    await service.register(owner, subscription('existing-device'));

    delete process.env[name];

    expect(service.config()).toEqual({ configured: false, publicKey: null });

    await expect(service.register(owner, subscription('new-device'))).rejects.toMatchObject({ status: 503 });
    await expect(service.send(message())).rejects.toMatchObject({ status: 503 });

    expect(await database.db.select().from(webPushSubscriptions)).toHaveLength(1);
    expect(await database.db.select().from(webPushDeliveries)).toHaveLength(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('retains endpoint ownership after removal and allows the owner to reconnect', async () => {
    const input = subscription('owned-device');

    await service.register(owner, input);

    await expect(service.register(other, input)).rejects.toMatchObject({ status: 409 });

    await service.remove(other, input.endpoint);

    const [active] = await database.db.select().from(webPushSubscriptions);

    expect(active).toMatchObject({ userId: owner, active: true });

    await service.remove(owner, input.endpoint);

    await expect(service.register(other, input)).rejects.toMatchObject({ status: 409 });

    const [removed] = await database.db.select().from(webPushSubscriptions);

    expect(removed).toMatchObject({ id: active.id, userId: owner, active: false });

    const replacement = subscription('owned-device');

    await service.register(owner, replacement);

    const rows = await database.db.select().from(webPushSubscriptions);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: active.id, userId: owner, active: true, keys: replacement.keys });
  });

  it.each([404, 410])('disables a subscription and records an expired delivery after HTTP %s', async (statusCode) => {
    await service.register(owner, subscription('expired-device'));

    sendNotification.mockRejectedValueOnce(Object.assign(new Error('Subscription expired'), { statusCode }));

    await expect(service.send(message())).resolves.toEqual({ success: true });

    const [stored] = await database.db.select().from(webPushSubscriptions);
    const [delivery] = await database.db.select().from(webPushDeliveries);

    expect(stored.active).toBe(false);
    expect(delivery).toMatchObject({ subscriptionId: stored.id, status: 'expired', sentAt: null });

    await service.send(message());
    await service.send(message({ key: 'another-reminder' }));

    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(await database.db.select().from(webPushDeliveries)).toHaveLength(1);
  });

  it('sends the same key only once when independent requests arrive concurrently', async () => {
    const input = subscription('concurrent-device');

    await service.register(owner, input);

    const results = await Promise.allSettled(Array.from({ length: 6 }, () => service.send(message())));

    expect(results).toEqual(Array.from({ length: 6 }, () => ({ status: 'fulfilled', value: { success: true } })));

    const deliveries = await database.db.select().from(webPushDeliveries);

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ key: 'attendance-reminder-2026-10-16', status: 'sent' });
    expect(deliveries[0].sentAt).toBeInstanceOf(Date);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledWith(
      { endpoint: input.endpoint, keys: input.keys },
      expect.any(String),
      expect.objectContaining({ TTL: 300, timeout: 10000 }),
    );

    const payload: unknown = JSON.parse(sendNotification.mock.calls[0][1] as string);

    expect(payload).toMatchObject({
      title: '출근 확인',
      body: '오늘 출근 기록을 확인해 주세요.',
      url: '/attendance',
      userId: owner,
    });
  });

  it('leaves transient failures pending and retries them without resending completed subscriptions', async () => {
    await service.register(owner, subscription('first-device'));
    await service.register(owner, subscription('second-device'));

    const unavailable = Object.assign(new Error('Push provider unavailable'), { statusCode: 503 });

    sendNotification.mockResolvedValueOnce(accepted).mockRejectedValueOnce(unavailable);

    await expect(service.send(message())).rejects.toBe(unavailable);

    const beforeRetry = await database.db.select().from(webPushDeliveries);
    const sent = beforeRetry.find((row) => row.status === 'sent');
    const pending = beforeRetry.find((row) => row.status === 'pending');

    expect(beforeRetry).toHaveLength(2);
    expect(sent?.sentAt).toBeInstanceOf(Date);
    expect(pending).toMatchObject({ status: 'pending', sentAt: null });

    const failedEndpoint = sendNotification.mock.calls[1][0].endpoint;

    await expect(service.send(message())).resolves.toEqual({ success: true });

    const afterRetry = await database.db.select().from(webPushDeliveries);

    expect(afterRetry).toHaveLength(2);
    expect(afterRetry.every((row) => row.status === 'sent' && row.sentAt instanceof Date)).toBe(true);
    expect(afterRetry.find((row) => row.id === sent?.id)?.sentAt).toEqual(sent?.sentAt);
    expect(sendNotification).toHaveBeenCalledTimes(3);
    expect(sendNotification.mock.calls[2][0].endpoint).toBe(failedEndpoint);

    const subscriptions = await database.db.select().from(webPushSubscriptions);

    expect(subscriptions.every((row) => row.active)).toBe(true);
  });

  it('handles simultaneous expired responses for separate messages without a lock upgrade deadlock', async () => {
    await service.register(owner, subscription('expired-concurrent-device'));

    let releaseFirst: () => void;
    const firstSending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let started = 0;

    sendNotification.mockImplementation(async () => {
      started++;

      if (started === 1) {
        // Let the second transaction reach its network call while the first holds its row lock.
        // The timeout also permits a correctly serialized second transaction to continue.
        await Promise.race([firstSending, new Promise<void>((resolve) => setTimeout(resolve, 100))]);
      } else {
        releaseFirst();
      }

      throw Object.assign(new Error('Subscription expired'), { statusCode: 410 });
    });

    const results = await Promise.allSettled([
      service.send(message({ key: 'first-expired-message' })),
      service.send(message({ key: 'second-expired-message' })),
    ]);

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);

    const [stored] = await database.db.select().from(webPushSubscriptions);

    expect(stored.active).toBe(false);
  });

  it.each([
    'https://evil.example/attendance',
    '//evil.example/attendance',
    '/attendance?next=https://evil.example',
    '/admin',
  ])('rejects unsafe notification navigation %s without creating a delivery', async (url) => {
    await service.register(owner, subscription('safe-device'));

    await expect(service.send(message({ url }))).rejects.toMatchObject({ status: 400 });

    expect(await database.db.select().from(webPushDeliveries)).toHaveLength(0);
    expect(sendNotification).not.toHaveBeenCalled();

    const [stored] = await database.db
      .select()
      .from(webPushSubscriptions)
      .where(eq(webPushSubscriptions.userId, owner));

    expect(stored.active).toBe(true);
  });
});
