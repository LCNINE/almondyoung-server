import { CmsAccountCheckService } from './cms-account-check.service';
import { isCmsOperationError } from './cms-errors';

const input = { paymentCompany: '088', paymentNumber: '1234567890', payerNumber: '900101' };

function makeDb(recentCheckCount = 0) {
  const inserted: Record<string, unknown>[] = [];
  // 상한 판정은 «최근 1시간 내 호출 시각»을 읽는다 — 방금 찍힌 것처럼 채워 둔다.
  // 세는 단위는 «유료 호출 건수»다(확인 한 번 성공 = 2건).
  const recent = Array.from({ length: recentCheckCount }, () => ({ createdAt: new Date() }));
  return {
    inserted,
    dbService: {
      db: {
        // 슬롯 선점은 사용자 단위 advisory lock 안에서 조건부 INSERT 한다.
        transaction: (fn: (tx: unknown) => Promise<unknown>) =>
          fn({
            execute: (query: { queryChunks?: unknown[] }) => {
              const isLock = JSON.stringify(query ?? {}).includes('advisory');
              if (isLock) return Promise.resolve([]);
              return Promise.resolve(recentCheckCount < 20 ? [{ id: 'check-1' }] : []);
            },
          }),
        select: () => ({
          from: () => ({ where: () => ({ orderBy: () => Promise.resolve(recent) }) }),
        }),
        update: () => ({
          set: (row: Record<string, unknown>) => ({
            where: () => {
              inserted.push(row);
              return Promise.resolve();
            },
          }),
        }),
      },
    },
  };
}

const pass = (extra: Record<string, unknown> = {}) => ({
  ok: true as const,
  data: { check: { result: { flag: 'Y', code: '0000', message: '정상' }, ...extra } },
});

describe('CmsAccountCheckService', () => {
  it('returns the payer name when the account and payer number both check out', async () => {
    const { dbService, inserted } = makeDb();
    const cmsApi = {
      verifyPayerNumber: jest.fn().mockResolvedValue(pass({ paymentNumber: '123****890' })),
      inquirePayerName: jest.fn().mockResolvedValue(pass({ payerName: '홍길동' })),
    };
    const service = new CmsAccountCheckService(dbService as never, cmsApi as never);

    const result = await service.check('user-1', input);

    expect(result).toEqual({ verified: true, payerName: '홍길동' });
    expect(inserted[0]).toMatchObject({ verified: true, maskedPaymentNumber: '123****890' });
  });

  it('treats flag=N as a mismatch that must block registration', async () => {
    const { dbService } = makeDb();
    const cmsApi = {
      verifyPayerNumber: jest
        .fn()
        .mockResolvedValue({ ok: true, data: { check: { result: { flag: 'N', code: 'Q201' } } } }),
      inquirePayerName: jest.fn(),
    };
    const service = new CmsAccountCheckService(dbService as never, cmsApi as never);

    const result = await service.check('user-1', input);

    expect(result).toMatchObject({ verified: false, reason: 'MISMATCH' });
    // 불일치가 확정된 계좌에 이름 조회를 더 부르지 않는다 — 건당 유료다.
    expect(cmsApi.inquirePayerName).not.toHaveBeenCalled();
  });

  it.each([
    ['flag missing', {}],
    ['flag null', { flag: null }],
    ['unknown flag', { flag: 'X' }],
  ])('does not call an unreadable response a mismatch (%s)', async (_label, result) => {
    const { dbService } = makeDb();
    const cmsApi = {
      verifyPayerNumber: jest.fn().mockResolvedValue({ ok: true, data: { check: { result } } }),
      inquirePayerName: jest.fn(),
    };
    const service = new CmsAccountCheckService(dbService as never, cmsApi as never);

    // 응답을 해석하지 못한 것을 «계좌가 틀렸다»로 단정하면 멀쩡한 계좌가 차단된다.
    expect(await service.check('user-1', input)).toMatchObject({ verified: false, reason: 'UNAVAILABLE' });
  });

  it('never stores an unmasked account number', async () => {
    const { dbService, inserted } = makeDb();
    const cmsApi = {
      verifyPayerNumber: jest.fn().mockResolvedValue(pass({ paymentNumber: '1234567890' })),
      inquirePayerName: jest.fn().mockResolvedValue(pass({ payerName: '홍길동' })),
    };
    const service = new CmsAccountCheckService(dbService as never, cmsApi as never);

    await service.check('user-1', input);

    expect(inserted[0].maskedPaymentNumber).toBeNull();
  });

  it('treats a provider failure as UNAVAILABLE so unsupported banks can still register', async () => {
    const { dbService } = makeDb();
    const cmsApi = {
      verifyPayerNumber: jest
        .fn()
        .mockResolvedValue({ ok: false, error: { code: 'CMS_NETWORK_ERROR', message: 'timeout' }, statusCode: 503 }),
      inquirePayerName: jest.fn(),
    };
    const service = new CmsAccountCheckService(dbService as never, cmsApi as never);

    const result = await service.check('user-1', input);

    expect(result).toMatchObject({ verified: false, reason: 'UNAVAILABLE' });
  });

  it('still verifies when only the payer name lookup fails', async () => {
    const { dbService } = makeDb();
    const cmsApi = {
      verifyPayerNumber: jest.fn().mockResolvedValue(pass()),
      inquirePayerName: jest
        .fn()
        .mockResolvedValue({ ok: false, error: { code: '500', message: 'x' }, statusCode: 500 }),
    };
    const service = new CmsAccountCheckService(dbService as never, cmsApi as never);

    expect(await service.check('user-1', input)).toEqual({ verified: true, payerName: null });
  });

  it('rejects once the hourly call limit is reached without spending a paid call', async () => {
    const { dbService } = makeDb(20);
    const cmsApi = { verifyPayerNumber: jest.fn(), inquirePayerName: jest.fn() };
    const service = new CmsAccountCheckService(dbService as never, cmsApi as never);

    const error = await service.check('user-1', input).catch((e: unknown) => e);
    expect(isCmsOperationError(error) && error.statusCode).toBe(429);
    expect(cmsApi.verifyPayerNumber).not.toHaveBeenCalled();
  });
});
