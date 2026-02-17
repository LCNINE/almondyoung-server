import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { DbModule, DbService } from '@app/db';
import { inArray } from 'drizzle-orm';
import * as dotenv from 'dotenv';
import * as path from 'node:path';
import {
  manualCancelQueueItems,
  paymentIntents,
  paymentLegs,
  providerWebhookReceipts,
  walletSchema,
  WalletSchema,
} from '../schema';

dotenv.config({ path: path.resolve(process.cwd(), 'apps/wallet/.env.test') });
dotenv.config({ path: path.resolve(process.cwd(), 'apps/wallet/.env') });

const DATABASE_URL = process.env.WALLET_TEST_DATABASE_URL;
const RUN_WALLET_DB_TESTS = process.env.RUN_WALLET_DB_TESTS === '1';

if (RUN_WALLET_DB_TESTS && !DATABASE_URL) {
  throw new Error(
    'WALLET_TEST_DATABASE_URL is required when RUN_WALLET_DB_TESTS=1',
  );
}

const describeWithDatabase =
  DATABASE_URL && RUN_WALLET_DB_TESTS ? describe : describe.skip;

jest.setTimeout(30_000);

describeWithDatabase('wallet schema constraints (integration)', () => {
  let module: TestingModule;
  let dbService: DbService<WalletSchema>;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        DbModule.forRoot({
          config: {
            connectionString: DATABASE_URL!,
          },
          schema: walletSchema,
        }),
      ],
    }).compile();

    dbService = module.get<DbService<WalletSchema>>(DbService);
  });

  afterAll(async () => {
    await module.close();
  });

  it('enforces reference-blocking partial unique index', async () => {
    const insertedIntentIds: string[] = [];
    const referenceId = `test-ref-${randomUUID()}`;

    try {
      const [blockingIntent] = await dbService.db
        .insert(paymentIntents)
        .values({
          referenceType: 'STORE_ORDER',
          referenceId,
          customerId: `customer-${randomUUID()}`,
          currency: 'KRW',
          payableAmount: 10000,
          status: 'PENDING',
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        })
        .returning({ id: paymentIntents.id });
      insertedIntentIds.push(blockingIntent.id);

      await expectUniqueViolation(
        () =>
          dbService.db.insert(paymentIntents).values({
            referenceType: 'STORE_ORDER',
            referenceId,
            customerId: `customer-${randomUUID()}`,
            currency: 'KRW',
            payableAmount: 10000,
            status: 'IN_PROGRESS',
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
          }),
        'uq_payment_intents_reference_blocking',
      );

      const [nonBlockingIntent] = await dbService.db
        .insert(paymentIntents)
        .values({
          referenceType: 'STORE_ORDER',
          referenceId,
          customerId: `customer-${randomUUID()}`,
          currency: 'KRW',
          payableAmount: 10000,
          status: 'SUCCEEDED',
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        })
        .returning({ id: paymentIntents.id });
      insertedIntentIds.push(nonBlockingIntent.id);
    } finally {
      if (insertedIntentIds.length > 0) {
        await dbService.db
          .delete(paymentIntents)
          .where(inArray(paymentIntents.id, insertedIntentIds));
      }
    }
  });

  it('enforces open-queue partial unique index for intent+leg', async () => {
    const insertedIntentIds: string[] = [];
    const insertedLegIds: string[] = [];
    const insertedQueueItemIds: string[] = [];

    try {
      const [intent] = await dbService.db
        .insert(paymentIntents)
        .values({
          referenceType: 'STORE_ORDER',
          referenceId: `test-ref-${randomUUID()}`,
          customerId: `customer-${randomUUID()}`,
          currency: 'KRW',
          payableAmount: 20000,
          status: 'PENDING',
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        })
        .returning({ id: paymentIntents.id });
      insertedIntentIds.push(intent.id);

      const [leg] = await dbService.db
        .insert(paymentLegs)
        .values({
          intentId: intent.id,
          providerType: 'TOSS',
          amount: 20000,
          status: 'READY',
          sequenceNo: 1,
        })
        .returning({ id: paymentLegs.id });
      insertedLegIds.push(leg.id);

      const [openItem] = await dbService.db
        .insert(manualCancelQueueItems)
        .values({
          intentId: intent.id,
          legId: leg.id,
          actionType: 'CANCEL',
          status: 'QUEUED',
          reasonCode: 'TEST_REASON',
        })
        .returning({ id: manualCancelQueueItems.id });
      insertedQueueItemIds.push(openItem.id);

      await expectUniqueViolation(
        () =>
          dbService.db.insert(manualCancelQueueItems).values({
            intentId: intent.id,
            legId: leg.id,
            actionType: 'CANCEL',
            status: 'PROCESSING',
            reasonCode: 'TEST_REASON',
          }),
        'uq_manual_cancel_queue_open_intent_leg',
      );

      const [closedItem] = await dbService.db
        .insert(manualCancelQueueItems)
        .values({
          intentId: intent.id,
          legId: leg.id,
          actionType: 'CANCEL',
          status: 'CLOSED',
          reasonCode: 'TEST_REASON',
        })
        .returning({ id: manualCancelQueueItems.id });
      insertedQueueItemIds.push(closedItem.id);
    } finally {
      if (insertedQueueItemIds.length > 0) {
        await dbService.db
          .delete(manualCancelQueueItems)
          .where(inArray(manualCancelQueueItems.id, insertedQueueItemIds));
      }
      if (insertedLegIds.length > 0) {
        await dbService.db.delete(paymentLegs).where(inArray(paymentLegs.id, insertedLegIds));
      }
      if (insertedIntentIds.length > 0) {
        await dbService.db
          .delete(paymentIntents)
          .where(inArray(paymentIntents.id, insertedIntentIds));
      }
    }
  });

  it('enforces provider webhook receipt uniqueness by provider+event', async () => {
    const insertedReceiptIds: string[] = [];
    const providerEventId = `provider-event-${randomUUID()}`;

    try {
      const [firstReceipt] = await dbService.db
        .insert(providerWebhookReceipts)
        .values({
          providerType: 'TOSS',
          providerEventId,
          status: 'RECEIVED',
          receivedAt: new Date(),
        })
        .returning({ id: providerWebhookReceipts.id });
      insertedReceiptIds.push(firstReceipt.id);

      await expectUniqueViolation(
        () =>
          dbService.db.insert(providerWebhookReceipts).values({
            providerType: 'TOSS',
            providerEventId,
            status: 'RECEIVED',
            receivedAt: new Date(),
          }),
        'uq_provider_webhook_receipts_provider_event',
      );

      const [differentProviderReceipt] = await dbService.db
        .insert(providerWebhookReceipts)
        .values({
          providerType: 'HMS_CARD',
          providerEventId,
          status: 'RECEIVED',
          receivedAt: new Date(),
        })
        .returning({ id: providerWebhookReceipts.id });
      insertedReceiptIds.push(differentProviderReceipt.id);
    } finally {
      if (insertedReceiptIds.length > 0) {
        await dbService.db
          .delete(providerWebhookReceipts)
          .where(inArray(providerWebhookReceipts.id, insertedReceiptIds));
      }
    }
  });
});

