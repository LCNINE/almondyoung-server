import { ValidationPipe } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DbService } from '@app/db';
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import * as request from 'supertest';
import { IntentsController } from './intents.controller';
import { IntentsService } from './intents.service';
import { IntentCreationService } from './application/intent-creation.service';
import { LegExecutionService } from './application/leg-execution.service';
import { IntentTerminationService } from './application/intent-termination.service';
import { RefundOrchestrationService } from './application/refund-orchestration.service';
import { AttemptService } from './support/attempt.service';
import { ManualActionQueueService } from './support/manual-action-queue.service';
import { ProviderRegistry } from '../providers/provider.registry';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';
import { HttpIdempotencyInterceptor } from '../domain/idempotency/http-idempotency.interceptor';
import {
  IDEMPOTENCY_REPOSITORY,
  IdempotencyTx,
  IdempotencyRepository,
} from '../domain/idempotency/idempotency.repository';
import { IdempotencyService } from '../domain/idempotency/idempotency.service';
import {
  IdempotencyKeyRecord,
  NewIdempotencyKeyRecord,
  UpdateIdempotencyKeyRecord,
} from '../domain/idempotency/idempotency.schema';

describe('Intents HMAC verification (integration)', () => {
  let app: NestFastifyApplication;
  let module: TestingModule;
  let db: {
    select: jest.Mock;
    transaction: jest.Mock;
  };

  beforeEach(async () => {
    process.env.WALLET_HMAC_SHARED_SECRET = 'wallet-hmac-test-secret';

    db = {
      select: jest.fn().mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      })),
      transaction: jest.fn(),
    };

    module = await Test.createTestingModule({
      controllers: [IntentsController],
      providers: [
        IntentsService,
        IntentCreationService,
        LegExecutionService,
        IntentTerminationService,
        RefundOrchestrationService,
        AttemptService,
        ManualActionQueueService,
        IdempotencyService,
        {
          provide: DbService,
          useValue: {
            db,
          },
        },
        {
          provide: ProviderRegistry,
          useValue: {
            assertCapability: jest.fn(),
          },
        },
        {
          provide: StateTransitionService,
          useValue: {
            transitionIntent: jest.fn(),
            transitionLeg: jest.fn(),
            transitionAttempt: jest.fn(),
          },
        },
        {
          provide: IDEMPOTENCY_REPOSITORY,
          useClass: InMemoryIdempotencyRepository,
        },
        {
          provide: APP_INTERCEPTOR,
          useClass: HttpIdempotencyInterceptor,
        },
      ],
    }).compile();

    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    delete process.env.WALLET_HMAC_SHARED_SECRET;
    await app.close();
    await module.close();
  });

  it('blocks invalid signature before DB read/write', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/intents')
      .set('Idempotency-Key', 'idem-hmac-invalid-v1')
      .send({
        referenceType: 'STORE_ORDER',
        referenceId: 'order-1',
        userId: 'customer-1',
        currency: 'KRW',
        payableAmount: 10000,
        snapshotPayload: {
          schemaVersion: 'INTENT_SNAPSHOT_V1',
          items: [
            {
              lineId: 'line-1',
              name: 'Order item',
              unitPrice: 10000,
              quantity: 1,
              type: 'PRODUCT',
              id: 'order-1',
              discounts: [],
            },
          ],
          orderDiscounts: [],
        },
        signature: 'dummy-signature',
        signatureVersion: 'v2',
        signedAt: '2026-02-17T00:00:00.000Z',
      })
      .expect(400);

    expect(response.body.error).toBe('SIGNATURE_VERSION_UNSUPPORTED');
    expect(db.select).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });
});

class InMemoryIdempotencyRepository implements IdempotencyRepository {
  private readonly store = new Map<string, IdempotencyKeyRecord>();

  async runInTransaction<T>(callback: (tx: IdempotencyTx) => Promise<T>): Promise<T> {
    return callback({} as IdempotencyTx);
  }

  async findByIdForUpdate(
    _tx: IdempotencyTx,
    recordId: string,
  ): Promise<IdempotencyKeyRecord | null> {
    return this.store.get(recordId) ?? null;
  }

  async insert(_tx: IdempotencyTx, record: NewIdempotencyKeyRecord): Promise<void> {
    if (this.store.has(record.id)) {
      const error = new Error('duplicate key value violates unique constraint');
      (error as Error & { code?: string }).code = '23505';
      throw error;
    }
    this.store.set(record.id, {
      ...record,
      responseCode: null,
      responseBody: null,
      updatedAt: record.updatedAt ?? record.createdAt,
    });
  }

  async update(
    _tx: IdempotencyTx,
    recordId: string,
    patch: UpdateIdempotencyKeyRecord,
  ): Promise<void> {
    const existing = this.store.get(recordId);
    if (!existing) {
      return;
    }
    this.store.set(recordId, {
      ...existing,
      ...patch,
    });
  }

  async updateIfPending(
    _tx: IdempotencyTx,
    recordId: string,
    patch: UpdateIdempotencyKeyRecord,
  ): Promise<boolean> {
    const existing = this.store.get(recordId);
    if (!existing || existing.status !== 'PENDING') {
      return false;
    }

    this.store.set(recordId, {
      ...existing,
      ...patch,
    });
    return true;
  }

  async updateIfExpired(
    _tx: IdempotencyTx,
    recordId: string,
    now: Date,
    patch: UpdateIdempotencyKeyRecord,
  ): Promise<boolean> {
    const existing = this.store.get(recordId);
    if (!existing || existing.expiresAt.getTime() > now.getTime()) {
      return false;
    }

    this.store.set(recordId, {
      ...existing,
      ...patch,
    });
    return true;
  }
}
