import { ConflictError } from '@app/shared';
import { WarehouseReader } from './warehouse.reader';

/** select().from().where().orderBy().limit() 체인을 흉내내고 마지막에 rows 를 돌려준다. */
function fakeDbService(rows: Array<{ id: string }>) {
  const limit = jest.fn().mockResolvedValue(rows);
  const trx = {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          orderBy: jest.fn(() => ({ limit })),
        })),
      })),
    })),
  };
  return {
    dbService: { run: jest.fn((fn: (executor: typeof trx) => unknown) => fn(trx)) },
    limit,
  };
}

describe('WarehouseReader.getDefaultId', () => {
  // 하드코딩 상수를 반환하던 옛 구현은 실운영 창고(019d0001-…)가 아니라 부팅이 만든
  // 껍데기(00000000-…0001)를 가리켰다. 그 결과 이행 오더가 재고 0 창고로 생성됐다.
  it('판매 창고의 id 를 반환한다', async () => {
    const { dbService } = fakeDbService([{ id: 'bucheon-warehouse' }]);
    const reader = new WarehouseReader(dbService as never);

    await expect(reader.getDefaultId()).resolves.toBe('bucheon-warehouse');
  });

  // 판매 창고가 없으면 어느 창고를 골라도 틀린다. 조용히 아무거나 고르는 대신 던져서
  // 백로그가 failed 로 적체되게 둔다 — 시드/설정이 끝나면 재시도가 자연히 복구한다.
  it('판매 창고가 없으면 던진다', async () => {
    const { dbService } = fakeDbService([]);
    const reader = new WarehouseReader(dbService as never);

    await expect(reader.getDefaultId()).rejects.toThrow(ConflictError);
  });

  // 가드 두 개가 "정확히 하나" 를 보장하지만 통합 픽스처는 직접 INSERT 라 그 불변식
  // 밖이다. 정렬이 없으면 어느 행이 오는지 계획에 따라 갈려 스펙이 흔들린다.
  it('정렬·limit 으로 결정적으로 한 건만 읽는다', async () => {
    const { dbService, limit } = fakeDbService([{ id: 'first' }, { id: 'second' }]);
    const reader = new WarehouseReader(dbService as never);

    await expect(reader.getDefaultId()).resolves.toBe('first');
    expect(limit).toHaveBeenCalledWith(1);
  });
});
