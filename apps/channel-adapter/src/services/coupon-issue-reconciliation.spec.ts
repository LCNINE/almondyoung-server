import { CouponIssueReconciliationService } from './coupon-issue-reconciliation.service';
import type { MedusaClient } from '../adapters/medusa/medusa.client';
import type { DbService } from '@app/db';
import type { ChannelAdapterSchema } from '../types';

function makeDb(opts: { revived?: { id: string }[]; backlog?: { eventType: string; count: number }[] }) {
  const returning = jest.fn().mockResolvedValue(opts.revived ?? []);
  const updateWhere = jest.fn().mockReturnValue({ returning });
  const set = jest.fn().mockReturnValue({ where: updateWhere });
  const update = jest.fn().mockReturnValue({ set });

  const groupBy = jest.fn().mockResolvedValue(opts.backlog ?? []);
  const selectWhere = jest.fn().mockReturnValue({ groupBy });
  const from = jest.fn().mockReturnValue({ where: selectWhere });
  const select = jest.fn().mockReturnValue({ from });

  return {
    db: { update, select },
    calls: { update, set, updateWhere, returning, select, groupBy },
  };
}

describe('CouponIssueReconciliationService.sweepRecentFailures', () => {
  const medusaClient = {} as MedusaClient;

  const makeService = (db: ReturnType<typeof makeDb>) =>
    new CouponIssueReconciliationService(
      { db: db.db } as unknown as DbService<ChannelAdapterSchema>,
      medusaClient,
    );

  it('되살릴 때 재시도 상태를 전부 초기화하고 마커를 남긴다', async () => {
    const db = makeDb({ revived: [{ id: 'e1' }] });

    await makeService(db).sweepRecentFailures();

    expect(db.calls.set).toHaveBeenCalledTimes(1);
    const patch = db.calls.set.mock.calls[0][0];
    expect(patch.status).toBe('pending');
    expect(patch.attempts).toBe(0);
    expect(patch.errorMessage).toBeNull();
    // failedAt 을 안 지우면 다음 회차의 lookback 창 계산이 옛 시각을 본다.
    expect(patch.failedAt).toBeNull();
    // 마커가 없으면 이 크론은 15분마다 같은 행을 영원히 되살린다.
    expect(patch.metadata).toBeDefined();
  });

  it('되살린 게 없어도 백로그 게이지는 갱신한다', async () => {
    const db = makeDb({ revived: [], backlog: [] });

    await makeService(db).sweepRecentFailures();

    // 게이지를 «되살린 게 있을 때만» 갱신하면 해소된 뒤에도 옛 값이 남아 알림이 안 꺼진다.
    expect(db.calls.groupBy).toHaveBeenCalledTimes(1);
  });
});
