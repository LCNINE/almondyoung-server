import { Injectable, Logger } from '@nestjs/common';
import { InjectTypedDb, DbService } from '@app/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { BarcodeService } from '../../inventory/shared/services/barcode.service';
import { resolveSkuIdByBarcode } from '../services/sku-barcode-resolution';
import { ACTIVE_WORK_ITEM_STATUSES } from '../services/work-item-status';
import { RecordableRejection } from './scan-rejection-reasons';

export interface OutboundScanRejectionInput {
  commandType: string;
  shipmentId: string;
  idempotencyKey: string;
  actorId: string;
  barcode: string | null;
  quantity: number | null;
  rejection: RecordableRejection;
  /** 거절된 요청이 시작된 시각 — 그 뒤 반영된 저장이 있으면 막힘이 풀린 것이다. */
  rejectedAt: Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 거절된 출고 저장을 따로 남긴다 — 거절된 명령의 트랜잭션이 끝난 뒤, 그것과 상관없는 트랜잭션에서. */
@Injectable()
export class OutboundScanRejectionManager {
  private readonly logger = new Logger(OutboundScanRejectionManager.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly barcodes: BarcodeService,
  ) {}

  /** 남겼으면 true. 남기지 못해도 던지지 않는다 — 원래 거절이 그대로 작업자에게 가야 한다. */
  async record(input: OutboundScanRejectionInput, tx?: DbTx): Promise<boolean> {
    if (!UUID.test(input.shipmentId) || !input.idempotencyKey.trim()) return false;
    try {
      return await this.dbService.run((trx) => this.insert(trx, input), tx);
    } catch (error) {
      this.logger.warn(
        `outbound_scan_rejection.record_failed shipment=${input.shipmentId} code=${input.rejection.code} ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  private async insert(trx: DbTx, input: OutboundScanRejectionInput): Promise<boolean> {
    const [shipment] = await trx
      .select({ status: wmsTables.shipments.status })
      .from(wmsTables.shipments)
      .where(eq(wmsTables.shipments.id, input.shipmentId))
      .limit(1);
    if (!shipment) return false;
    const [workItem] = await trx
      .select({ id: wmsTables.outboundBatchWorkItems.id })
      .from(wmsTables.outboundBatchWorkItems)
      .where(
        and(
          eq(wmsTables.outboundBatchWorkItems.shipmentId, input.shipmentId),
          inArray(wmsTables.outboundBatchWorkItems.status, [...ACTIVE_WORK_ITEM_STATUSES]),
        ),
      )
      .limit(1);
    const skuId = input.barcode ? await resolveSkuIdByBarcode(this.barcodes, input.barcode, trx) : null;
    const values = {
      shipmentId: input.shipmentId,
      workItemId: workItem?.id ?? null,
      shipmentStatus: shipment.status,
      code: input.rejection.code,
      reasonCode: input.rejection.reasonCode,
      barcode: input.barcode,
      skuId,
      quantity: input.quantity,
      actorId: input.actorId,
      // 명령 기록의 완료 시각과 같은 시계(앱)다 — 읽을 때 «그 뒤 반영됐는지»를 이 둘로 비교한다.
      createdAt: input.rejectedAt,
    };
    // 같은 키로 다시 보낸 요청은 앞 시도가 되돌려졌으니 다른 사유로 거절될 수 있다 — 나중에 시작한 시도의 거절로 맞춘다.
    // 앞 시도의 기록이 늦게 와도 뒤 시도를 덮지 않는다.
    await trx
      .insert(wmsTables.outboundScanRejections)
      .values({ ...values, commandType: input.commandType, idempotencyKey: input.idempotencyKey.trim() })
      .onConflictDoUpdate({
        target: [wmsTables.outboundScanRejections.commandType, wmsTables.outboundScanRejections.idempotencyKey],
        set: values,
        setWhere: sql`${wmsTables.outboundScanRejections.createdAt} <= excluded.created_at`,
      });
    return true;
  }
}
