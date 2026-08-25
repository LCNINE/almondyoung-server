import { HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { BusinessLicensesService } from './business-licenses.service';
import { BusinessLicenseException } from './exceptions/business.exceptions';

/**
 * 중복 등록 시 drizzle 의 실패 SQL 원문이 그대로 사용자에게 노출되던 결함을 막는다.
 * 2026-08-25 로컬 재현: 화면에 `Failed query: insert into "business_licenses" (...) values (...)`
 * 가 테이블·컬럼·입력값째로 찍혔다.
 */
const validateOk = {
  status_code: 'OK',
  data: [{ b_no: '3822900179', valid: '01', status: { b_stt_cd: '01' } }],
};

/** 국세청이 명시적으로 "일치하지 않는다" 고 답한 응답 */
const validateMismatch = {
  status_code: 'OK',
  data: [{ b_no: '3822900179', valid: '02', valid_msg: '확인할 수 없습니다.' }],
};

function makeService(insertError: unknown, existingRow: unknown = undefined, ntsResponse = validateOk) {
  const db = {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(existingRow ? [existingRow] : []) }) }),
    }),
    insert: () => ({
      values: () => Promise.reject(insertError),
    }),
  };

  return new BusinessLicensesService(
    { db } as never,
    { post: jest.fn().mockReturnValue(of({ data: ntsResponse })) } as unknown as HttpService,
    { get: () => 'test-key' } as never,
    { publishEvent: jest.fn() } as never,
  );
}

function uniqueViolation(constraint: string) {
  const err = new Error(
    `Failed query: insert into "business_licenses" ("id", "user_id", "business_number") values (...)`,
  );
  (err as unknown as { cause: unknown }).cause = { code: '23505', constraint_name: constraint };
  return err;
}

const dto = { businessNumber: '3822900179', representativeName: '전성구', startDate: '19941024' };

describe('사업자 등록 중복 처리', () => {
  it('다른 계정이 쓰는 사업자번호면 409 로 안내한다', async () => {
    const service = makeService(uniqueViolation('business_licenses_business_number_unique'));

    const error = await service.createBusinessLicense('user-1', dto).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BusinessLicenseException);
    const e = error as BusinessLicenseException;
    expect(e.getHttpStatus()).toBe(HttpStatus.CONFLICT);
    expect(e.message).toContain('이미 등록된 사업자등록번호');
  });

  it('실패한 SQL 원문을 사용자에게 노출하지 않는다', async () => {
    const service = makeService(new Error('Failed query: insert into "business_licenses" ("id", "user_id") values ($1, $2)'));

    const error = (await service.createBusinessLicense('user-1', dto).catch((e: unknown) => e)) as Error;

    expect(error.message).not.toContain('Failed query');
    expect(error.message).not.toContain('insert into');
    expect(error.message).toBe('사업자 등록 정보를 생성하는 중 오류가 발생했습니다.');
  });

  it('이미 본인 등록정보가 있으면 409 를 그대로 유지한다 (400 으로 뭉개지 않는다)', async () => {
    const service = makeService(new Error('unused'), { id: 'existing' });

    const error = await service.createBusinessLicense('user-1', dto).catch((e: unknown) => e);

    expect((error as BusinessLicenseException).getHttpStatus()).toBe(HttpStatus.CONFLICT);
  });
});

describe('국세청 불일치 처리', () => {
  it('불일치면 레코드를 만들지 않고 그 자리에서 돌려보낸다', async () => {
    let inserted = false;
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
      insert: () => ({
        values: () => {
          inserted = true;
          return Promise.resolve();
        },
      }),
    };
    const service = new BusinessLicensesService(
      { db } as never,
      { post: jest.fn().mockReturnValue(of({ data: validateMismatch })) } as unknown as HttpService,
      { get: () => 'test-key' } as never,
      { publishEvent: jest.fn() } as never,
    );

    const error = await service.createBusinessLicense('user-1', dto).catch((e: unknown) => e);

    expect(inserted).toBe(false);
    const e = error as BusinessLicenseException;
    expect(e.getErrorCode()).toBe('BUSINESS_LICENSE_NTS_MISMATCH');
    expect(e.message).toContain('국세청 기록과 일치하지 않습니다');
  });

  it('국세청 장애(lookup_failed)는 막지 않고 심사중으로 접수한다', async () => {
    let insertedStatus: string | undefined;
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
      insert: () => ({
        values: (v: { status: string }) => {
          insertedStatus = v.status;
          return Promise.resolve();
        },
      }),
    };
    const service = new BusinessLicensesService(
      { db } as never,
      { post: jest.fn().mockReturnValue(of({ data: { status_code: 'ERROR' } })) } as unknown as HttpService,
      { get: () => 'test-key' } as never,
      { publishEvent: jest.fn() } as never,
    );

    await service.createBusinessLicense('user-1', dto);

    expect(insertedStatus).toBe('under_review');
  });
});
