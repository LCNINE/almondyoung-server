import { BadRequestException, ConflictException, ExecutionContext } from '@nestjs/common';
import { CallHandler } from '@nestjs/common/interfaces';
import { FastifyReply, FastifyRequest } from 'fastify';
import { lastValueFrom, of, throwError } from 'rxjs';
import { HttpIdempotencyInterceptor } from './http-idempotency.interceptor';
import { IdempotencyService } from './idempotency.service';

describe('HttpIdempotencyInterceptor', () => {
  let idempotencyService: jest.Mocked<IdempotencyService>;
  let interceptor: HttpIdempotencyInterceptor;

  beforeEach(() => {
    idempotencyService = {
      beginHttpRequest: jest.fn(),
      completeSuccess: jest.fn(),
      completeFailure: jest.fn(),
    } as unknown as jest.Mocked<IdempotencyService>;
    interceptor = new HttpIdempotencyInterceptor(idempotencyService);
  });

  it('bypasses non-write methods', async () => {
    const { context, callHandler } = createHttpExecutionContext({
      method: 'GET',
      url: '/v1/health',
      body: null,
      headers: {},
    });

    const result = await lastValueFrom(await interceptor.intercept(context, callHandler));

    expect(result).toEqual({ ok: true });
    expect(idempotencyService.beginHttpRequest).not.toHaveBeenCalled();
  });

  it('requires Idempotency-Key for write methods', async () => {
    const { context, callHandler } = createHttpExecutionContext({
      method: 'POST',
      url: '/v1/intents',
      body: { amount: 1000 },
      headers: {},
    });

    await expect(interceptor.intercept(context, callHandler)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('replays stored response when idempotency hit occurs', async () => {
    const { context, callHandler, reply } = createHttpExecutionContext({
      method: 'POST',
      url: '/v1/intents',
      body: { customerId: 'customer-1', amount: 1000 },
      headers: { 'idempotency-key': 'idem-1' },
    });
    idempotencyService.beginHttpRequest.mockResolvedValue({
      kind: 'REPLAY',
      responseCode: 201,
      responseBody: { success: true, data: { intentId: 'intent-1' } },
    });

    const result = await lastValueFrom(await interceptor.intercept(context, callHandler));

    expect(result).toEqual({ success: true, data: { intentId: 'intent-1' } });
    expect(reply.code).toHaveBeenCalledWith(201);
    expect(callHandler.handle).not.toHaveBeenCalled();
  });

  it('stores successful response snapshot', async () => {
    const { context, callHandler } = createHttpExecutionContext({
      method: 'POST',
      url: '/v1/intents',
      body: { customerId: 'customer-1', amount: 1000 },
      headers: { 'idempotency-key': 'idem-1' },
      callResult: { success: true, data: { intentId: 'intent-1' } },
    });
    idempotencyService.beginHttpRequest.mockResolvedValue({
      kind: 'STARTED',
      recordId: 'record-1',
    });

    const result = await lastValueFrom(await interceptor.intercept(context, callHandler));

    expect(result).toEqual({ success: true, data: { intentId: 'intent-1' } });
    expect(idempotencyService.completeSuccess).toHaveBeenCalledWith(
      'record-1',
      200,
      { success: true, data: { intentId: 'intent-1' } },
    );
  });

  it('stores failed response snapshot and rethrows original error', async () => {
    const { context, callHandler } = createHttpExecutionContext({
      method: 'POST',
      url: '/v1/intents',
      body: { customerId: 'customer-1', amount: 1000 },
      headers: { 'idempotency-key': 'idem-1' },
      callError: new ConflictException({
        error: 'REFERENCE_ALREADY_PAID',
        message: 'Reference is already paid',
      }),
    });
    idempotencyService.beginHttpRequest.mockResolvedValue({
      kind: 'STARTED',
      recordId: 'record-2',
    });

    await expect(
      lastValueFrom(await interceptor.intercept(context, callHandler)),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(idempotencyService.completeFailure).toHaveBeenCalledWith(
      'record-2',
      409,
      { error: 'REFERENCE_ALREADY_PAID', message: 'Reference is already paid' },
    );
  });
});

function createHttpExecutionContext(input: {
  method: string;
  url: string;
  body: unknown;
  headers: Record<string, unknown>;
  callResult?: unknown;
  callError?: Error;
}): {
  context: ExecutionContext;
  callHandler: CallHandler;
  reply: FastifyReply & { code: jest.Mock };
} {
  const request = {
    method: input.method,
    url: input.url,
    headers: input.headers,
    body: input.body,
  } as unknown as FastifyRequest;

  const reply = {
    statusCode: 200,
    code: jest.fn().mockReturnThis(),
  } as unknown as FastifyReply & { code: jest.Mock };

  const context = {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => reply,
    }),
  } as unknown as ExecutionContext;

  const callHandler = {
    handle: jest.fn(() => {
      if (input.callError) {
        return throwError(() => input.callError);
      }
      return of(input.callResult ?? { ok: true });
    }),
  } as CallHandler;

  return { context, callHandler, reply };
}
