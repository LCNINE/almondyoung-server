import { CustomError } from '../../customError';
import { stocktakingClient } from './stocktaking.client';
import {
  retryPendingStocktakingOperation,
  stocktakingFailure,
} from './stocktaking-operation';
import { client } from '../../client';

jest.mock('@/const', () => ({
  ALMONDYOUNG_API_BASE_URL: 'http://test.invalid',
}));
jest.mock('../../client', () => ({
  client: {
    post: jest.fn().mockResolvedValue({ data: {} }),
    put: jest.fn().mockResolvedValue({ data: {} }),
    get: jest.fn().mockResolvedValue({
      data: { actorId: 'operator', operationContractVersion: 2 },
    }),
  },
}));

describe('admin stocktaking reviewed contract', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (client.get as jest.Mock).mockResolvedValue({
      data: { actorId: 'operator', operationContractVersion: 2 },
    });
    (client.post as jest.Mock).mockImplementation(async (url: string) => ({
      data: url.endsWith('/complete')
        ? {
            sessionId: 'session',
            status: 'completed',
            completedAt: new Date().toISOString(),
            summary: {
              totalLines: 1,
              discrepanciesFound: 1,
              adjustmentsApplied: 1,
            },
          }
        : {
            lineId: 'line',
            skuId: 'sku',
            countedQuantity: url.endsWith('/reset-count') ? null : 1,
            expectedQuantity: 1,
            variance: url.endsWith('/reset-count') ? null : 0,
            lineRevision: 2,
            sessionRevision: 2,
            countBaselineVersion: 1,
          },
    }));
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        locks: {
          request: (_key: string, action: () => Promise<unknown>) => action(),
        },
      },
    });
    const entries = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => entries.set(key, value),
        removeItem: (key: string) => entries.delete(key),
        key: (index: number) => [...entries.keys()][index] ?? null,
        get length() {
          return entries.size;
        },
      },
    });
  });
  it('always requests the v2 full-session preview', async () => {
    await stocktakingClient.generateAdjustments('session');
    expect(client.post).toHaveBeenCalledWith(
      'http://test.invalid/stocktaking/sessions/session/generate-adjustments',
      { contractVersion: 2 }
    );
  });
  it('submits the previously reviewed token and caller-held operation key', async () => {
    const complete = stocktakingClient.completeSession as (
      ...args: unknown[]
    ) => Promise<unknown>;
    await complete('session', {
      previewToken: 'reviewed-token',
      idempotencyKey: 'held-key',
    });
    expect(client.post).toHaveBeenCalledWith(
      'http://test.invalid/stocktaking/sessions/session/complete',
      {
        contractVersion: 2,
        previewToken: 'reviewed-token',
        idempotencyKey: 'held-key',
      }
    );
  });
  it('keeps an uncertain scan immutable and blocks a replacement key until recovery', async () => {
    (client.post as jest.Mock).mockRejectedValueOnce(
      new Error('response lost')
    );
    const first = {
      sessionId: 'session',
      locationId: 'location',
      productBarcode: 'barcode',
      idempotencyKey: 'original',
    };
    await expect(stocktakingClient.scanProduct(first)).rejects.toThrow(
      'response lost'
    );
    await expect(
      stocktakingClient.scanProduct({ ...first, idempotencyKey: 'replacement' })
    ).rejects.toThrow();
    expect(client.post).toHaveBeenCalledTimes(1);
  });
  it('does not send a mutating request when local persistence fails', async () => {
    localStorage.setItem = () => {
      throw new Error('storage unavailable');
    };
    await expect(
      stocktakingClient.scanProduct({
        sessionId: 'session',
        locationId: 'location',
        productBarcode: 'barcode',
        idempotencyKey: 'key',
      })
    ).rejects.toThrow();
    expect(client.post).not.toHaveBeenCalled();
  });

  it('recovers the exact persisted body after response loss and removes it only after success', async () => {
    (client.post as jest.Mock).mockRejectedValueOnce(
      new Error('response lost')
    );
    const request = {
      sessionId: 'session',
      locationId: 'location',
      productBarcode: 'barcode',
      idempotencyKey: 'original',
    };
    await expect(stocktakingClient.scanProduct(request)).rejects.toThrow();
    const original = (client.post as jest.Mock).mock.calls[0];
    expect(localStorage.length).toBe(1);
    await expect(retryPendingStocktakingOperation()).resolves.toBe(true);
    expect((client.post as jest.Mock).mock.calls[1]).toEqual(original);
    expect(localStorage.length).toBe(0);
  });
  it('does not replay or hide another operator pending work after account switch', async () => {
    (client.post as jest.Mock).mockRejectedValueOnce(
      new Error('response lost')
    );
    await expect(
      stocktakingClient.scanProduct({
        sessionId: 'session',
        locationId: 'location',
        productBarcode: 'barcode',
        idempotencyKey: 'original',
      })
    ).rejects.toThrow();
    (client.get as jest.Mock).mockResolvedValueOnce({
      data: { actorId: 'another', operationContractVersion: 2 },
    });
    await expect(retryPendingStocktakingOperation()).rejects.toThrow();
    expect(client.post).toHaveBeenCalledTimes(1);
    expect(localStorage.length).toBe(1);
  });
  it('blocks recovery past the conservative server deduplication horizon', async () => {
    (client.post as jest.Mock).mockRejectedValueOnce(
      new Error('response lost')
    );
    await expect(
      stocktakingClient.scanProduct({
        sessionId: 'session',
        locationId: 'location',
        productBarcode: 'barcode',
        idempotencyKey: 'original',
      })
    ).rejects.toThrow();
    const key = localStorage.key(0)!;
    const stored = JSON.parse(localStorage.getItem(key)!);
    localStorage.setItem(
      key,
      JSON.stringify({ ...stored, createdAt: Date.now() - 29 * 86400000 })
    );
    await expect(retryPendingStocktakingOperation()).rejects.toThrow();
    expect(client.post).toHaveBeenCalledTimes(1);
  });
  it.each([
    'STOCKTAKING_RECOUNT_REQUIRED',
    'STOCKTAKING_REVISION_CONFLICT',
    'STOCKTAKING_PREVIEW_STALE',
    'STOCKTAKING_COUNT_REQUIRED',
  ])(
    'releases a definitively rejected %s CustomError so recount is possible',
    async (code) => {
      (client.post as jest.Mock).mockRejectedValueOnce(
        new CustomError({
          statusCode: 409,
          message: '처음부터 다시 세어 주세요.',
          response: { code, message: '처음부터 다시 세어 주세요.' },
        })
      );
      await expect(
        stocktakingClient.scanProduct({
          sessionId: 'session',
          locationId: 'location',
          productBarcode: 'barcode',
          idempotencyKey: 'rejected',
        })
      ).rejects.toThrow();
      expect(localStorage.length).toBe(0);
      await expect(
        stocktakingClient.resetCount('line', {
          expectedRevision: 1,
          idempotencyKey: 'reset',
        })
      ).resolves.toMatchObject({ countedQuantity: null });
      expect(client.post).toHaveBeenCalledTimes(2);
    }
  );
  it.each([400, 404, 422])(
    'clears a definite %s CustomError rejection',
    async (statusCode) => {
      (client.post as jest.Mock).mockRejectedValueOnce(
        new CustomError({
          statusCode,
          message: '등록되지 않은 바코드예요.',
          response: { message: '등록되지 않은 바코드예요.' },
        })
      );
      await expect(
        stocktakingClient.scanProduct({
          sessionId: 'session',
          locationId: 'location',
          productBarcode: 'barcode',
          idempotencyKey: 'rejected',
        })
      ).rejects.toThrow();
      expect(localStorage.length).toBe(0);
    }
  );
  it.each([403, 409, 500])(
    'preserves an unresolved %s CustomError',
    async (statusCode) => {
      (client.post as jest.Mock).mockRejectedValueOnce(
        new CustomError({
          statusCode,
          message: 'request unresolved',
          response: { code: 'OPERATION_PAYLOAD_MISMATCH' },
        })
      );
      await expect(
        stocktakingClient.scanProduct({
          sessionId: 'session',
          locationId: 'location',
          productBarcode: 'barcode',
          idempotencyKey: 'original',
        })
      ).rejects.toThrow();
      expect(localStorage.length).toBe(1);
    }
  );

  it('retains an unrecognized successful response for exact-key recovery', async () => {
    (client.post as jest.Mock).mockResolvedValueOnce({
      data: { accepted: true },
    });
    await expect(
      stocktakingClient.scanProduct({
        sessionId: 'session',
        locationId: 'location',
        productBarcode: 'barcode',
        idempotencyKey: 'original',
      })
    ).rejects.toThrow();
    expect(localStorage.length).toBe(1);
    await expect(
      stocktakingClient.scanProduct({
        sessionId: 'session',
        locationId: 'location',
        productBarcode: 'barcode',
        idempotencyKey: 'replacement',
      })
    ).rejects.toThrow();
    expect(client.post).toHaveBeenCalledTimes(1);
  });
  it('preserves the actual CustomError domain guidance for the drawer', () => {
    expect(
      stocktakingFailure(
        new CustomError({
          statusCode: 409,
          message: '다시 세어 주세요.',
          response: {
            code: 'STOCKTAKING_RECOUNT_REQUIRED',
            message: '다시 세어 주세요.',
          },
        })
      )
    ).toEqual({
      status: 409,
      code: 'STOCKTAKING_RECOUNT_REQUIRED',
      message: '다시 세어 주세요.',
    });
    expect(
      stocktakingFailure({
        response: {
          status: 409,
          data: {
            error: 'STOCKTAKING_PREVIEW_STALE',
            message: '수량을 다시 확인해 주세요.',
          },
        },
      })
    ).toEqual({
      status: 409,
      code: 'STOCKTAKING_PREVIEW_STALE',
      message: '수량을 다시 확인해 주세요.',
    });
  });
  it.each(['scan-location', 'count', 'reset-count', 'complete'] as const)(
    'retains malformed successful %s results',
    async (route) => {
      (client.post as jest.Mock).mockResolvedValueOnce({ data: {} });
      (client.put as jest.Mock).mockResolvedValueOnce({ data: {} });
      const action =
        route === 'scan-location'
          ? stocktakingClient.scanLocation({
              sessionId: 'session',
              locationBarcode: 'location',
              idempotencyKey: 'original',
            })
          : route === 'count'
            ? stocktakingClient.updateLineCount('line', {
                countedQuantity: 0,
                expectedRevision: 1,
                idempotencyKey: 'original',
              })
            : route === 'reset-count'
              ? stocktakingClient.resetCount('line', {
                  expectedRevision: 1,
                  idempotencyKey: 'original',
                })
              : stocktakingClient.completeSession('session', {
                  previewToken: 'token',
                  idempotencyKey: 'original',
                });
      await expect(action).rejects.toThrow();
      expect(localStorage.length).toBe(1);
    }
  );
  it('accepts a confirmed zero direct count and its exact line identity', async () => {
    (client.put as jest.Mock).mockResolvedValueOnce({
      data: {
        lineId: 'line',
        skuId: 'sku',
        countedQuantity: 0,
        expectedQuantity: 2,
        variance: -2,
        lineRevision: 2,
        sessionRevision: 3,
        countBaselineVersion: 0,
      },
    });
    await expect(
      stocktakingClient.updateLineCount('line', {
        countedQuantity: 0,
        expectedRevision: 1,
        idempotencyKey: 'zero',
      })
    ).resolves.toMatchObject({ countedQuantity: 0 });
    expect(localStorage.length).toBe(0);
  });
  it('retains a result for the wrong count line', async () => {
    (client.put as jest.Mock).mockResolvedValueOnce({
      data: {
        lineId: 'other-line',
        skuId: 'sku',
        countedQuantity: 0,
        expectedQuantity: 2,
        variance: -2,
        lineRevision: 2,
        sessionRevision: 3,
        countBaselineVersion: 0,
      },
    });
    await expect(
      stocktakingClient.updateLineCount('line', {
        countedQuantity: 0,
        expectedRevision: 1,
        idempotencyKey: 'zero',
      })
    ).rejects.toThrow();
    expect(localStorage.length).toBe(1);
  });
});
