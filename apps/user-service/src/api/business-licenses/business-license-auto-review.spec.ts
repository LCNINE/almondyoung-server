import Anthropic from '@anthropic-ai/sdk';
import { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { BusinessLicenseAutoReviewService, judgeReading } from './business-license-auto-review.service';
import { NtsValidateResult } from './dto/business-license.dto';
import { LicenseReading } from './license-image-reader';

const VALID_NO = '1663800846';

function reading(overrides: Partial<LicenseReading> = {}): LicenseReading {
  return {
    isBusinessRegistration: true,
    businessNumber: VALID_NO,
    representativeName: '홍길동',
    startDate: '20210615',
    isCorporation: false,
    readable: true,
    ...overrides,
  };
}

describe('judgeReading', () => {
  it('조건을 모두 통과하면 국세청에 넣을 세 값을 돌려준다', () => {
    expect(judgeReading(reading(), '홍길동')).toEqual({
      businessNumber: VALID_NO,
      representativeName: '홍길동',
      startDate: '20210615',
    });
  });

  it('이름 사이 공백은 무시한다', () => {
    expect(judgeReading(reading({ representativeName: '홍 길동' }), '홍길동 ')).not.toHaveProperty('reason');
  });

  it.each<[string, Partial<LicenseReading>, string]>([
    ['사업자등록증이 아니면', { isBusinessRegistration: false }, 'not_license'],
    ['판독 확신이 없으면', { readable: false }, 'unreadable'],
    ['개업일을 못 읽었으면', { startDate: null }, 'unreadable'],
    ['체크섬이 틀리면', { businessNumber: '1663800546' }, 'unreadable'],
    ['법인이라고 읽었으면', { isCorporation: true }, 'corporation'],
    ['번호가 법인 구분자(81~88)면', { businessNumber: '1238100001' }, 'corporation'],
    ['대표자명이 계정 이름과 다르면', { representativeName: '김철수' }, 'name_mismatch'],
  ])('%s 사람에게 넘긴다', (_, overrides, reason) => {
    expect(judgeReading(reading(overrides), '홍길동')).toEqual({ reason });
  });
});

describe('BusinessLicenseAutoReviewService', () => {
  const approvedNts: NtsValidateResult = { valid: true, status: 'active', checkedAt: 'now' };

  function makeDb(rows: unknown[], returningRows: { id: string }[][] = []) {
    const updates: { values: Record<string, unknown>; predicate: SQL }[] = [];
    const db = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve(rows) }) }) }),
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: (predicate: SQL) => {
            updates.push({ values, predicate });
            return Object.assign(Promise.resolve(undefined), {
              returning: () => Promise.resolve(returningRows.shift() ?? [{ id: 'updated' }]),
            });
          },
        }),
      }),
    };
    return { dbService: { db } as never, updates };
  }

  function row(id: string) {
    return {
      id,
      userId: `user-${id}`,
      fileUrl: `https://s3/${id}.jpg`,
      metadata: null,
      email: 'a@b.c',
      username: '홍길동',
    };
  }

  function makeService(opts: {
    rows: unknown[];
    read: jest.Mock;
    verify?: jest.Mock;
    autoApprove?: boolean;
    returningRows?: { id: string }[][];
  }) {
    const { dbService, updates } = makeDb(opts.rows, opts.returningRows);
    const publishEvent = jest.fn();
    const service = new BusinessLicenseAutoReviewService(
      dbService,
      {
        get: (key: string) => (key === 'BUSINESS_LICENSE_AUTO_APPROVE' && opts.autoApprove ? 'true' : undefined),
      } as never,
      { verifyWithNts: opts.verify ?? jest.fn().mockResolvedValue(approvedNts) } as never,
      { isConfigured: () => true, read: opts.read } as never,
      { publishEvent } as never,
    );
    return { service, updates, publishEvent };
  }

  it('dry-run 이면 승인 판정이어도 상태는 안 바꾸고 기록만 남긴다', async () => {
    const { service, updates, publishEvent } = makeService({
      rows: [row('a')],
      read: jest.fn().mockResolvedValue(reading()),
    });

    await service.reviewFileSubmissions();

    expect(updates).toHaveLength(1);
    expect(updates[0].values.status).toBeUndefined();
    expect(updates[0].values.metadata).toMatchObject({ autoReview: { decision: 'approve', dryRun: true } });
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('자동 승인이 켜져 있으면 번호·대표자명을 채워 승인하고 이벤트를 쏜다', async () => {
    const { service, updates, publishEvent } = makeService({
      rows: [row('a')],
      read: jest.fn().mockResolvedValue(reading()),
      autoApprove: true,
    });

    await service.reviewFileSubmissions();

    expect(updates[0].values).toMatchObject({
      status: 'approved',
      businessNumber: VALID_NO,
      representativeName: '홍길동',
    });
    const { sql, params } = new PgDialect().sqlToQuery(updates[0].predicate);
    expect(sql).toMatch(/"business_licenses"\."status" = \$\d/);
    expect(params).toEqual(expect.arrayContaining(['a', 'under_review']));
    expect(publishEvent).toHaveBeenCalledTimes(1);
  });

  it('UPDATE 가 0행이면 이벤트를 쏘지 않는다 — 그 사이 관리자가 결정했다', async () => {
    const { service, publishEvent } = makeService({
      rows: [row('a')],
      read: jest.fn().mockResolvedValue(reading()),
      autoApprove: true,
      returningRows: [[]],
    });

    await service.reviewFileSubmissions();

    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('국세청 불일치면 승인하지 않고 사유를 남긴다', async () => {
    const { service, updates, publishEvent } = makeService({
      rows: [row('a')],
      read: jest.fn().mockResolvedValue(reading()),
      verify: jest.fn().mockResolvedValue({ valid: false, status: 'not_found', checkedAt: 'now' }),
      autoApprove: true,
    });

    await service.reviewFileSubmissions();

    expect(updates[0].values.status).toBeUndefined();
    expect(updates[0].values.metadata).toMatchObject({ autoReview: { decision: 'manual', reason: 'nts_mismatch' } });
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('국세청 조회 실패나 판독 장애는 기록하지 않는다 — 다음 주기에 다시 본다', async () => {
    const { service, updates } = makeService({
      rows: [row('nts-down'), row('ai-down')],
      read: jest.fn().mockResolvedValueOnce(reading()).mockRejectedValueOnce(new Error('overloaded')),
      verify: jest.fn().mockResolvedValue({ valid: false, status: 'lookup_failed', checkedAt: 'now' }),
      autoApprove: true,
    });

    await service.reviewFileSubmissions();

    expect(updates).toHaveLength(0);
  });

  it('이미지를 못 읽는 요청 오류는 image_unavailable 로 남긴다', async () => {
    const badRequest = new Anthropic.BadRequestError(400, undefined, 'bad image', new Headers());
    const { service, updates } = makeService({
      rows: [row('a')],
      read: jest.fn().mockRejectedValue(badRequest),
    });

    await service.reviewFileSubmissions();

    expect(updates[0].values.metadata).toMatchObject({
      autoReview: { decision: 'manual', reason: 'image_unavailable' },
    });
  });
});
