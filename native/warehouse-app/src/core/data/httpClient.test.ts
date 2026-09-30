import { describe, it, expect, vi } from 'vitest';
import { ApiError, ConflictError, createApiClient } from './httpClient';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('createApiClient', () => {
  it('attaches bearer auth + idempotency-key and returns parsed JSON', async () => {
    const doFetch = vi.fn<
      (url: string, init?: RequestInit) => Promise<Response>
    >(async () => jsonResponse(200, { ok: true }));
    const client = createApiClient({
      baseUrl: 'https://api.test',
      getToken: async () => 'TOK',
      authMode: 'bearer',
      doFetch: doFetch as never,
    });
    const out = await client.request<{ ok: boolean }>({
      method: 'POST',
      path: '/inventory/adjust',
      body: { qty: 1 },
      idempotencyKey: 'idem-1',
    });
    expect(out).toEqual({ ok: true });
    const [url, init] = doFetch.mock.calls[0];
    expect(url).toBe('https://api.test/inventory/adjust');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer TOK',
      'idempotency-key': 'idem-1',
    });
  });

  it('does not blindly retry a domain conflict', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(409, { message: 'version conflict' }))
      .mockResolvedValueOnce(
        jsonResponse(409, { message: 'version conflict' })
      );
    const client = createApiClient({
      baseUrl: 'https://api.test',
      getToken: async () => 'TOK',
      authMode: 'bearer',
      doFetch: doFetch as never,
    });
    await expect(
      client.request({ path: '/x', idempotencyKey: 'k' })
    ).rejects.toThrow(/conflict/i);
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  // GlobalExceptionFilter 는 `{ success:false, error: <domain code>, message }` 를 응답 바디로
  // 낸다. errorMessage(context) 가 SKU_NOT_IN_SHIPMENT·OVERSCAN 등을 구분하려면 ConflictError
  // 가 그 `error` 코드를 들고 있어야 한다 — 지금까지는 message 만 살아남고 코드는 버려졌다.
  it('carries the server error code on a persisting 409', async () => {
    const doFetch = vi.fn().mockResolvedValue(
      jsonResponse(409, {
        success: false,
        error: 'SIMPLE_OUTBOUND_OVERSCAN',
        message:
          'Scan exceeds the remaining allocated quantity for this SKU by 1',
      })
    );
    const client = createApiClient({
      baseUrl: 'https://api.test',
      getToken: async () => 'TOK',
      authMode: 'bearer',
      doFetch: doFetch as never,
    });

    const error: unknown = await client
      .request({ path: '/x', idempotencyKey: 'k' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).code).toBe('SIMPLE_OUTBOUND_OVERSCAN');
    expect((error as ConflictError).message).toBe(
      'Scan exceeds the remaining allocated quantity for this SKU by 1'
    );
  });
});
it('preserves unknown or malformed errors as uncertain', () => {
  expect(new ConflictError('unknown').outcome).toBe('uncertain');
  expect(
    new ConflictError('changed', 'OPERATION_PAYLOAD_MISMATCH').outcome
  ).toBe('uncertain');
  expect(
    new ConflictError('too many', 'SIMPLE_OUTBOUND_OVERSCAN').outcome
  ).toBe('rejected');
});

it('classifies only the named inactive movement destination conflict as rejected', () => {
  expect(
    new ApiError('inactive destination', 409, 'MOVEMENT_DESTINATION_INACTIVE')
      .outcome
  ).toBe('rejected');
  expect(new ApiError('other conflict', 409, 'OTHER_409').outcome).toBe(
    'uncertain'
  );
});

it('classifies known barcode and unfinished-count refusals without trapping work', () => {
  for (const code of [
    'SIMPLE_OUTBOUND_BARCODE_UNKNOWN',
    'SIMPLE_OUTBOUND_PLAN_INVALIDATED',
    'STOCKTAKING_COUNT_REQUIRED',
    'BAD_REQUEST',
    'CONFLICT',
  ])
    expect(new ConflictError('refused', code).outcome).toBe('rejected');
});

it('only classifies explicit force non-application as rejected and preserves generic auth uncertainty', () => {
  expect(
    new ConflictError('not applied', 'LOCATION_OUTBOUND_FORCE_NOT_APPLIED')
      .outcome
  ).toBe('rejected');
  for (const status of [401, 403])
    expect(
      new ApiError('forbidden', status, 'LOCATION_OUTBOUND_FORCE_NOT_APPLIED')
        .outcome
    ).toBe('uncertain');
});

