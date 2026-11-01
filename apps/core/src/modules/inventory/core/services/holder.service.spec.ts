import { Logger } from '@nestjs/common';
import type { DatabaseRun } from '@app/db';
import { singleDatabase } from '@app/db/testing/single-database';
import { HOLDER_CONSTANTS } from '../constants/holder.constants';
import { HolderService } from './holder.service';

/** select 결과(`existing`)와 insert 된 값을 기록하는 가짜 트랜잭션. */
function fakeTrx(existing: unknown[]) {
  const inserted: unknown[] = [];
  const trx = {
    select: jest.fn(() => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(existing) }) }),
    })),
    insert: jest.fn(() => ({
      values: (v: unknown) => {
        inserted.push(v);
        return Promise.resolve();
      },
    })),
  };
  return { trx, inserted };
}

describe('HolderService.ensureDefaultHolder', () => {
  // 한 테넌트 DB 안의 작업이다 — 받은 트랜잭션 밖(주입된 기본 DB)으로 새면 테넌트마다 불러도 한 DB 에만 쓴다.
  it('받은 트랜잭션 안에서 기본 보유자가 없으면 넣는다', async () => {
    const ambient = fakeTrx([]);
    const given = fakeTrx([]);
    const dbService = { run: jest.fn((fn: (t: unknown) => unknown, tx?: unknown) => fn(tx ?? ambient.trx)) };
    const service = new HolderService(dbService as never);

    await service.ensureDefaultHolder(given.trx as never);

    expect(given.inserted).toEqual([
      { id: '019d0001-0000-7000-a000-000000000001', name: '기본 보유자', isOurAsset: true },
    ]);
    expect(ambient.trx.select).not.toHaveBeenCalled();
    expect(ambient.trx.insert).not.toHaveBeenCalled();
  });

  it('이미 있으면 아무것도 넣지 않는다', async () => {
    const given = fakeTrx([{ id: HOLDER_CONSTANTS.DEFAULT_HOLDER.id }]);
    const dbService = { run: jest.fn((fn: (t: unknown) => unknown, tx?: unknown) => fn(tx)) };

    await new HolderService(dbService as never).ensureDefaultHolder(given.trx as never);

    expect(given.inserted).toEqual([]);
  });

  // 오늘의 부팅 동작 그대로: 보유자 보장이 실패해도 core 는 뜬다(로그만 남긴다).
  it('부팅 훅은 실패를 삼킨다', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const dbService = singleDatabase({ run: jest.fn().mockRejectedValue(new Error('db down')) });

    await expect(new HolderService(dbService as never).onModuleInit()).resolves.toBeUndefined();
  });

  it('부팅 훅은 테넌트 DB 마다 그 맥락에서 보장한다 — 한 DB 의 실패가 다른 DB 를 막지 않는다', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    let current = '';
    const insertedBy: string[] = [];
    const dbService = {
      run: jest.fn((fn: (t: unknown) => unknown) => {
        if (current === '1') return Promise.reject(new Error('tenant 1 DB 깨짐'));
        const { trx } = fakeTrx([]);
        trx.insert.mockImplementation(() => ({
          values: () => {
            insertedBy.push(current);
            return Promise.resolve();
          },
        }));
        return fn(trx);
      }),
      forEachDatabase: async <R>(fn: (key: string) => Promise<R>): Promise<DatabaseRun<R>[]> => {
        const runs: DatabaseRun<R>[] = [];
        for (const key of ['1', '2']) {
          current = key;
          try {
            runs.push({ key, ok: true, value: await fn(key) });
          } catch (error) {
            runs.push({ key, ok: false, error });
          }
        }
        return runs;
      },
    };

    await expect(new HolderService(dbService as never).onModuleInit()).resolves.toBeUndefined();

    expect(insertedBy).toEqual(['2']);
  });
});
