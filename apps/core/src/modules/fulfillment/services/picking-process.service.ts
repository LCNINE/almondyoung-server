import { Injectable, NotFoundException, ConflictException, Optional } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import { PickingStrategyRegistry } from '../picking/picking-strategy.registry';
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
  PickingStrategyName,
  PlanPickingInput,
  ScanPickingInput,
  StartPickingInput,
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
    @Optional() private readonly strategyRegistry?: PickingStrategyRegistry,
  ) {}

  async plan(strategyName: PickingStrategyName, input: PlanPickingInput, tx?: DbTx) {
    return this.dbService.run(async (trx) => {
      const [batch] = await trx
        .select({ warehouseId: wmsTables.outboundBatches.warehouseId })
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, input.batchId))
        .limit(1);
      if (!batch) throw new NotFoundException(`Outbound batch ${input.batchId} not found`);
      const strategy = await this.requiredRegistry().resolveForWarehouse(strategyName, batch.warehouseId, trx);
      return strategy.plan(input, trx);
    }, tx);
  }

  async start(input: StartPickingInput, tx?: DbTx) {
    return this.withPlanStrategy(input.batchId, input.planId, (strategy, trx) => strategy.start(input, trx), tx);
  }

  async scan(input: ScanPickingInput, tx?: DbTx) {
    return this.withPlanStrategy(input.batchId, input.planId, (strategy, trx) => strategy.scan(input, trx), tx);
  }

  async aggregateBulkCartScan(input: AggregateSourceScanInput, tx?: DbTx): Promise<AggregateSourceScanResult> {
    return this.withAggregateThenSortStrategy(
      input.batchId,
      input.planId,
      (strategy, trx) => strategy.bulkCartScan(input, trx),
      tx,
    );
  }

  async aggregateSortScan(input: AggregateSortScanInput, tx?: DbTx): Promise<AggregateSortScanResult> {
    return this.withAggregateThenSortStrategy(
      input.batchId,
      input.planId,
      (strategy, trx) => strategy.sortScan(input, trx),
      tx,
    );
  }

  async aggregateCartHandoff(input: AggregateCartHandoffInput, tx?: DbTx): Promise<AggregateCartHandoffResult> {
    return this.withAggregateThenSortStrategy(
      input.batchId,
      input.planId,
      (strategy, trx) => strategy.cartHandoff(input, trx),
      tx,
    );
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
    return this.withPickToToteStrategy(
      input.batchId,
      input.planId,
      (strategy, trx) => strategy.assignTote(input, trx),
      tx,
    );
  }

  async toteScan(input: ToteScanPickingInput, tx?: DbTx): Promise<ToteScanResult> {
    return this.withPickToToteStrategy(
      input.batchId,
      input.planId,
      (strategy, trx) => strategy.toteScan(input, trx),
      tx,
    );
  }

  async toteHandoff(input: ToteHandoffInput, tx?: DbTx): Promise<ToteHandoffResult> {
    return this.withPickToToteStrategy(
      input.batchId,
      input.planId,
      (strategy, trx) => strategy.toteHandoff(input, trx),
      tx,
    );
  }

  async releaseTote(input: ToteReleaseInput, tx?: DbTx): Promise<ToteReleaseResult> {
    return this.withPickToToteStrategy(
      input.batchId,
      input.planId,
      (strategy, trx) => strategy.releaseTote(input, trx),
      tx,
    );
  }

  async handoff(input: HandoffPickingInput, tx?: DbTx) {
    return this.withPlanStrategy(input.batchId, input.planId, (strategy, trx) => strategy.handoff(input, trx), tx);
  }

  async completePick(input: CompletePickInput, tx?: DbTx) {
    return this.withPlanStrategy(input.batchId, input.planId, (strategy, trx) => strategy.completePick(input, trx), tx);
  }

  async unpickShipment(input: UnpickShipmentInput, tx?: DbTx) {
    return this.withPlanStrategy(
      input.batchId,
      input.planId,
      (strategy, trx) => strategy.unpickShipment(input, trx),
      tx,
    );
  }

  private withPlanStrategy<T>(
    batchId: string,
    planId: string,
    execute: (strategy: PickingStrategy, tx: DbTx) => Promise<T>,
    tx?: DbTx,
  ): Promise<T> {
    return this.dbService.run(async (trx) => {
      const [identity] = await trx
        .select({
          batchId: wmsTables.pickingPlans.batchId,
          strategy: wmsTables.pickingPlans.strategy,
          warehouseId: wmsTables.outboundBatches.warehouseId,
        })
        .from(wmsTables.pickingPlans)
        .innerJoin(wmsTables.outboundBatches, eq(wmsTables.outboundBatches.id, wmsTables.pickingPlans.batchId))
        .where(eq(wmsTables.pickingPlans.id, planId))
        .limit(1);
      if (!identity) throw new NotFoundException(`Picking plan ${planId} not found`);
      if (identity.batchId !== batchId) {
        throw new ConflictException({
          code: 'PICKING_PLAN_BATCH_MISMATCH',
          message: `Picking plan ${planId} does not belong to batch ${batchId}`,
        });
      }
      const strategy = await this.requiredRegistry().resolveForWarehouse(identity.strategy, identity.warehouseId, trx);
      return execute(strategy, trx);
    }, tx);
  }

  private withAggregateThenSortStrategy<T>(
    batchId: string,
    planId: string,
    execute: (strategy: AggregateThenSortStrategy, tx: DbTx) => Promise<T>,
    tx?: DbTx,
  ): Promise<T> {
    return this.withPlanStrategy(
      batchId,
      planId,
      (strategy, trx) => {
        if (!isAggregateThenSortStrategy(strategy)) {
          throw new ConflictException({
            code: 'PICKING_PLAN_STRATEGY_MISMATCH',
            message: `Picking plan ${planId} does not use aggregate_then_sort`,
          });
        }
        return execute(strategy, trx);
      },
      tx,
    );
  }

  private withPickToToteStrategy<T>(
    batchId: string,
    planId: string,
    execute: (strategy: PickToToteStrategy, tx: DbTx) => Promise<T>,
    tx?: DbTx,
  ): Promise<T> {
    return this.withPlanStrategy(
      batchId,
      planId,
      (strategy, trx) => {
        if (!isPickToToteStrategy(strategy)) {
          throw new ConflictException({
            code: 'PICKING_PLAN_STRATEGY_MISMATCH',
            message: `Picking plan ${planId} does not use pick_to_tote`,
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
