import { ValidationPipe } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import * as request from 'supertest';
import { IntentsController } from './intents.controller';
import { IntentsService } from './intents.service';
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

describe('Intents HTTP idempotency (integration)', () => {
  let app: NestFastifyApplication;
  let module: TestingModule;
  let intentsService: {
    createIntent: jest.Mock;
    getIntent: jest.Mock;
    configureLegs: jest.Mock;
    authorizeLeg: jest.Mock;
    captureLeg: jest.Mock;
    cancelIntent: jest.Mock;
    supersedeIntent: jest.Mock;
  };

  beforeEach(async () => {
    intentsService = {
      createIntent: jest.fn().mockResolvedValue(createIntentFixture()),
      getIntent: jest.fn().mockResolvedValue(createIntentFixture()),
      configureLegs: jest.fn().mockResolvedValue([createReadyLegFixture()]),
      authorizeLeg: jest.fn().mockResolvedValue(createAuthorizeFixture()),
      captureLeg: jest.fn().mockResolvedValue(createCaptureFixture()),
      cancelIntent: jest.fn().mockResolvedValue({
        intentId: 'intent-1',
        status: 'CANCELLED',
      }),
      supersedeIntent: jest.fn().mockResolvedValue({
        intentId: 'intent-1',
        status: 'SUPERSEDED',
      }),
    };

    module = await Test.createTestingModule({
      controllers: [IntentsController],
      providers: [
        IdempotencyService,
        {
          provide: IDEMPOTENCY_REPOSITORY,
          useClass: InMemoryIdempotencyRepository,
        },
        {
          provide: IntentsService,
          useValue: intentsService,
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
    await app.close();
    await module.close();
  });

  it('supports checkout flow over HTTP: create -> legs -> authorize -> capture', async () => {
    const createResponse = await sendWriteRequest({
      app,
      method: 'post',
      path: '/v1/intents',
      idempotencyKey: 'idem-flow-create',
      body: validCreateIntentBody(),
    }).expect(201);

    expect(createResponse.body.success).toBe(true);
    expect(createResponse.body.data.id).toBe('intent-1');

    const getResponse = await request(app.getHttpServer())
      .get('/v1/intents/intent-1')
      .expect(200);

    expect(getResponse.body.success).toBe(true);
    expect(getResponse.body.data.id).toBe('intent-1');

    const configureResponse = await sendWriteRequest({
      app,
      method: 'put',
      path: '/v1/intents/intent-1/legs',
      idempotencyKey: 'idem-flow-legs',
      body: validConfigureLegsBody(),
    }).expect(200);

    expect(configureResponse.body.success).toBe(true);
    expect(configureResponse.body.data).toHaveLength(1);

    const authorizeResponse = await sendWriteRequest({
      app,
      method: 'post',
      path: '/v1/intents/intent-1/legs/leg-1/authorize',
      idempotencyKey: 'idem-flow-authorize',
      body: { step: 'authorize' },
    }).expect(201);

    expect(authorizeResponse.body.success).toBe(true);
    expect(authorizeResponse.body.data.leg.status).toBe('AUTHORIZED');

    const captureResponse = await sendWriteRequest({
      app,
      method: 'post',
      path: '/v1/intents/intent-1/legs/leg-1/capture',
      idempotencyKey: 'idem-flow-capture',
      body: { step: 'capture' },
    }).expect(201);

    expect(captureResponse.body.success).toBe(true);
    expect(captureResponse.body.data.intent.status).toBe('SUCCEEDED');
  });

  it('replays stored response for same key + same payload across write APIs', async () => {
    const scenarios: Array<{
      name: string;
      method: 'post' | 'put';
      path: string;
      body: string | Record<string, unknown> | undefined;
      expectedStatus: number;
      targetMethod: keyof typeof intentsService;
      fixture: unknown;
    }> = [
      {
        name: 'create-intent',
        method: 'post',
        path: '/v1/intents',
        body: validCreateIntentBody(),
        expectedStatus: 201,
        targetMethod: 'createIntent',
        fixture: createIntentFixture(),
      },
      {
        name: 'configure-legs',
        method: 'put',
        path: '/v1/intents/intent-1/legs',
        body: validConfigureLegsBody(),
        expectedStatus: 200,
        targetMethod: 'configureLegs',
        fixture: [createReadyLegFixture()],
      },
      {
        name: 'authorize-leg',
        method: 'post',
        path: '/v1/intents/intent-1/legs/leg-1/authorize',
        body: { marker: 'authorize' },
        expectedStatus: 201,
        targetMethod: 'authorizeLeg',
        fixture: createAuthorizeFixture(),
      },
      {
        name: 'capture-leg',
        method: 'post',
        path: '/v1/intents/intent-1/legs/leg-1/capture',
        body: { marker: 'capture' },
        expectedStatus: 201,
        targetMethod: 'captureLeg',
        fixture: createCaptureFixture(),
      },
      {
        name: 'cancel-intent',
        method: 'post',
        path: '/v1/intents/intent-1/cancel',
        body: { marker: 'cancel' },
        expectedStatus: 201,
        targetMethod: 'cancelIntent',
        fixture: { intentId: 'intent-1', status: 'CANCELLED' },
      },
      {
        name: 'supersede-intent',
        method: 'post',
        path: '/v1/intents/intent-1/supersede',
        body: { marker: 'supersede' },
        expectedStatus: 201,
        targetMethod: 'supersedeIntent',
        fixture: { intentId: 'intent-1', status: 'SUPERSEDED' },
      },
    ];

    for (const scenario of scenarios) {
      const methodMock = intentsService[scenario.targetMethod];
      methodMock.mockClear();
      methodMock.mockResolvedValue(scenario.fixture);

      const idempotencyKey = `idem-replay-${scenario.name}`;
      const first = await sendWriteRequest({
        app,
        method: scenario.method,
        path: scenario.path,
        idempotencyKey,
        body: scenario.body,
      }).expect(scenario.expectedStatus);

      const second = await sendWriteRequest({
        app,
        method: scenario.method,
        path: scenario.path,
        idempotencyKey,
        body: scenario.body,
      }).expect(scenario.expectedStatus);

      expect(methodMock).toHaveBeenCalledTimes(1);
      expect(second.body).toEqual(first.body);
    }
  });

  it('returns 409 for same key + different payload', async () => {
    intentsService.cancelIntent.mockClear();
    intentsService.cancelIntent.mockResolvedValue({
      intentId: 'intent-1',
      status: 'CANCELLED',
    });

    await sendWriteRequest({
      app,
      method: 'post',
      path: '/v1/intents/intent-1/cancel',
      idempotencyKey: 'idem-conflict-cancel',
      body: { reasonCode: 'CUSTOMER_REQUEST' },
    }).expect(201);

    const second = await sendWriteRequest({
      app,
      method: 'post',
      path: '/v1/intents/intent-1/cancel',
      idempotencyKey: 'idem-conflict-cancel',
      body: { reasonCode: 'DUPLICATE_ORDER' },
    }).expect(409);

    expect(second.body.error).toBe('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD');
    expect(intentsService.cancelIntent).toHaveBeenCalledTimes(1);
  });

  it('returns 409 when same key request is already in progress', async () => {
    const deferred = createDeferred<unknown>();
    intentsService.authorizeLeg.mockClear();
    intentsService.authorizeLeg.mockImplementationOnce(() => deferred.promise);

    const firstRequest = sendWriteRequest({
      app,
      method: 'post',
      path: '/v1/intents/intent-1/legs/leg-1/authorize',
      idempotencyKey: 'idem-in-progress',
      body: { marker: 'authorize' },
    }).expect(201);
    void firstRequest.then(
      () => undefined,
      () => undefined,
    );

    await waitUntil(() => intentsService.authorizeLeg.mock.calls.length === 1);

    const secondResponse = await sendWriteRequest({
      app,
      method: 'post',
      path: '/v1/intents/intent-1/legs/leg-1/authorize',
      idempotencyKey: 'idem-in-progress',
      body: { marker: 'authorize' },
    }).expect(409);

    expect(secondResponse.body.error).toBe('IDEMPOTENCY_REQUEST_IN_PROGRESS');

    deferred.resolve(createAuthorizeFixture());
    const firstResponse = await firstRequest;
    expect(firstResponse.body.success).toBe(true);
    expect(intentsService.authorizeLeg).toHaveBeenCalledTimes(1);
  });
});

function validCreateIntentBody(): Record<string, unknown> {
  return {
    referenceType: 'STORE_ORDER',
    referenceId: 'order-1',
    customerId: 'customer-1',
    currency: 'KRW',
    payableAmount: 10000,
    snapshotPayload: { orderId: 'order-1', totalAmount: 10000 },
    signature: 'dummy-signature',
    signatureVersion: 'v1',
    signedAt: '2026-02-17T00:00:00.000Z',
  };
}

function validConfigureLegsBody(): Record<string, unknown> {
  return {
    legs: [
      {
        providerType: 'POINTS',
        amount: 10000,
        sequenceNo: 1,
        isRequired: true,
      },
    ],
  };
}

function createIntentFixture(): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: 'intent-1',
    referenceType: 'STORE_ORDER',
    referenceId: 'order-1',
    customerId: 'customer-1',
    currency: 'KRW',
    payableAmount: 10000,
    status: 'PENDING',
    expiresAt: now,
    version: 0,
    metadata: {},
    createdAt: now,
    updatedAt: now,
  };
}

function createReadyLegFixture(): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: 'leg-1',
    intentId: 'intent-1',
    providerType: 'POINTS',
    amount: 10000,
    status: 'READY',
    isRequired: true,
    sequenceNo: 1,
    version: 0,
    metadata: {},
    createdAt: now,
    updatedAt: now,
  };
}

