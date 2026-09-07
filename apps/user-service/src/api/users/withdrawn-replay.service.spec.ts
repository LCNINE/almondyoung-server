import { PgDialect } from 'drizzle-orm/pg-core';
import { WithdrawnReplayService, withdrawnUsersSelection } from './withdrawn-replay.service';

function createDbMock(rows: Array<{ id: string }>) {
  const captured: { where?: unknown; limit?: number } = {};
  const limit = jest.fn((n: number) => {
    captured.limit = n;
    return Promise.resolve(rows);
  });
  const orderBy = jest.fn(() => ({ limit }));
  const where = jest.fn((condition: unknown) => {
    captured.where = condition;
    return { orderBy };
  });
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));
  return { db: { select }, captured };
}

describe('WithdrawnReplayService (#786 백필)', () => {
  const A = '00000000-0000-4000-8000-00000000000a';
  const B = '00000000-0000-4000-8000-00000000000b';

  function createService(rows: Array<{ id: string }>) {
    const dbMock = createDbMock(rows);
    const publisher = { publishEvent: jest.fn().mockResolvedValue(undefined) };
    const service = new WithdrawnReplayService({ db: dbMock.db } as any, publisher as any);
    return { service, publisher, dbMock };
  }

  it('dryRun 이면 건수와 id 만 돌려주고 아무것도 발행하지 않는다', async () => {
    const { service, publisher } = createService([{ id: A }, { id: B }]);

    const result = await service.replay({ dryRun: true });

    expect(result).toEqual({ matched: 2, published: 0, lastUserId: B, failedUserId: null, userIds: [A, B] });
    expect(publisher.publishEvent).not.toHaveBeenCalled();
  });

  it('dryRun 이 아니면 행마다 UserDeleted 를 발행한다 — softDeleteUser 와 같은 모양', async () => {
    const { service, publisher } = createService([{ id: A }, { id: B }]);

    const result = await service.replay({ dryRun: false });

    expect(publisher.publishEvent).toHaveBeenCalledTimes(2);
    expect(publisher.publishEvent).toHaveBeenNthCalledWith(1, {
      eventType: 'UserDeleted',
      aggregateId: A,
      payload: { userId: A },
    });
    expect(result).toEqual({ matched: 2, published: 2, lastUserId: B, failedUserId: null, userIds: [A, B] });
  });

  it('행이 없으면 lastUserId 는 null', async () => {
    const { service } = createService([]);
    expect(await service.replay({ dryRun: true })).toEqual({
      matched: 0,
      published: 0,
      lastUserId: null,
      failedUserId: null,
      userIds: [],
    });
  });

  it('발행 실패는 루프를 멈추고 실패 지점을 보고한다 — 던지지 않는다', async () => {
    const dbMock = createDbMock([{ id: A }, { id: B }]);
    const publisher = {
      publishEvent: jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('kafka down')),
    };
    const service = new WithdrawnReplayService({ db: dbMock.db } as any, publisher as any);

    const result = await service.replay({ dryRun: false });

    expect(publisher.publishEvent).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ matched: 2, published: 1, lastUserId: A, failedUserId: B, userIds: [A, B] });
  });

  it('limit 은 기본 200, 상한 1000', async () => {
    const { service, dbMock } = createService([]);
    await service.replay({ dryRun: true });
    expect(dbMock.captured.limit).toBe(200);
    await service.replay({ dryRun: true, limit: 5000 });
    expect(dbMock.captured.limit).toBe(1000);
  });

  /** drizzle 조건식을 SQL 문자열로 렌더한다. 조건이 둘 다인지는 렌더된 SQL 로만 단정할 수 있다 (inbox-worker.service.spec 의 renderSql 과 같은 기법). */
  const render = (afterUserId?: string) => new PgDialect().sqlToQuery(withdrawnUsersSelection(afterUserId)).sql;

  it('선택 조건은 deleted_at 과 치환 이메일 마커 둘 다다 — deleted_at 만으로 고르면 휴면 회원이 익명화된다', () => {
    const sql = render();
    expect(sql).toMatch(/"deleted_at" is not null/);
    expect(sql).toMatch(/"email" like/);
    // LIKE 의 `_` 는 와일드카드라 이스케이프해야 한다 — 이스케이프된 리터럴은 `.sql` 이 아니라
    // 바인딩 파라미터(`.params`)에 실린다. 여기 쓴 JS 리터럴의 `\\` 는 런타임엔 백슬래시 한 글자다.
    expect(new PgDialect().sqlToQuery(withdrawnUsersSelection()).params).toContain('withdrawn\\_%@deleted.invalid');
  });

  it('afterUserId 커서가 있으면 id > 커서 조건이 붙는다', () => {
    expect(render(A)).toMatch(/"id" > /);
    expect(render()).not.toMatch(/"id" > /);
  });
});
