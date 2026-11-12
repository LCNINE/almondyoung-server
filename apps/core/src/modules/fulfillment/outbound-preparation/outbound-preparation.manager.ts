import { ConflictError, NotFoundError, ServiceUnavailableError } from '@app/shared';
import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, eq, inArray } from 'drizzle-orm';
import { wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { ShipmentPlanningActor } from '../dto/shipment-planning.dto';
import { loadShipmentLines } from '../services/consolidation-shipment-reads';
import { OutboundBatchOrchestrator } from '../services/outbound-batch-orchestrator.service';
import { ShipmentPlanningService } from '../services/shipment-planning.service';
import { ACTIVE_WORK_ITEM_STATUSES } from '../services/work-item-status';
import { WAYBILL, WAYBILL_DISPATCHABLE_STATUSES } from '../waybill/waybill.constants';
import { toView, WaybillService } from '../waybill/waybill.service';
import type { WaybillView } from '../waybill/waybill.types';
import {
  bulkShipmentFailure,
  BulkShipmentResult,
  PreparationWaybillResult,
  runPerShipment,
} from './bulk-shipment-result';
import { compatibleShippingProfileId } from '../services/shipping-profile';
import { OutboundPreparationReader } from './outbound-preparation.reader';

// 공개 메서드가 tx?: DbTx 를 받지 않는 것은 의도다(ADR-0025 예외). 상자마다 기존 단건 명령을 «자기 트랜잭션»으로
// 불러야 한 상자의 실패가 다른 상자를 되돌리지 않고, 송장 발급은 carrier HTTP 를 트랜잭션 안에 넣을 수 없다.
// 그래서 명령 앞의 읽기(상태·버전·라인)도 트랜잭션 밖이다 — 그 사이 바뀐 값은 단건 명령의 expected*Version 검사가 막는다.
@Injectable()
export class OutboundPreparationManager {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly planning: ShipmentPlanningService,
    private readonly batches: OutboundBatchOrchestrator,
    private readonly waybills: WaybillService,
    private readonly reader: OutboundPreparationReader,
  ) {}

  planMany(shipmentIds: string[], idempotencyKey: string, actor: ShipmentPlanningActor): Promise<BulkShipmentResult> {
    return runPerShipment(shipmentIds, async (shipmentId) => {
      const db = this.dbService.db;
      const [shipment] = await db
        .select({
          status: wmsTables.shipments.status,
          manifestVersion: wmsTables.shipments.manifestVersion,
          reservationVersion: wmsTables.shipments.reservationVersion,
        })
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, shipmentId))
        .limit(1);

      if (!shipment) {
        throw new NotFoundError(`SHIPMENT_NOT_FOUND: ${shipmentId}`);
      }

      if (shipment.status === 'planned') {
        return 'already';
      }

      const lines = await loadShipmentLines(db, [shipmentId]);
      const shippingProfileId = compatibleShippingProfileId(lines.map((line) => line.skuProfileId));

      if (shippingProfileId === null) {
        throw new ConflictError(`SHIPMENT_PROFILE_INCOMPATIBLE: ${shipmentId}`);
      }

      await this.planning.plan(
        shipmentId,
        {
          shippingProfileId,
          expectedManifestVersion: shipment.manifestVersion,
          expectedReservationVersion: shipment.reservationVersion,
        },
        `${idempotencyKey}:${shipmentId}`,
        actor,
      );

      return 'done';
    });
  }

  async issueWaybills(
    shipmentIds: string[],
    idempotencyKey: string,
    actor: ShipmentPlanningActor,
  ): Promise<PreparationWaybillResult[]> {
    const deadline = Date.now() + WAYBILL.BATCH_TIME_BUDGET_MS;
    const queue = shipmentIds.entries();
    const results: PreparationWaybillResult[] = [];

    await Promise.all(
      Array.from({ length: Math.min(WAYBILL.BATCH_CONCURRENCY, shipmentIds.length) }, async () => {
        for (const [index, shipmentId] of queue) {
          if (Date.now() >= deadline) {
            results[index] = {
              shipmentId,
              status: 'pending',
              trackingNo: null,
              reason: 'time-budget-exceeded',
              nextAttemptAt: null,
            };
            continue;
          }

          try {
            const waybill = await this.issueOrResume(shipmentId, idempotencyKey, actor);

            results[index] = {
              shipmentId,
              status: waybill.status,
              trackingNo: waybill.trackingNo,
              reason: waybill.lastError,
              nextAttemptAt: waybill.nextAttemptAt,
            };
          } catch (error) {
            const failure = bulkShipmentFailure(shipmentId, error);

            results[index] = {
              shipmentId,
              status: 'failed',
              trackingNo: null,
              reason: failure.message,
              nextAttemptAt: null,
              transient: failure.transient,
              code: failure.code,
            };
          }
        }
      }),
    );

    return results;
  }

  // 디스패치 가능한 송장은 그대로 쓰고, 멈춘 송장(pending/allocated)은 키와 상관없이 그 행을 이어 가며,
  // 활성 송장이 없을 때만 새로 발급한다. 원래 키를 브라우저가 들고 있지 않아도 어느 PC 에서든 같은 결과가 된다.
  private async issueOrResume(
    shipmentId: string,
    idempotencyKey: string,
    actor: ShipmentPlanningActor,
  ): Promise<WaybillView> {
    const active = await this.waybills.getActiveWaybill(shipmentId);

    if (active && WAYBILL_DISPATCHABLE_STATUSES.some((status) => status === active.status)) {
      return toView(await this.waybills.assertDispatchable(shipmentId));
    }

    const opts = { carrier: 'HANJIN' as const, expectedManifestVersion: await this.manifestVersionOf(shipmentId) };
    const resumed = active ? await this.waybills.resumeActive(shipmentId, opts) : null;

    if (resumed) {
      return resumed;
    }

    try {
      return await this.waybills.issueForShipment(shipmentId, opts, `${idempotencyKey}:${shipmentId}`, actor);
    } catch (error) {
      if (!(error instanceof ConflictError && error.message.startsWith(`${WAYBILL.ERROR.ACTIVE_EXISTS}:`))) {
        throw error;
      }

      // 읽은 뒤 다른 호출이 행을 만들었다 — 그 행을 이어 간다. 그새 끝났으면 다음 재시도가 새로 발급한다.
      const raced = await this.waybills.resumeActive(shipmentId, opts);

      if (!raced) {
        throw new ServiceUnavailableError(`WAYBILL_ISSUE_RACED: ${shipmentId}`);
      }

      return raced;
    }
  }

  private async manifestVersionOf(shipmentId: string): Promise<number> {
    const [shipment] = await this.dbService.db
      .select({ manifestVersion: wmsTables.shipments.manifestVersion })
      .from(wmsTables.shipments)
      .where(eq(wmsTables.shipments.id, shipmentId))
      .limit(1);

    if (!shipment) {
      throw new NotFoundError(`SHIPMENT_NOT_FOUND: ${shipmentId}`);
    }

    return shipment.manifestVersion;
  }

  addManyToBatch(
    batchId: string,
    shipmentIds: string[],
    idempotencyKey: string,
    actor: ShipmentPlanningActor,
  ): Promise<BulkShipmentResult> {
    return runPerShipment(shipmentIds, async (shipmentId) => {
      const [workItem] = await this.dbService.db
        .select({ id: wmsTables.outboundBatchWorkItems.id })
        .from(wmsTables.outboundBatchWorkItems)
        .where(
          and(
            eq(wmsTables.outboundBatchWorkItems.batchId, batchId),
            eq(wmsTables.outboundBatchWorkItems.shipmentId, shipmentId),
            inArray(
              wmsTables.outboundBatchWorkItems.status,
              ACTIVE_WORK_ITEM_STATUSES.filter((status) => status !== 'withdrawing'),
            ),
          ),
        )
        .limit(1);

      if (workItem) {
        return 'already';
      }

      await this.batches.addShipment(batchId, shipmentId, `${idempotencyKey}:${shipmentId}`, actor);

      return 'done';
    });
  }

  splitManyUnreserved(
    shipmentIds: string[],
    idempotencyKey: string,
    actor: ShipmentPlanningActor,
  ): Promise<BulkShipmentResult> {
    return runPerShipment(shipmentIds, async (shipmentId) => {
      const manifestVersion = await this.manifestVersionOf(shipmentId);

      const lines = (await this.reader.lineQuantities([shipmentId])).get(shipmentId) ?? [];

      if (!lines.some((line) => line.confirmedQty < line.qty)) {
        return 'already';
      }

      await this.planning.splitUnreserved(
        shipmentId,
        {
          reason: '출고 준비: 있는 것만 먼저 보내기',
          reasonCode: 'ship_available_first',
          expectedManifestVersion: manifestVersion,
        },
        `${idempotencyKey}:${shipmentId}`,
        actor,
      );

      return 'done';
    });
  }
}
