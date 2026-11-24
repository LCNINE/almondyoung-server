import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { InjectPublisher, type PublisherFor } from '@app/events';
import { CORE_ORDER_STREAM } from '@packages/event-contracts/streams';
import { and, eq, inArray, isNull, lt, or } from 'drizzle-orm';
import { wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { type PrintOrderRow } from '../schema/print-order.schema';
import { WOWPRESS_STATUS_CANCELLED, type WowpressOrderDetail } from '../wowpress/wowpress.types';

// 고객이 파일을 고쳐 다시 올려야 풀리는 와우프레스 작업상태. 109(에러처리)·128(건수 불일치)은 우리 쪽 일이라 넣지 않는다
export const CUSTOMER_FILE_JOB_ERRORS: ReadonlySet<number> = new Set([
  121, 122, 123, 124, 125, 126, 127, 129, 130, 131,
]);

// 와우프레스는 에러 상태에서 같은 주문번호로 다시 올리면 작업상태를 접수대기(100)로 바꾸고, 새 파일도 틀리면 다시 파일 에러로 바꾼다
// (방울이 답변 2026-11-24). 상태가 바뀔 때마다 콜백이 오므로 그 사이 정상 상태를 보게 된다. 다시 올린 직후 아직 접수대기로 바뀌기 전의
// 옛 에러만 걸러 내면 된다 — 파일 다운로드 재시도(최대 5회, 60초 간격)를 넉넉히 덮는 1시간이다
export const FILE_RESUBMIT_GRACE_MS = 60 * 60_000;

// 고객이 다시 올려야 하는 파일 에러면 그 작업상태, 아니면 null
export function customerFileRejection(
  row: Pick<PrintOrderRow, 'printFileId'>,
  detail: Pick<WowpressOrderDetail, 'ordstat' | 'jobstat'>,
): number | null {
  const { ordstat, jobstat } = detail;
  const rejected = jobstat !== null && CUSTOMER_FILE_JOB_ERRORS.has(jobstat) && ordstat !== WOWPRESS_STATUS_CANCELLED;

  return row.printFileId !== null && rejected ? jobstat : null;
}

@Injectable()
export class PrintFileRejectionManager {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    @InjectPublisher(CORE_ORDER_STREAM)
    private readonly coreOrders: PublisherFor<typeof CORE_ORDER_STREAM>,
  ) {}

  // 와우프레스 주문상세를 읽을 때마다 부른다. 보드 기록(lastError)과 따로 와우프레스의 지금 상태만 본다
  async observe(
    row: PrintOrderRow,
    detail: Pick<WowpressOrderDetail, 'ordstat' | 'jobstat'>,
    now = new Date(),
  ): Promise<void> {
    if (row.printFileId === null) {
      return;
    }

    const jobstat = customerFileRejection(row, detail);
    if (jobstat === null) {
      await this.clear(row);
      return;
    }

    await this.reject(row, jobstat, now);
  }

  // 표시가 없고, 새 파일을 넘긴 적이 없거나 넘긴 지 오래됐을 때만 찍는다. 콜백과 폴러가 동시에 와도 한 쪽만 찍고 알린다
  private async reject(row: PrintOrderRow, jobstat: number, now: Date): Promise<void> {
    const t = wmsTables.printOrders;
    const lines = wmsTables.salesOrderLines;
    const orders = wmsTables.salesOrders;
    const graceEnded = new Date(now.getTime() - FILE_RESUBMIT_GRACE_MS);

    await this.dbService.run(async (trx) => {
      const written = await trx
        .update(t)
        .set({ fileRejectedAt: now, fileRejectedJobstat: jobstat, fileResubmittedAt: null, updatedAt: now })
        .where(
          and(
            eq(t.id, row.id),
            inArray(t.status, ['submitted', 'shipped']),
            isNull(t.fileRejectedAt),
            or(isNull(t.fileResubmittedAt), lt(t.fileResubmittedAt, graceEnded)),
          ),
        )
        .returning({ id: t.id });
      if (written.length === 0) {
        return;
      }

      const [context] = await trx
        .select({
          channelOrderId: orders.channelOrderId,
          customerId: orders.customerId,
          productName: lines.productName,
        })
        .from(lines)
        .innerJoin(orders, eq(orders.id, lines.salesOrderId))
        .where(eq(lines.id, row.salesOrderLineId));
      if (!context?.customerId) {
        return;
      }

      await this.coreOrders.enqueue(
        {
          idempotencyKey: `print-file-rejected:${row.id}:${now.toISOString()}`,
          eventType: 'PrintFileRejected',
          aggregateId: row.salesOrderId,
          partitionKey: row.salesOrderId,
          payload: {
            orderId: row.salesOrderId,
            salesOrderLineId: row.salesOrderLineId,
            channelOrderId: context.channelOrderId,
            customerId: context.customerId,
            productName: context.productName,
            jobstat,
            rejectedAt: now.toISOString(),
          },
        },
        trx,
      );
    });
  }

  // 와우프레스가 파일 에러가 아닌 상태를 보이면 다시 올릴 일도, 재접수를 기다릴 일도 끝났다
  private async clear(row: PrintOrderRow): Promise<void> {
    if (row.fileRejectedAt === null && row.fileResubmittedAt === null) {
      return;
    }

    // 읽은 뒤에 새 거절이 찍혔거나 고객이 다시 올렸으면 그 표시는 이 관찰보다 새것이라 지우지 않는다
    const t = wmsTables.printOrders;
    const same = (column: typeof t.fileRejectedAt | typeof t.fileResubmittedAt, value: Date | null) =>
      value === null ? isNull(column) : eq(column, value);
    await this.dbService.run((trx) =>
      trx
        .update(t)
        .set({ fileRejectedAt: null, fileRejectedJobstat: null, fileResubmittedAt: null, updatedAt: new Date() })
        .where(
          and(
            eq(t.id, row.id),
            same(t.fileRejectedAt, row.fileRejectedAt),
            same(t.fileResubmittedAt, row.fileResubmittedAt),
          ),
        ),
    );
  }
}
