import { Injectable, NotFoundException, ConflictException, Optional } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import { PickingStrategyRegistry } from '../picking/picking-strategy.registry';
import { STRATEGY_BY_PICKING_METHOD } from '../picking/picking-method.contract';
import { BatchControlledStockGuard } from '../../inventory/core/services/batch-controlled-stock.guard';
import { BatchInventorySessionService } from './batch-inventory-session.service';
import { FulfillmentCommandService } from './fulfillment-command.service';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { WaybillService } from '../waybill/waybill.service';
import { startBatchPicking, StartBatchPickingInput } from '../picking/allocation/batch-start';
import { BatchStartDeps, BatchStartResult } from '../picking/allocation/allocation.types';
import {
  AggregateCartHandoffInput,
  AggregateCartHandoffResult,
  AggregateSortScanInput,
  AggregateSortScanResult,
  AggregateSourceScanInput,
  AggregateSourceScanResult,
  AggregateThenSortStrategy,
  CompletePickInput,
  HandoffPickingInput,
  PickToToteStrategy,
  PickingStrategy,
  ScanPickingInput,
  ToteAssignmentInput,
  ToteAssignmentResult,
  ToteHandoffInput,
  ToteHandoffResult,
  ToteRegistrationInput,
  ToteRegistrationResult,
  ToteReleaseInput,
  ToteReleaseResult,
  ToteScanPickingInput,
  ToteScanResult,
  UnpickShipmentInput,
} from '../picking/picking-strategy.interface';

function isAggregateThenSortStrategy(strategy: PickingStrategy): strategy is AggregateThenSortStrategy {
  return (
    strategy.capabilities.name === 'aggregate_then_sort' &&
    strategy.capabilities.supportsAggregateSourcePick &&
    'bulkCartScan' in strategy &&
    typeof strategy.bulkCartScan === 'function' &&
    'sortScan' in strategy &&
    typeof strategy.sortScan === 'function' &&
    'cartHandoff' in strategy &&
    typeof strategy.cartHandoff === 'function'
  );
}

function isPickToToteStrategy(strategy: PickingStrategy): strategy is PickToToteStrategy {
  return (
    strategy.capabilities.name === 'pick_to_tote' &&
    strategy.capabilities.requiresPhysicalTote &&
    'registerTote' in strategy &&
    typeof strategy.registerTote === 'function' &&
    'assignTote' in strategy &&
    typeof strategy.assignTote === 'function' &&
    'toteScan' in strategy &&
    typeof strategy.toteScan === 'function' &&
    'toteHandoff' in strategy &&
    typeof strategy.toteHandoff === 'function' &&
    'releaseTote' in strategy &&
    typeof strategy.releaseTote === 'function'
  );
}

