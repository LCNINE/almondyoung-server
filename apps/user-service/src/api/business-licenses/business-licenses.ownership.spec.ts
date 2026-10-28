import { HttpService } from '@nestjs/axios';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { of } from 'rxjs';
import { BusinessLicensesService } from './business-licenses.service';

const validateOk = {
  status_code: 'OK',
  data: [{ b_no: '3822900179', valid: '01', status: { b_stt_cd: '01' } }],
};

function makeService(ownRow: { id: string; userId: string } | undefined) {
  const where = jest.fn().mockResolvedValue(undefined);
  const set = jest.fn().mockReturnValue({ where });
  const update = jest.fn().mockReturnValue({ set });
  const db = {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(ownRow ? [ownRow] : []) }) }),
    }),
    update,
  };

  const service = new BusinessLicensesService(
    { db } as never,
    { post: jest.fn().mockReturnValue(of({ data: validateOk })) } as unknown as HttpService,
    { get: () => 'test-key' } as never,
    { publishEvent: jest.fn() } as never,
  );
  return { service, update, where };
}

function rendered(condition: SQL): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(condition);
}

const fileUpdate = { fileUrl: 'https://files.example/license.png' };
const directUpdate = { businessNumber: '3822900179', representativeName: '전성구', startDate: '19941024' };

describe('사업자 등록 정보 수정 대상', () => {
  it.each([
    ['파일 첨부', fileUpdate],
    ['직접 입력', directUpdate],
  ])('본인 사업자 등록 정보는 본인 조건을 걸어 수정한다 (%s)', async (_, dto) => {
    const { service, update, where } = makeService({ id: 'license-1', userId: 'user-1' });

    await service.updateBusinessLicenseByBusinessId('license-1', dto as never, 'user-1');

    expect(update).toHaveBeenCalledTimes(1);
    const { sql, params } = rendered(where.mock.calls[0][0]);
    expect(sql).toContain('"user_id"');
    expect(params).toEqual(expect.arrayContaining(['license-1', 'user-1']));
  });

  it('경로의 id 가 본인 것이 아니면 수정하지 않는다', async () => {
    const { service, update } = makeService({ id: 'license-1', userId: 'user-1' });

    await expect(service.updateBusinessLicenseByBusinessId('license-2', fileUpdate as never, 'user-1')).rejects.toThrow(
      '사업자 등록 정보를 수정하는 중 오류가 발생했습니다.',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('본인 등록 정보가 없으면 수정하지 않는다', async () => {
    const { service, update } = makeService(undefined);

    await expect(service.updateBusinessLicenseByBusinessId('license-2', fileUpdate as never, 'user-1')).rejects.toThrow(
      '사업자 등록 정보를 수정하는 중 오류가 발생했습니다.',
    );
    expect(update).not.toHaveBeenCalled();
  });
});
