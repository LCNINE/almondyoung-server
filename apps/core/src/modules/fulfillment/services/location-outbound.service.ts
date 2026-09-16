import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { isScopeAuthorizationDecision, ScopeAuthorizationDecision } from '@app/authorization';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { PreparedOutboundResult, isPreparationBlocked } from './outbound-preparation-result';
import { FulfillmentCommandService } from './fulfillment-command.service';
import {
  OutboundCommandKey,
  SimpleOutboundActor,
  SimpleOutboundContext,
  SimpleOutboundService,
  SimpleOutboundState,
} from './simple-outbound.service';

export interface StartLocationOutboundInput {
  warehouseId: string;
}
export type LocationOutboundActor = SimpleOutboundActor;
export interface LocationOutboundScanInput extends StartLocationOutboundInput {
  sourceLocationId: string;
  barcode: string;
  quantity: number;
}
export interface LocationOutboundConfirmInput extends StartLocationOutboundInput {
  reason: string;
  items: Array<{ shipmentLineId: string; sourceLocationId: string; quantity: number }>;
}
export interface OutboundSourceLine {
  shipmentLineId: string;
  skuId: string;
  sourceLocationId: string;
  sourceLocationCode: string;
  allocatedQty: number;
  pickedQty: number;
  remainingQty: number;
}
export interface LocationOutboundState extends SimpleOutboundState {
  warehouseId: string;
  sources: OutboundSourceLine[];
}
export type LocationOutboundForceRejection = {
  outcome: 'rejected';
  code: 'LOCATION_OUTBOUND_FORCE_NOT_APPLIED';
};
export type LocationOutboundForceResolution =
  | { outcome: 'confirmed'; result: LocationOutboundState }
  | LocationOutboundForceRejection;
type LocationOutboundForceCommandResult =
  | PreparedOutboundResult<LocationOutboundState>
  | LocationOutboundForceRejection;
const FORCE_NOT_APPLIED: LocationOutboundForceRejection = {
  outcome: 'rejected',
  code: 'LOCATION_OUTBOUND_FORCE_NOT_APPLIED',
};
function isForceRejection(result: LocationOutboundForceCommandResult): result is LocationOutboundForceRejection {
  return 'outcome' in result && result.outcome === 'rejected' && result.code === FORCE_NOT_APPLIED.code;
}
type ReadContext = { shipmentId: string; workItemId: string | null; sessionId: string | null; planId: string | null };
export const LOCATION_OUTBOUND_MAX_QUANTITY = 2147483647;
const locationCommandKey = (operation: 'start' | 'scan' | 'force', key: string): OutboundCommandKey => ({
  contract: 'location',
  operation,
  key,
});

