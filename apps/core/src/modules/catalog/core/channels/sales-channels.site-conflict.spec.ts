import { ConflictError } from '@app/shared';
import type { DbService } from '@app/db';
import { SalesChannelsService } from './sales-channels.service';
import type { PimSchema } from '../../schema/catalog.schema';
import { SALES_CHANNEL_SITE_UNIQUE_INDEX } from '../../schema/catalog.schema';
import type { DbTransaction } from '../../catalog.types';

/**
 * site 유일성은 DB 가 지킨다 (#668 항목 1) — 읽고-쓰는 사전 검사는 동시 생성 두 건이 나란히
 * 통과하므로 방어가 안 된다. 대신 그 위반이 **409 로 나가야** 한다. 그냥 두면 drizzle 이
 * 감싼 `DrizzleQueryError` 가 전역 필터까지 올라가 500 이 되고, 운영자는 "저장이 안 된다"만
 * 보게 된다.
 */
describe('판매채널 site 중복은 409 다 (#668)', () => {
  const siteViolation = () =>
    Object.assign(new Error('Failed query'), {
      cause: {
        code: '23505',
        constraint_name: SALES_CHANNEL_SITE_UNIQUE_INDEX,
      },
    });

  /** 쓰기 한 단계만 실패시키는 최소 더블. 나머지 체인은 서비스가 건드리지 않는다. */
  function serviceWhereWriteRejects(error: Error): SalesChannelsService {
    const rejecting = { returning: () => Promise.reject(error) };
    const tx = {
      insert: () => ({ values: () => rejecting }),
      update: () => ({ set: () => ({ where: () => rejecting }) }),
    } as unknown as DbTransaction;

    const db = {
      db: tx,
      run: <T>(fn: (t: DbTransaction) => Promise<T>): Promise<T> => fn(tx),
    } as unknown as DbService<PimSchema>;

    return new SalesChannelsService(db);
  }

  it('생성이 site 중복이면 ConflictError 를 던진다', async () => {
    const service = serviceWhereWriteRejects(siteViolation());

    await expect(service.createChannel({ site: 'naver', name: '네이버 스마트스토어' })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('수정이 site 중복이면 ConflictError 를 던진다', async () => {
    const service = serviceWhereWriteRejects(siteViolation());

    await expect(
      service.updateChannel('11111111-1111-1111-1111-111111111111', { site: 'naver' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('site 중복이 아닌 실패는 그대로 올려보낸다', async () => {
    const other = Object.assign(new Error('Failed query'), { cause: { code: '23503' } });
    const service = serviceWhereWriteRejects(other);

    await expect(service.createChannel({ site: 'naver', name: '네이버' })).rejects.toBe(other);
  });
});