@Injectable()
export class PickingProcessService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly commands: FulfillmentCommandService,
    private readonly workflowGate: FulfillmentWorkflowGate,
    private readonly sessions: BatchInventorySessionService,
    private readonly invariant: FulfillmentInvariantService,
    private readonly controlledStock: BatchControlledStockGuard,
    private readonly waybills: WaybillService,
    @Optional() private readonly strategyRegistry?: PickingStrategyRegistry,
  ) {}

  private get startDeps(): BatchStartDeps {
    return {
      commands: this.commands,
      workflowGate: this.workflowGate,
      sessions: this.sessions,
      invariant: this.invariant,
      controlledStock: this.controlledStock,
      waybills: this.waybills,
    };
  }

  async start(input: StartBatchPickingInput, tx?: DbTx): Promise<BatchStartResult> {
    return this.dbService.run(async (trx) => {
      const identity = await this.loadBatchIdentity(input.batchId, trx);
      await this.requiredRegistry().resolveForWarehouse(identity.strategy, identity.warehouseId, trx);
      return startBatchPicking(this.startDeps, identity.strategy, input, trx);
    }, tx);
  }

  async scan(input: ScanPickingInput, tx?: DbTx) {
    return this.withBatchStrategy(input.batchId, (strategy, trx) => strategy.scan(input, trx), tx);
  }

  async aggregateBulkCartScan(input: AggregateSourceScanInput, tx?: DbTx): Promise<AggregateSourceScanResult> {
    return this.withAggregateThenSortStrategy(input.batchId, (strategy, trx) => strategy.bulkCartScan(input, trx), tx);
  }

  async aggregateSortScan(input: AggregateSortScanInput, tx?: DbTx): Promise<AggregateSortScanResult> {
    return this.withAggregateThenSortStrategy(input.batchId, (strategy, trx) => strategy.sortScan(input, trx), tx);
  }

  async aggregateCartHandoff(input: AggregateCartHandoffInput, tx?: DbTx): Promise<AggregateCartHandoffResult> {
    return this.withAggregateThenSortStrategy(input.batchId, (strategy, trx) => strategy.cartHandoff(input, trx), tx);
  }

  async registerTote(input: ToteRegistrationInput, tx?: DbTx): Promise<ToteRegistrationResult> {
    return this.dbService.run(async (trx) => {
      const strategy = await this.requiredRegistry().resolveForWarehouse('pick_to_tote', input.warehouseId, trx);
      if (!isPickToToteStrategy(strategy)) {
        throw new ConflictException({
          code: 'PICKING_STRATEGY_PROVIDER_MISMATCH',
          message: 'The configured pick_to_tote provider does not expose tote operations',
        });
      }
      return strategy.registerTote(input, trx);
    }, tx);
  }

  async assignTote(input: ToteAssignmentInput, tx?: DbTx): Promise<ToteAssignmentResult> {
    return this.withPickToToteStrategy(input.batchId, (strategy, trx) => strategy.assignTote(input, trx), tx);
  }

  async toteScan(input: ToteScanPickingInput, tx?: DbTx): Promise<ToteScanResult> {
    return this.withPickToToteStrategy(input.batchId, (strategy, trx) => strategy.toteScan(input, trx), tx);
  }

  async toteHandoff(input: ToteHandoffInput, tx?: DbTx): Promise<ToteHandoffResult> {
    return this.withPickToToteStrategy(input.batchId, (strategy, trx) => strategy.toteHandoff(input, trx), tx);
  }

  async releaseTote(input: ToteReleaseInput, tx?: DbTx): Promise<ToteReleaseResult> {
    return this.withPickToToteStrategy(input.batchId, (strategy, trx) => strategy.releaseTote(input, trx), tx);
  }

  async handoff(input: HandoffPickingInput, tx?: DbTx) {
    return this.withBatchStrategy(input.batchId, (strategy, trx) => strategy.handoff(input, trx), tx);
  }

  async completePick(input: CompletePickInput, tx?: DbTx) {
    return this.withBatchStrategy(input.batchId, (strategy, trx) => strategy.completePick(input, trx), tx);
  }

  async unpickShipment(input: UnpickShipmentInput, tx?: DbTx) {
    return this.withBatchStrategy(input.batchId, (strategy, trx) => strategy.unpickShipment(input, trx), tx);
  }

  /** Batch -> warehouse/strategy identity, shared by `start` and every custody operation. */
  private async loadBatchIdentity(batchId: string, tx: DbTx) {
    const [batch] = await tx
      .select({
        warehouseId: wmsTables.outboundBatches.warehouseId,
        pickingMethod: wmsTables.outboundBatches.pickingMethod,
      })
      .from(wmsTables.outboundBatches)
      .where(eq(wmsTables.outboundBatches.id, batchId))
      .limit(1);
    if (!batch) throw new NotFoundException(`Outbound batch ${batchId} not found`);
    return { warehouseId: batch.warehouseId, strategy: STRATEGY_BY_PICKING_METHOD[batch.pickingMethod] };
  }

  private withBatchStrategy<T>(
    batchId: string,
    execute: (strategy: PickingStrategy, tx: DbTx) => Promise<T>,
    tx?: DbTx,
  ): Promise<T> {
    return this.dbService.run(async (trx) => {
      const identity = await this.loadBatchIdentity(batchId, trx);
      const strategy = await this.requiredRegistry().resolveForWarehouse(identity.strategy, identity.warehouseId, trx);
      return execute(strategy, trx);
    }, tx);
  }

  private withAggregateThenSortStrategy<T>(
    batchId: string,
    execute: (strategy: AggregateThenSortStrategy, tx: DbTx) => Promise<T>,
    tx?: DbTx,
  ): Promise<T> {
    return this.withBatchStrategy(
      batchId,
      (strategy, trx) => {
        if (!isAggregateThenSortStrategy(strategy)) {
          throw new ConflictException({
            code: 'PICKING_BATCH_STRATEGY_MISMATCH',
            message: `Batch ${batchId} does not use aggregate_then_sort`,
          });
        }
        return execute(strategy, trx);
      },
      tx,
    );
  }

  private withPickToToteStrategy<T>(
    batchId: string,
    execute: (strategy: PickToToteStrategy, tx: DbTx) => Promise<T>,
    tx?: DbTx,
  ): Promise<T> {
    return this.withBatchStrategy(
      batchId,
      (strategy, trx) => {
        if (!isPickToToteStrategy(strategy)) {
          throw new ConflictException({
            code: 'PICKING_BATCH_STRATEGY_MISMATCH',
            message: `Batch ${batchId} does not use pick_to_tote`,
          });
        }
        return execute(strategy, trx);
      },
      tx,
    );
  }

  private requiredRegistry(): PickingStrategyRegistry {
    if (!this.strategyRegistry) {
      throw new ConflictException({
        code: 'PICKING_STRATEGY_REGISTRY_UNAVAILABLE',
        message: 'Durable picking strategies are not registered in this service wiring',
      });
    }
    return this.strategyRegistry;
  }
}