it.each([
  'SOURCE_STOCK_CHANGED',
  'PLAN_IDENTITY_CHANGED',
  'PLAN_NOT_DRAFT',
  'SHIPMENT_SNAPSHOT_CHANGED',
  'ALLOCATION_INVALID',
  'ELIGIBILITY_CHANGED',
  'SOURCE_INSUFFICIENT',
  'ACTIVE_WORK_REQUIRES_REVIEW',
  'REPLAN_LIMIT_REACHED',
  'BATCH_NOT_STARTED',
])(
  'preserves validated preparation reason %s without diagnostic extras',
  async (reasonCode) => {
    const client = createApiClient({
      baseUrl: 'https://api.test',
      getToken: async () => 'TOK',
      authMode: 'bearer',
      doFetch: async () =>
        jsonResponse(409, {
          code: 'SIMPLE_OUTBOUND_PLAN_INVALIDATED',
          details: {
            reasonCode,
            recovery: 'retry_preparation',
            internal: 'private',
          },
        }),
    });
    await expect(client.request({ path: '/x' })).rejects.toMatchObject({
      outcome: 'rejected',
      preparation: { reasonCode, recovery: 'retry_preparation' },
    });
    const error = await client
      .request({ path: '/x' })
      .catch((e: ApiError) => e);
    if (!(error instanceof ApiError)) throw new Error('Expected ApiError');
    expect(error.preparation).not.toHaveProperty('internal');
  }
);
it.each([
  [
    409,
    'NEW_UNKNOWN_CODE',
    { reasonCode: 'SOURCE_INSUFFICIENT', recovery: 'retry_preparation' },
    'uncertain',
  ],
  [409, 'PICKING_COMPONENT_CHANGED_RETRY', {}, 'uncertain'],
  [
    503,
    'SIMPLE_OUTBOUND_PLAN_INVALIDATED',
    { reasonCode: 'SOURCE_INSUFFICIENT', recovery: 'retry_preparation' },
    'uncertain',
  ],
  [
    409,
    'SIMPLE_OUTBOUND_PLAN_INVALIDATED',
    { reasonCode: 'NEW_REASON', recovery: 'retry_preparation' },
    'rejected',
  ],
  [
    409,
    'SIMPLE_OUTBOUND_PLAN_INVALIDATED',
    { reasonCode: 'SOURCE_INSUFFICIENT', recovery: 'automatic' },
    'rejected',
  ],
  [409, 'SIMPLE_OUTBOUND_PLAN_INVALIDATED', null, 'rejected'],
] as const)(
  'filters unsupported preparation details (%s %s %j)',
  async (status, code, details, outcome) => {
    const client = createApiClient({
      baseUrl: 'https://api.test',
      getToken: async () => 'TOK',
      authMode: 'bearer',
      doFetch: async () => jsonResponse(status, { code, details }),
    });
    const error = await client
      .request({ path: '/x' })
      .catch((e: ApiError) => e);
    expect(error).toMatchObject({ outcome });
    if (!(error instanceof ApiError)) throw new Error('Expected ApiError');
    expect(error.preparation).toBeUndefined();
  }
);

describe('409 errors body and rejected codes (#987)', () => {
  it('409 본문의 errors 를 ConflictError.errors 로 싣는다(배치 시작 차단 목록)', async () => {
    const client = createApiClient({
      baseUrl: 'https://api.test',
      getToken: async () => 'TOK',
      authMode: 'bearer',
      doFetch: (async () =>
        jsonResponse(409, {
          code: 'BATCH_START_BLOCKED',
          message: 'x',
          errors: [{ shipmentId: 's1', reason: 'STOCK_SHORT' }],
        })) as never,
    });
    const error = await client
      .request({ method: 'POST', path: '/picking/v2/starts' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).errors).toEqual([
      { shipmentId: 's1', reason: 'STOCK_SHORT' },
    ]);
    expect((error as ConflictError).outcome).toBe('rejected');
  });

  it.each([
    'LABEL_REPRINT_REQUIRED',
    'LABEL_CONTENT_CHANGED',
    'WAYBILL_STALE',
    'WAYBILL_NOT_DISPATCHABLE',
    'WAYBILL_LABEL_NOT_ALLOCATED',
  ])('%s 409 는 rejected — 오프라인 작업 큐가 재시도하지 않는다', (code) => {
    expect(new ConflictError('m', code).outcome).toBe('rejected');
  });

  it.each([
    'BATCH_NOT_JOINABLE',
    'SHIPMENT_ACTIVE_WORK_ITEM',
    'OUTBOUND_BATCH_CART_CAPACITY_EXCEEDED',
    'WORK_ITEM_TOTE_RELEASE_REQUIRED',
    'WORK_ITEM_DISPATCH_EXISTS',
    'WORK_ITEM_ALLOCATED',
    'OUTBOUND_BATCH_STARTED_RETRY',
    'PICKING_SESSION_NOT_ACTIVE',
    'BATCH_JOIN_BLOCKED',
  ])('%s 409 는 확정 거절 (#988)', (code) => {
    expect(new ConflictError('m', code).outcome).toBe('rejected');
  });

  it.each([
    'SHIPMENT_WITHDRAWN',
    'SHIPMENT_ALREADY_WITHDRAWING',
    'SHIPMENT_NOT_WITHDRAWING',
    'REMOVAL_NOT_PENDING',
    'RETURN_BIN_UNKNOWN',
    'RETURN_BIN_WAREHOUSE_MISMATCH',
    'RETURN_BIN_ITEM_NOT_FOUND',
    'RETURN_BIN_ITEM_SHORT',
    'RETURN_LOCATION_MISMATCH',
    'WITHDRAWAL_WAYBILL_NOT_VOIDABLE',
    'SHIPMENT_LINE_INSPECTION_STALE',
  ])('%s 409 는 확정 거절 (#989)', (code) => {
    expect(new ConflictError('m', code).outcome).toBe('rejected');
  });

  it('등록 안 된 바구니 조회(404 RETURN_BIN_UNKNOWN)도 확정 거절 — 다시 보내도 같다', () => {
    expect(new ApiError('GET /return-bins/RB-x → 404', 404, 'RETURN_BIN_UNKNOWN').outcome).toBe('rejected');
  });
});
