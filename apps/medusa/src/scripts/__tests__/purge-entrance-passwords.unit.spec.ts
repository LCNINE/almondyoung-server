/**
 * 파기 스크립트 두 벌(스케줄 TTL·일회성 전량)이 **주문과 카트를 모두** 훑는지 고정한다.
 *
 * 카트가 빠져 있던 것이 최종 리뷰가 잡은 Critical 이다 — 체크아웃은
 * `cart.metadata.entrance_password` 를 먼저 쓰고 `complete-cart` 가 그걸 주문으로 복사하므로,
 * 주문만 파기하면 모든 주문의 비번이 카트에 영구 쌍둥이로 남는다(+ 메모 단계까지 갔다가
 * 버려진 카트 전부).
 *
 * 컨테이너를 가짜로 세운다 — 실제 Medusa 컨테이너를 띄우면 DB 가 딸려와 유닛 게이트에서
 * 못 돌린다. 여기서 확인하려는 건 "두 테이블을 모두 훑고, 값이 아니라 id 만 들고 다닌다"는
 * 배선이지 SQL 실행 결과가 아니다.
 */
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import {
  ENTRANCE_PASSWORD_CANDIDATE_SQL,
  ENTRANCE_PASSWORD_CART_CANDIDATE_SQL,
  ENTRANCE_PASSWORD_CART_COUNT_SQL,
  ENTRANCE_PASSWORD_COUNT_SQL,
  PURGE_ALL_CONFIRM_TOKEN,
} from '../lib/entrance-password-purge';
import purgeAllEntrancePasswords from '../purge-all-entrance-passwords';
import purgeExpiredEntrancePasswords from '../purge-expired-entrance-passwords';

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRED_AT = new Date(Date.now() - 20 * DAY_MS);
const FRESH_AT = new Date();

type RawRows = { rows: unknown[] };

function makeContainer(rowsBySql: Map<string, unknown[]>) {
  const logs: string[] = [];
  const updateOrders = jest.fn(() => Promise.resolve([]));
  const updateCarts = jest.fn(() => Promise.resolve([]));

  const knex = {
    raw: jest.fn((sql: string): Promise<RawRows> => Promise.resolve({ rows: rowsBySql.get(sql) ?? [] })),
  };

  const registry: Record<string, unknown> = {
    [ContainerRegistrationKeys.LOGGER]: {
      info: (message: string) => logs.push(message),
      warn: (message: string) => logs.push(message),
      error: (message: string) => logs.push(message),
    },
    [ContainerRegistrationKeys.PG_CONNECTION]: knex,
    [Modules.ORDER]: { updateOrders },
    [Modules.CART]: { updateCarts },
  };

  const container = {
    resolve: (key: string) => registry[key],
  } as never;

  return { container, logs, updateOrders, updateCarts, knex };
}

describe('purgeExpiredEntrancePasswords (스케줄 TTL)', () => {
  it('주문과 카트 양쪽에서 만료분을 지운다', async () => {
    const { container, updateOrders, updateCarts } = makeContainer(
      new Map<string, unknown[]>([
        [
          ENTRANCE_PASSWORD_CANDIDATE_SQL,
          [
            { id: 'order_old', created_at: EXPIRED_AT },
            { id: 'order_fresh', created_at: FRESH_AT },
          ],
        ],
        [
          ENTRANCE_PASSWORD_CART_CANDIDATE_SQL,
          [
            { id: 'cart_old', created_at: EXPIRED_AT },
            { id: 'cart_fresh', created_at: FRESH_AT },
          ],
        ],
      ]),
    );

    const result = await purgeExpiredEntrancePasswords({ container, args: [] });

    expect(updateOrders).toHaveBeenCalledWith([{ id: 'order_old', metadata: { entrance_password: '' } }]);
    expect(updateCarts).toHaveBeenCalledWith([{ id: 'cart_old', metadata: { entrance_password: '' } }]);
    expect(result).toEqual({ purgedOrders: 1, holdingOrders: 2, purgedCarts: 1, holdingCarts: 2 });
  });

  it('만료분이 한쪽에만 있으면 다른 쪽 update 는 아예 부르지 않는다', async () => {
    const { container, updateOrders, updateCarts } = makeContainer(
      new Map<string, unknown[]>([
        [ENTRANCE_PASSWORD_CANDIDATE_SQL, [{ id: 'order_fresh', created_at: FRESH_AT }]],
        [ENTRANCE_PASSWORD_CART_CANDIDATE_SQL, [{ id: 'cart_old', created_at: EXPIRED_AT }]],
      ]),
    );

    const result = await purgeExpiredEntrancePasswords({ container, args: [] });

    expect(updateOrders).not.toHaveBeenCalled();
    expect(updateCarts).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ purgedOrders: 0, holdingOrders: 1, purgedCarts: 1, holdingCarts: 1 });
  });
});