function createAuthorizeFixture(): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    intent: {
      ...createIntentFixture(),
      status: 'IN_PROGRESS',
      updatedAt: now,
    },
    leg: {
      ...createReadyLegFixture(),
      status: 'AUTHORIZED',
      updatedAt: now,
    },
    attempt: {
      id: 'attempt-1',
      intentId: 'intent-1',
      legId: 'leg-1',
      attemptNo: 1,
      operation: 'AUTHORIZE',
      status: 'AUTHORIZED',
      providerTransactionId: 'provider-auth-1',
      providerRequestId: 'provider-req-1',
      idempotencyKey: null,
      providerIdempotencyKey: 'wallet:test:leg-1:AUTHORIZE:1',
      errorCode: null,
      errorMessage: null,
      requestPayload: { operation: 'AUTHORIZE' },
      responsePayload: { providerType: 'POINTS' },
      createdAt: now,
      updatedAt: now,
    },
  };
}

function createCaptureFixture(): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    intent: {
      ...createIntentFixture(),
      status: 'SUCCEEDED',
      updatedAt: now,
    },
    leg: {
      ...createReadyLegFixture(),
      status: 'CAPTURED',
      updatedAt: now,
    },
    attempt: {
      id: 'attempt-2',
      intentId: 'intent-1',
      legId: 'leg-1',
      attemptNo: 2,
      operation: 'CAPTURE',
      status: 'CAPTURED',
      providerTransactionId: 'provider-cap-1',
      providerRequestId: 'provider-cap-req-1',
      idempotencyKey: null,
      providerIdempotencyKey: 'wallet:test:leg-1:CAPTURE:2',
      errorCode: null,
      errorMessage: null,
      requestPayload: { operation: 'CAPTURE' },
      responsePayload: { providerType: 'POINTS' },
      createdAt: now,
      updatedAt: now,
    },
  };
}

function sendWriteRequest(input: {
  app: NestFastifyApplication;
  method: 'post' | 'put';
  path: string;
  idempotencyKey: string;
  body: string | Record<string, unknown> | undefined;
}) {
  const base = request(input.app.getHttpServer());
  const req =
    input.method === 'post'
      ? base.post(input.path)
      : base.put(input.path);

  req
    .set('Idempotency-Key', input.idempotencyKey)
    .set('X-Correlation-Id', `corr-${input.idempotencyKey}`);

  return req.send(input.body);
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timeout waiting for asynchronous condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

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
