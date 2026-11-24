import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { inArray } from 'drizzle-orm';
import { DbTx, StockAllocation, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { SetStockPriorityDto, StockPriorityCancelResultDto, StockPriorityResultDto } from '../dto/stock-priority.dto';
import { ShipmentCommandReasonDto, ShipmentPlanningActor } from '../dto/shipment-planning.dto';
import { FulfillmentCommandService } from '../services/fulfillment-command.service';
import { FulfillmentWorkflowGate } from '../services/fulfillment-workflow-gate.service';
import {
  completeShipmentOperation,
  createShipmentOperation,
  loadShipmentAggregate,
  shipmentSnapshot,
} from '../services/shipment-aggregate';
import { ShipmentReservationService } from '../services/shipment-reservation.service';
import { resolveOperationReason } from '../shipment/shipment-operation-reasons';
import { StockPriorityBlockedError, StockPriorityPlanChangedError } from './stock-priority.errors';
import { StockPriorityFacts, StockPriorityReader, stockPriorityToken } from './stock-priority.reader';

@Injectable()
export class StockPriorityManager {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly commands: FulfillmentCommandService,
    private readonly reservations: ShipmentReservationService,
    private readonly reader: StockPriorityReader,
    private readonly audit: AuditService,
    private readonly workflowGate: FulfillmentWorkflowGate,
  ) {}

  /** 상자의 출고주문을 우선할당으로 표시하고, 남는 재고와 다른 대기 상자의 예약을 이 상자로 옮긴다. */
  async prioritize(
    shipmentId: string,
    dto: SetStockPriorityDto,
    idempotencyKey: string,
    actor: ShipmentPlanningActor,
    tx?: DbTx,
  ): Promise<StockPriorityResultDto> {
    this.workflowGate.assertV2MutationAllowed('shipment.stock_priority');
    const reason = resolveOperationReason('stock_priority', dto);
    return this.commands.execute(
      {
        commandType: 'shipment.stock_priority',
        idempotencyKey,
        canonicalRequest: { actorId: actor.id, shipmentId, ...dto },
      },
      async (trx, _commandRequestId, requestHash) => {
        const seen = await this.reader.load(shipmentId, trx);
        const seenPlan = this.planOf(seen, dto);
        // 계획에 든 상자를 한 번에 잠그고 잠근 뒤 다시 계산한다 — 그 사이 바뀌었으면 화면이 새로 보게 한다
        await this.reservations.lockLinesForReservation(
          [...seen.lines.map((line) => line.lineId), ...seenPlan.takes.map((take) => take.sourceLineId)],
          seen.targets.map((line) => line.skuId),
          this.warehouseOf(seen),
          trx,
        );
        const facts = await this.reader.load(shipmentId, trx);
        const plan = this.planOf(facts, dto);

        const sourceIds = [...new Set(plan.takes.map((take) => take.sourceShipmentId))].sort();
        const before = new Map<string, ReturnType<typeof shipmentSnapshot>>();
        for (const id of [shipmentId, ...sourceIds]) {
          before.set(id, shipmentSnapshot(await loadShipmentAggregate(trx, id)));
        }
        const targetBefore = before.get(shipmentId);
        if (!targetBefore) throw new Error(`Shipment snapshot missing: ${shipmentId}`);
        const operation = await createShipmentOperation(trx, {
          type: 'stock_priority',
          actorId: actor.id,
          reason: reason.reason,
          reasonCode: reason.reasonCode,
          requestChannel: reason.requestChannel,
          csCaseId: dto.csCaseId ?? null,
          note: dto.note ?? null,
          idempotencyKey,
          requestHash,
          before: targetBefore,
        });

        await this.setAllocation(facts.fulfillmentOrderIds, 'priority', trx);
        for (const row of plan.free) await this.reservations.reservePartial(row.targetLineId, row.qty, trx);
        for (const take of plan.takes) {
          await this.reservations.takeFrom(take.sourceLineId, take.targetLineId, take.qty, trx);
        }

        const members: Parameters<typeof completeShipmentOperation>[2] = [];
        for (const id of [shipmentId, ...sourceIds]) {
          members.push({
            shipmentId: id,
            role: id === shipmentId ? 'target' : 'source',
            before: before.get(id) ?? null,
            after: shipmentSnapshot(await loadShipmentAggregate(trx, id)),
          });
        }
        await completeShipmentOperation(trx, operation.id, members);
        await this.auditOperation(trx, actor, 'shipment.stock_priority', operation.id, reason.reason, {
          shipmentId,
          free: plan.free,
          takes: plan.takes,
        });

        const response: StockPriorityResultDto = {
          shipmentId,
          movedQty: plan.takes.reduce((total, take) => total + take.qty, 0),
          freeQty: plan.free.reduce((total, row) => total + row.qty, 0),
          missingQty: plan.missingQty,
          operationId: operation.id,
        };
        return { response, resourceType: 'shipment', resourceId: shipmentId, operationId: operation.id };
      },
      tx,
    );
  }

  /** 표시만 거둔다. 이미 받은 예약은 그대로 둔다. */
  async cancel(
    shipmentId: string,
    dto: ShipmentCommandReasonDto,
    idempotencyKey: string,
    actor: ShipmentPlanningActor,
    tx?: DbTx,
  ): Promise<StockPriorityCancelResultDto> {
    this.workflowGate.assertV2MutationAllowed('shipment.stock_priority_cancel');
    const reason = resolveOperationReason('stock_priority_cancel', dto);
    return this.commands.execute(
      {
        commandType: 'shipment.stock_priority_cancel',
        idempotencyKey,
        canonicalRequest: { actorId: actor.id, shipmentId, ...dto },
      },
      async (trx, _commandRequestId, requestHash) => {
        const aggregate = await loadShipmentAggregate(trx, shipmentId);
        const snapshot = shipmentSnapshot(aggregate);
        const operation = await createShipmentOperation(trx, {
          type: 'stock_priority_cancel',
          actorId: actor.id,
          reason: reason.reason,
          reasonCode: reason.reasonCode,
          requestChannel: reason.requestChannel,
          csCaseId: dto.csCaseId ?? null,
          note: dto.note ?? null,
          idempotencyKey,
          requestHash,
          before: snapshot,
        });
        await this.setAllocation(aggregate.fulfillmentOrderIds, 'normal', trx);
        await completeShipmentOperation(trx, operation.id, [
          { shipmentId, role: 'target', before: snapshot, after: snapshot },
        ]);
        await this.auditOperation(trx, actor, 'shipment.stock_priority_cancel', operation.id, reason.reason, {
          shipmentId,
        });
        const response: StockPriorityCancelResultDto = { shipmentId, operationId: operation.id };
        return { response, resourceType: 'shipment', resourceId: shipmentId, operationId: operation.id };
      },
      tx,
    );
  }

  private planOf(facts: StockPriorityFacts, dto: SetStockPriorityDto) {
    if (facts.blocked) throw new StockPriorityBlockedError(facts.shipmentId, facts.blocked);
    const plan = dto.includeReady ? facts.withReady : facts.base;
    if (!plan || stockPriorityToken(facts, plan) !== dto.planToken) {
      throw new StockPriorityPlanChangedError(facts.shipmentId);
    }
    return plan;
  }

  private warehouseOf(facts: StockPriorityFacts): string {
    if (!facts.warehouseId) throw new Error(`Shipment has no warehouse: ${facts.shipmentId}`);
    return facts.warehouseId;
  }

  private async setAllocation(ids: string[], stockAllocation: StockAllocation, trx: DbTx): Promise<void> {
    await trx
      .update(wmsTables.fulfillmentOrders)
      .set({ stockAllocation, updatedAt: new Date() })
      .where(inArray(wmsTables.fulfillmentOrders.id, [...ids].sort()));
  }

  private async auditOperation(
    trx: DbTx,
    actor: ShipmentPlanningActor,
    action: string,
    operationId: string,
    reason: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.logUserActionRequired(
      action,
      'fulfillment',
      `${action} operation ${operationId}`,
      { userId: actor.id },
      { operationId, reason, ...metadata },
      trx,
    );
  }
}