describe('purgeAllEntrancePasswords (일회성 전량)', () => {
  const counts = (total: number, expired: number) => [{ total, expired }];

  it('기본은 dry run 이고, 주문과 카트 건수를 따로 보고한다', async () => {
    const { container, logs, updateOrders, updateCarts } = makeContainer(
      new Map<string, unknown[]>([
        [ENTRANCE_PASSWORD_COUNT_SQL, counts(7, 3)],
        [ENTRANCE_PASSWORD_CART_COUNT_SQL, counts(11, 4)],
      ]),
    );

    const result = await purgeAllEntrancePasswords({ container, args: [] });

    expect(result).toMatchObject({
      dryRun: true,
      orders: { total: 7, expired: 3, withinTtl: 4, purged: 0 },
      carts: { total: 11, expired: 4, withinTtl: 7, purged: 0 },
    });
    expect(updateOrders).not.toHaveBeenCalled();
    expect(updateCarts).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('DRY RUN');
    expect(logs.join('\n')).toContain('카트');
  });

  it('확인 토큰을 주면 주문과 카트를 나이와 무관하게 전량 파기한다', async () => {
    const rows = new Map<string, unknown[]>([
      [ENTRANCE_PASSWORD_COUNT_SQL, counts(1, 0)],
      [ENTRANCE_PASSWORD_CART_COUNT_SQL, counts(1, 0)],
      [ENTRANCE_PASSWORD_CANDIDATE_SQL, [{ id: 'order_fresh', created_at: FRESH_AT }]],
      [ENTRANCE_PASSWORD_CART_CANDIDATE_SQL, [{ id: 'cart_fresh', created_at: FRESH_AT }]],
    ]);
    const { container, updateOrders, updateCarts, knex } = makeContainer(rows);
    // 파기가 반영되면 후보가 사라진다 — 그걸 흉내내야 페이지 루프가 끝난다.
    updateOrders.mockImplementation(() => {
      rows.set(ENTRANCE_PASSWORD_CANDIDATE_SQL, []);
      rows.set(ENTRANCE_PASSWORD_COUNT_SQL, counts(0, 0));
      return Promise.resolve([]);
    });
    updateCarts.mockImplementation(() => {
      rows.set(ENTRANCE_PASSWORD_CART_CANDIDATE_SQL, []);
      rows.set(ENTRANCE_PASSWORD_CART_COUNT_SQL, counts(0, 0));
      return Promise.resolve([]);
    });

    const result = await purgeAllEntrancePasswords({
      container,
      args: [`--confirm=${PURGE_ALL_CONFIRM_TOKEN}`],
    });

    expect(updateOrders).toHaveBeenCalledWith([{ id: 'order_fresh', metadata: { entrance_password: '' } }]);
    expect(updateCarts).toHaveBeenCalledWith([{ id: 'cart_fresh', metadata: { entrance_password: '' } }]);
    expect(result).toMatchObject({
      dryRun: false,
      orders: { purged: 1, remaining: 0 },
      carts: { purged: 1, remaining: 0 },
    });
    // 카트 쪽 SQL 을 실제로 쐈는지 — "카트도 센다"는 주장이 조회 없이 참이 되면 안 된다.
    expect(knex.raw.mock.calls.map(([sql]) => sql)).toContain(ENTRANCE_PASSWORD_CART_CANDIDATE_SQL);
  });
});