@Injectable()
export class LocationOutboundService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly commands: FulfillmentCommandService,
    private readonly simple: SimpleOutboundService,
  ) {}

  async start(
    shipmentId: string,
    input: StartLocationOutboundInput,
    actor: LocationOutboundActor,
    idempotencyKey: string,
    tx?: DbTx,
  ): Promise<PreparedOutboundResult<LocationOutboundState>> {
    return this.execute(
      'start',
      shipmentId,
      input,
      actor,
      idempotencyKey,
      async (trx) => {
        await this.assertWarehouse(shipmentId, input.warehouseId, trx);
        const prepared = await this.simple.prepare(shipmentId, actor, locationCommandKey('start', idempotencyKey), trx);
        if (prepared.outcome === 'preparation_blocked') return prepared;
        const context = prepared.context;
        return this.loadState(context, input.warehouseId, trx);
      },
      tx,
    );
  }

  /** Read the existing work only. No prepare, plan creation, claim, or inventory commands. */
  getState(shipmentId: string, warehouseId: string, tx?: DbTx): Promise<LocationOutboundState> {
    return this.dbService.run(async (trx) => {
      await this.assertWarehouse(shipmentId, warehouseId, trx);
      const [workItem] = await trx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.shipmentId, shipmentId))
        .orderBy(
          asc(sql`case when ${wmsTables.outboundBatchWorkItems.status} in ('completed', 'excluded') then 1 else 0 end`),
          desc(wmsTables.outboundBatchWorkItems.createdAt),
        )
        .limit(1);
      const [plan] = workItem
        ? await trx
            .select({ id: wmsTables.pickingPlans.id })
            .from(wmsTables.pickingPlans)
            .where(
              and(
                eq(wmsTables.pickingPlans.batchId, workItem.batchId),
                inArray(wmsTables.pickingPlans.status, ['draft', 'active']),
              ),
            )
            .orderBy(desc(wmsTables.pickingPlans.version))
            .limit(1)
        : [];
      const [session] = workItem
        ? await trx
            .select({ id: wmsTables.batchInventorySessions.id })
            .from(wmsTables.batchInventorySessions)
            .where(
              and(
                eq(wmsTables.batchInventorySessions.batchId, workItem.batchId),
                inArray(wmsTables.batchInventorySessions.status, ['active', 'recovery_required']),
              ),
            )
            .limit(1)
        : [];
      return this.loadState(
        { shipmentId, workItemId: workItem?.id ?? null, planId: plan?.id ?? null, sessionId: session?.id ?? null },
        warehouseId,
        trx,
      );
    }, tx);
  }

  async scan(
    shipmentId: string,
    input: LocationOutboundScanInput,
    actor: LocationOutboundActor,
    idempotencyKey: string,
    tx?: DbTx,
  ): Promise<PreparedOutboundResult<LocationOutboundState>> {
    this.assertQuantity(input.quantity);
    if (typeof input.barcode !== 'string' || !input.barcode.trim())
      throw new BadRequestException('barcode is required');
    return this.execute(
      'scan',
      shipmentId,
      { ...input, barcode: input.barcode.trim() },
      actor,
      idempotencyKey,
      async (trx) => {
        await this.assertWarehouse(shipmentId, input.warehouseId, trx);
        await this.assertSource(input.sourceLocationId, input.warehouseId, trx);
        const prepared = await this.simple.prepare(shipmentId, actor, locationCommandKey('scan', idempotencyKey), trx);
        if (prepared.outcome === 'preparation_blocked') return prepared;
        const context = prepared.context;
        const skuId = await this.simple.resolveSkuId(input.barcode, trx);
        await this.simple.pickScanned(
          context,
          skuId,
          input.quantity,
          actor,
          locationCommandKey('scan', idempotencyKey),
          trx,
          {
            sourceLocationId: input.sourceLocationId,
          },
        );
        const settled = await this.simple.settleIfFullyPicked(
          context,
          actor,
          locationCommandKey('scan', idempotencyKey),
          trx,
        );
        return {
          ...(await this.loadState(context, input.warehouseId, trx)),
          dispatchAttemptId: settled?.dispatchAttemptId ?? null,
        };
      },
      tx,
    );
  }

  async force(
    shipmentId: string,
    input: LocationOutboundConfirmInput,
    actor: LocationOutboundActor,
    idempotencyKey: string,
    authorization: ScopeAuthorizationDecision | undefined,
    tx?: DbTx,
  ): Promise<PreparedOutboundResult<LocationOutboundState>> {
    // Recheck authorization even for a completed command replay.
    if (!isScopeAuthorizationDecision(authorization, FULFILLMENT_SCOPE.DISPATCH_FORCE)) {
      throw new ForbiddenException({
        code: 'FULFILLMENT_DISPATCH_FORCE_FORBIDDEN',
        message: 'Force dispatch scope is required',
      });
    }
    const normalized = this.normalizeForceInput(input);
    const result = await this.execute<LocationOutboundConfirmInput, LocationOutboundForceCommandResult>(
      'force',
      shipmentId,
      normalized,
      actor,
      idempotencyKey,
      async (trx) => {
        await this.assertWarehouse(shipmentId, input.warehouseId, trx);
        const prepared = await this.simple.prepare(shipmentId, actor, locationCommandKey('force', idempotencyKey), trx);
        if (prepared.outcome === 'preparation_blocked') return prepared;
        const context = prepared.context;
        const state = await this.loadState(context, input.warehouseId, trx);
        const remaining = state.sources.filter((source) => source.remainingQty > 0);
        const tuples = new Map(input.items.map((item) => [this.tuple(item), item.quantity]));
        if (
          tuples.size !== input.items.length ||
          remaining.length !== input.items.length ||
          remaining.some((source) => tuples.get(this.tuple(source)) !== source.remainingQty)
        ) {
          throw this.conflict(
            'LOCATION_OUTBOUND_PROGRESS_CHANGED',
            'Confirm every current remaining line and source quantity again',
          );
        }
        for (const source of remaining) {
          await this.assertSource(source.sourceLocationId, input.warehouseId, trx);
          await this.simple.pickScanned(
            context,
            source.skuId,
            source.remainingQty,
            actor,
            locationCommandKey('force', idempotencyKey),
            trx,
            { sourceLocationId: source.sourceLocationId, shipmentLineId: source.shipmentLineId },
          );
        }
        const forced = await this.simple.completeAndForceDispatch(
          context,
          { reason: input.reason, actor, idempotencyKey: locationCommandKey('force', idempotencyKey), authorization },
          trx,
        );
        return {
          ...(await this.loadState(context, input.warehouseId, trx)),
          dispatchAttemptId: forced.dispatchAttemptId,
        };
      },
      tx,
    );
    if (isForceRejection(result)) {
      throw this.conflict(
        FORCE_NOT_APPLIED.code,
        'The original force command was closed without applying inventory changes',
      );
    }
    return result;
  }

  /** Resolves the original actor-bound command under its existing unique key; never dispatches. */
  async resolveForce(
    shipmentId: string,
    input: LocationOutboundConfirmInput,
    actor: LocationOutboundActor,
    idempotencyKey: string,
    tx?: DbTx,
  ): Promise<LocationOutboundForceResolution> {
    const result = await this.execute<LocationOutboundConfirmInput, LocationOutboundForceCommandResult>(
      'force',
      shipmentId,
      this.normalizeForceInput(input),
      actor,
      idempotencyKey,
      async (trx) => {
        await this.assertWarehouse(shipmentId, input.warehouseId, trx);
        return FORCE_NOT_APPLIED;
      },
      tx,
    );
    return isPreparationBlocked(result)
      ? FORCE_NOT_APPLIED
      : isForceRejection(result)
        ? result
        : { outcome: 'confirmed', result };
  }

  private normalizeForceInput(input: LocationOutboundConfirmInput): LocationOutboundConfirmInput {
    if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.trim().length > 500)
      throw new BadRequestException('reason must be between 1 and 500 characters');
    if (!Array.isArray(input.items)) throw new BadRequestException('items is required');
    for (const item of input.items) this.assertQuantity(item.quantity);
    // Preserve the original force hash contract, including the submitted item order.
    return { ...input, reason: input.reason.trim() };
  }

  private execute<
    TInput extends StartLocationOutboundInput,
    TResult extends LocationOutboundForceCommandResult = PreparedOutboundResult<LocationOutboundState>,
  >(
    command: string,
    shipmentId: string,
    input: TInput,
    actor: LocationOutboundActor,
    key: string,
    handler: (tx: DbTx) => Promise<TResult>,
    tx?: DbTx,
  ) {
    if (!actor?.id) throw new UnauthorizedException('Authenticated actor is required');
    // A savepoint also protects callers supplying an ambient transaction and catching a rejection.
    return this.dbService.run(
      (trx) =>
        trx.transaction((savepoint) =>
          this.commands.execute(
            {
              commandType: `shipment.location_outbound.${command}`,
              idempotencyKey: key,
              canonicalRequest: { ...input, shipmentId, actorId: actor.id },
            },
            async (inner) => {
              const response = await handler(inner);
              return {
                response,
                resourceType: 'shipment',
                resourceId: shipmentId,
                attemptId: 'dispatchAttemptId' in response ? (response.dispatchAttemptId ?? undefined) : undefined,
              };
            },
            savepoint,
          ),
        ),
      tx,
    );
  }

  private async loadState(
    context: ReadContext | SimpleOutboundContext,
    warehouseId: string,
    tx: DbTx,
  ): Promise<LocationOutboundState> {
    const state = await this.simple.loadState(context, tx);
    const sources: OutboundSourceLine[] = [];
    if (state.status !== 'shipped' && context.planId) {
      const allocations = await tx
        .select({
          shipmentLineId: wmsTables.pickingSourceAllocations.shipmentLineId,
          skuId: wmsTables.shipmentLines.skuId,
          sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId,
          sourceLocationCode: wmsTables.locations.code,
          allocatedQty: wmsTables.pickingSourceAllocations.qty,
        })
        .from(wmsTables.pickingSourceAllocations)
        .innerJoin(
          wmsTables.shipmentLines,
          eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId),
        )
        .innerJoin(wmsTables.locations, eq(wmsTables.locations.id, wmsTables.pickingSourceAllocations.sourceLocationId))
        .where(
          and(
            eq(wmsTables.pickingSourceAllocations.planId, context.planId),
            eq(wmsTables.shipmentLines.shipmentId, context.shipmentId),
          ),
        )
        .orderBy(
          asc(wmsTables.pickingSourceAllocations.shipmentLineId),
          asc(wmsTables.pickingSourceAllocations.sourceLocationId),
        );
      for (const allocation of allocations) {
        const pickedQty = context.sessionId
          ? await this.simple.attributedQty(
              context.sessionId,
              allocation.shipmentLineId,
              allocation.sourceLocationId,
              tx,
            )
          : 0;
        sources.push({ ...allocation, pickedQty, remainingQty: Math.max(0, allocation.allocatedQty - pickedQty) });
      }
    }
    return { ...state, warehouseId, sources };
  }

  private async assertWarehouse(shipmentId: string, warehouseId: string, tx: DbTx) {
    const [shipment] = await tx
      .select({ warehouseId: wmsTables.shipments.warehouseId })
      .from(wmsTables.shipments)
      .where(eq(wmsTables.shipments.id, shipmentId))
      .limit(1);
    if (!shipment) throw new NotFoundException('Shipment not found');
    if (shipment.warehouseId !== warehouseId)
      throw this.conflict('LOCATION_OUTBOUND_WAREHOUSE_MISMATCH', 'Shipment belongs to another warehouse');
  }

  private async assertSource(sourceLocationId: string, warehouseId: string, tx: DbTx) {
    const [location] = await tx
      .select({ id: wmsTables.locations.id })
      .from(wmsTables.locations)
      .where(
        and(
          eq(wmsTables.locations.id, sourceLocationId),
          eq(wmsTables.locations.warehouseId, warehouseId),
          eq(wmsTables.locations.isActive, true),
        ),
      )
      .limit(1)
      .for('share');
    if (!location)
      throw this.conflict('LOCATION_OUTBOUND_SOURCE_MISMATCH', 'Select an active source in the shipment warehouse');
  }

  private assertQuantity(quantity: number) {
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > LOCATION_OUTBOUND_MAX_QUANTITY)
      throw new BadRequestException('quantity must be a positive 32-bit integer');
  }
  private tuple(item: { shipmentLineId: string; sourceLocationId: string }) {
    return `${item.shipmentLineId}:${item.sourceLocationId}`;
  }
  private conflict(code: string, message: string) {
    return new ConflictException({ code, error: code, message });
  }
}