async function expectUniqueViolation(
  operation: () => Promise<unknown>,
  constraintName: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    const pgError = findPgError(error);
    const isUniqueViolation =
      pgError.code === '23505' ||
      (pgError.message ?? '').includes('duplicate key value violates unique constraint');

    expect(isUniqueViolation).toBe(true);

    if (pgError.constraint) {
      expect(pgError.constraint).toBe(constraintName);
      return;
    }

    expect(pgError.message ?? '').toContain(constraintName);
    return;
  }

  throw new Error(`Expected unique violation for ${constraintName}`);
}

function findPgError(error: unknown): {
  code?: string;
  constraint?: string;
  message?: string;
} {
  let current = error as
    | {
        code?: string;
        constraint?: string;
        message?: string;
        cause?: unknown;
        originalError?: unknown;
      }
    | undefined;
  const visited = new Set<unknown>();

  while (current && !visited.has(current)) {
    visited.add(current);

    if (current.code || current.constraint) {
      return current;
    }

    const next = (current.cause ?? current.originalError) as
      | {
          code?: string;
          constraint?: string;
          message?: string;
          cause?: unknown;
          originalError?: unknown;
        }
      | undefined;
    current = next;
  }

  return (error as { code?: string; constraint?: string; message?: string }) ?? {};
}
