import { BadRequestException } from '@nestjs/common';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import { recordSalesOrderCancellation } from '../cancellation-record/record-cancellation';
import { seedCancellableOrder, wireCancellation } from '../cancellation-record/__support__/cancellation-scenarios';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/**
 * 취소 엔진의 «이미 취소된 수량»은 라인 수량 문(`readLineQuantities().canceled`)에서 읽는다 (K6 PR2a).
 * 옛 파서는 partial 취소의 `metadata.cancelledLines` 만 셌다 — 전체취소도 세게 되면서 거절 순서·문구가 바뀌지 않는지 고정한다.
 */
describeIfDb('SalesOrdersService 취소 엔진 — 이미 취소된 수량 읽기 (K6 PR2a)', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  it('plan after a full cancellation keeps the full-exists message', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const o = await seedCancellableOrder(tx, w, 2);
      // 판매주문 status 는 그대로 두고 전체취소 «기록»만 남긴다 — V2 전체 + 남은 출고분처럼 SO 가 cancelled 가 아닌 상태.
      await recordSalesOrderCancellation(tx, {
        salesOrderId: o.salesOrderId,
        cancellationScope: 'full',
        cancelledBy: 'naver',
      });

      const planning = w.salesOrders.planCancellation(o.salesOrderId, undefined, tx);

      await expect(planning).rejects.toThrow(BadRequestException);
      await expect(planning).rejects.toThrow('이미 전체 취소 처리된 주문입니다.');
    });
  });

  it('partial remaining counts every prior cancellation', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const o = await seedCancellableOrder(tx, w, 3);
      await w.salesOrders.cancel(
        o.salesOrderId,
        { lines: [{ salesOrderLineId: o.lineId, quantity: 2 }], cancelledBy: 'naver' },
        tx,
      );

      const request = [{ salesOrderLineId: o.lineId, quantity: 2 }];
      const message = '취소 수량(2개)이 취소 가능 수량(1개)을 초과합니다.';
      const planning = w.salesOrders.planCancellation(o.salesOrderId, request, tx);
      await expect(planning).rejects.toThrow(BadRequestException);
      await expect(planning).rejects.toThrow(message);
      await expect(w.salesOrders.cancel(o.salesOrderId, { lines: request, cancelledBy: 'naver' }, tx)).rejects.toThrow(
        message,
      );
    });
  });
});
