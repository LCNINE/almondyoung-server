// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import { withMedusaOrderProjectionLock } from './medusa-order-projection-lock';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('Medusa order projection advisory lock (PostgreSQL integration)', () => {
  it('serializes V1 and V2 read-modify-write work for the same Medusa order across connections', async () => {
    const clientA = postgres(DATABASE_URL as string, { max: 1, prepare: false });
    const clientB = postgres(DATABASE_URL as string, { max: 1, prepare: false });
    const dbServiceA = { db: drizzle(clientA) } as never;
    const dbServiceB = { db: drizzle(clientB) } as never;
    const orderId = `order-lock-${Date.now()}-${Math.random()}`;
    let releaseFirst!: () => void;
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted!: () => void;
    const firstDidStart = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    let secondStarted = false;

    try {
      const v2 = withMedusaOrderProjectionLock(dbServiceA, orderId, async () => {
        firstStarted();
        await firstMayFinish;
        return 'v2';
      });
      await firstDidStart;
      const v1 = withMedusaOrderProjectionLock(dbServiceB, orderId, () => {
        secondStarted = true;
        return Promise.resolve('v1');
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(secondStarted).toBe(false);

      releaseFirst();
      await expect(Promise.all([v2, v1])).resolves.toEqual(['v2', 'v1']);
      expect(secondStarted).toBe(true);
    } finally {
      releaseFirst();
      await Promise.all([clientA.end({ timeout: 5 }), clientB.end({ timeout: 5 })]);
    }
  });

  it('allows different Medusa orders to project concurrently', async () => {
    const clientA = postgres(DATABASE_URL as string, { max: 1, prepare: false });
    const clientB = postgres(DATABASE_URL as string, { max: 1, prepare: false });
    const dbServiceA = { db: drizzle(clientA) } as never;
    const dbServiceB = { db: drizzle(clientB) } as never;
    let releaseFirst!: () => void;
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted!: () => void;
    const firstDidStart = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });

    try {
      const first = withMedusaOrderProjectionLock(dbServiceA, 'order-lock-a', async () => {
        firstStarted();
        await firstMayFinish;
      });
      await firstDidStart;
      await expect(
        withMedusaOrderProjectionLock(dbServiceB, 'order-lock-b', () => Promise.resolve('second')),
      ).resolves.toBe('second');
      releaseFirst();
      await first;
    } finally {
      releaseFirst();
      await Promise.all([clientA.end({ timeout: 5 }), clientB.end({ timeout: 5 })]);
    }
  });
});
