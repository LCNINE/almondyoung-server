import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { eq } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { PickingStrategy, PickingStrategyName } from './picking-strategy.interface';

export const PICKING_STRATEGIES = Symbol('PICKING_STRATEGIES');

@Injectable()
export class PickingStrategyRegistry {
  private readonly strategies: ReadonlyMap<PickingStrategyName, PickingStrategy>;

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    @Inject(PICKING_STRATEGIES) strategies: readonly PickingStrategy[],
  ) {
    const registered = new Map<PickingStrategyName, PickingStrategy>();
    for (const strategy of strategies) {
      const name = strategy.capabilities.name;
      if (registered.has(name)) {
        throw new ConflictException(`Picking strategy ${name} is registered more than once`);
      }
      registered.set(name, strategy);
    }
    this.strategies = registered;
  }

  private resolveRegistered(name: string | null | undefined): PickingStrategy {
    if (!name) {
      throw new BadRequestException('Picking strategy must be explicitly configured');
    }
    const strategy = this.strategies.get(name as PickingStrategyName);
    if (!strategy) {
      throw new BadRequestException(`Picking strategy ${name} is not registered`);
    }
    return strategy;
  }

  async resolveForWarehouse(name: string | null | undefined, warehouseId: string, tx?: DbTx): Promise<PickingStrategy> {
    return this.dbService.run(async (trx) => {
      const [warehouse] = await trx
        .select({ supportedPickingStrategies: wmsTables.warehouses.supportedPickingStrategies })
        .from(wmsTables.warehouses)
        .where(eq(wmsTables.warehouses.id, warehouseId))
        .limit(1);
      if (!warehouse) throw new NotFoundException(`Warehouse ${warehouseId} not found`);
      if (!warehouse.supportedPickingStrategies?.length) {
        throw new ConflictException(`Warehouse ${warehouseId} has no picking strategy configuration`);
      }
      if (!name || !warehouse.supportedPickingStrategies.includes(name as PickingStrategyName)) {
        throw new ConflictException(
          `Picking strategy ${name ?? '(missing)'} is not enabled for warehouse ${warehouseId}`,
        );
      }
      return this.resolveRegistered(name);
    }, tx);
  }

  registeredNames(): PickingStrategyName[] {
    return [...this.strategies.keys()].sort();
  }
}
