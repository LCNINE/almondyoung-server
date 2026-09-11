import { ReviewsService } from '../reviews.service';
import { ReviewRewardGrantService } from '../../rewards/review-reward-grant.service';
import { EvaluableRule } from '../../rewards/reward-rule.evaluator';
import { DEFAULT_REWARD_CONDITIONS, DEFAULT_REWARD_LIMITS } from '../../rewards/reward-rule.types';
import type { ReviewPermissionProvider } from '../../../review-permissions/types';

type InsertedRow = Record<string, unknown>;

const REVIEW_ID = '11111111-1111-4111-8111-111111111111';
const PERMISSION_ID = '22222222-2222-4222-8222-222222222222';

/**
 * 정액 규칙 하나만 활성. 금액을 보지 않고 지급하는 종류라, 분기가 없으면 «반드시» 지급된다 —
 * 옛 코드와 새 코드가 갈리는 케이스가 이것이다.
 */
function fixedRule(): EvaluableRule & { name: string } {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    name: '정액 500원',
    priority: 0,
    stopOnMatch: true,
    conditions: { ...DEFAULT_REWARD_CONDITIONS },
    reward: { kind: 'POINT_FIXED', amount: 500, expiresInDays: 30 },
    limits: { ...DEFAULT_REWARD_LIMITS },
    startsAt: null,
    endsAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

/** 리뷰 insert 는 행을 돌려주고, 그 밖의 insert(미디어·원장)는 들어온 값만 모은다. */
function makeTx(inserted: InsertedRow[]) {
  return {
    insert: () => ({
      values: (values: InsertedRow) => {
        inserted.push(values);
        return {
          returning: () => Promise.resolve([{ id: REVIEW_ID, productId: 'prod-1' }]),
        };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => Object.assign(Promise.resolve([{ value: 1 }]), { groupBy: () => Promise.resolve([]) }),
      }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
  } as never;
}

function makeService(provider: ReviewPermissionProvider, inserted: InsertedRow[]) {
  const tx = makeTx(inserted);
  const grantService = new ReviewRewardGrantService(
    {} as never,
    {
      getActiveRules: jest.fn().mockResolvedValue([fixedRule()]),
    } as never,
  );

  const permissionService = {
    consume: jest.fn().mockResolvedValue({ id: PERMISSION_ID, orderLineAmount: 20000, provider }),
    linkConsumedReview: jest.fn().mockResolvedValue(undefined),
  };

  const rewardPublisher = { enqueueEarnPointsCommand: jest.fn().mockResolvedValue(undefined) };

  const service = new ReviewsService(
    { db: { transaction: (fn: (tx: never) => unknown) => fn(tx) } } as never,
    permissionService as never,
    grantService,
    rewardPublisher as never,
    { publishReviewStats: jest.fn() } as never,
    { get: () => undefined } as never,
  );

  return { service, rewardPublisher, permissionService, tx };
}

const dto = { productId: 'prod-1', rating: 5, content: '내용'.repeat(20), eligibilityId: PERMISSION_ID } as never;

function ledgerRows(inserted: InsertedRow[]) {
  return inserted.filter((row) => 'status' in row);
}

describe('리뷰 보상은 주문에서 나온 권한에만 나간다', () => {
  it("provider 가 'admin' 이면 정액 규칙이 활성이어도 지급하지 않고 원장에 사유를 남긴다", async () => {
    const inserted: InsertedRow[] = [];
    const { service, rewardPublisher } = makeService('admin', inserted);

    await service.create('user-1', dto);

    expect(rewardPublisher.enqueueEarnPointsCommand).not.toHaveBeenCalled();
    expect(ledgerRows(inserted)).toEqual([
      expect.objectContaining({
        status: 'SKIPPED',
        skipReason: 'NON_ORDER_PROVIDER',
        amount: 0,
        ruleId: null,
        trigger: 'ON_REVIEW_CREATED',
      }),
    ]);
  });

  it("provider 가 'order' 면 이전과 같이 지급하고 적립 명령을 적재한다", async () => {
    const inserted: InsertedRow[] = [];
    const { service, rewardPublisher } = makeService('order', inserted);

    await service.create('user-1', dto);

    expect(ledgerRows(inserted)).toEqual([
      expect.objectContaining({ status: 'GRANTED', amount: 500, rewardKind: 'POINT_FIXED' }),
    ]);
    expect(rewardPublisher.enqueueEarnPointsCommand).toHaveBeenCalledTimes(1);
  });

  it('새 사유는 원장 컬럼 길이(40)를 넘지 않는다', () => {
    expect('NON_ORDER_PROVIDER'.length).toBeLessThanOrEqual(40);
  });
});

/**
 * 자격 소비를 «선점 UPDATE» 로 앞당기면서 `create` 안의 순서가 바뀌었다. 원장에는 지급으로
 * 남았는데 적립 명령만 유실되는 창을 다시 열지 않도록, 「전부 같은 트랜잭션」을 못 박는다.
 */
describe('리뷰 작성은 자격 선점부터 적립 명령 적재까지 한 트랜잭션이다', () => {
  it('자격 선점 · 리뷰 참조 연결 · 적립 명령 적재가 모두 같은 tx 를 받는다', async () => {
    const inserted: InsertedRow[] = [];
    const { service, rewardPublisher, permissionService, tx } = makeService('order', inserted);

    await service.create('user-1', dto);

    expect(permissionService.consume).toHaveBeenCalledWith(expect.anything(), tx);
    expect(permissionService.linkConsumedReview).toHaveBeenCalledWith(PERMISSION_ID, REVIEW_ID, tx);
    expect(rewardPublisher.enqueueEarnPointsCommand).toHaveBeenCalledWith(expect.anything(), tx);
  });

  it('자격 선점이 리뷰 insert 보다 «먼저» 일어난다 — 뒤에 온 요청은 리뷰를 만들기 전에 거절된다', async () => {
    const inserted: InsertedRow[] = [];
    const { service, permissionService } = makeService('order', inserted);
    const order: string[] = [];

    permissionService.consume.mockImplementation(() => {
      order.push('consume');
      return Promise.resolve({ id: PERMISSION_ID, orderLineAmount: 20000, provider: 'order' });
    });
    const originalPush = inserted.push.bind(inserted);
    inserted.push = ((row: InsertedRow) => {
      if ('rating' in row) order.push('insert-review');
      return originalPush(row);
    }) as never;

    await service.create('user-1', dto);

    expect(order).toEqual(['consume', 'insert-review']);
  });
});
