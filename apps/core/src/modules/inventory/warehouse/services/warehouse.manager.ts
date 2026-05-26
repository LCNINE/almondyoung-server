import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { ConflictError, NotFoundError } from '@app/shared';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx, Warehouse } from '../../schema/inventory.schema';
import { WAREHOUSE_CONSTANTS } from '../../core/constants/warehouse.constants';
import { LocationService } from '../../core/services/location.service';
import { CreateWarehouseDto } from '../dto/create-warehouse.dto';
import { UpdateWarehouseDto } from '../dto/update-warehouse.dto';
import { WarehouseReader } from './warehouse.reader';

@Injectable()
export class WarehouseManager {
  private readonly logger = new Logger(WarehouseManager.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly reader: WarehouseReader,
    private readonly locationService: LocationService,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T> {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  async create(dto: CreateWarehouseDto, tx?: DbTx): Promise<Warehouse> {
    return this.inTx(async (trx) => {
      const [newWarehouse] = await trx
        .insert(wmsTables.warehouses)
        .values({
          name: dto.name,
          type: dto.type || 'domestic',
          location: dto.location,
        })
        .returning();

      this.logger.log(`새 창고 생성: ${newWarehouse.name} (ID: ${newWarehouse.id})`);
      // 창고 생성 직후 시스템 로케이션 보장 (동일 트랜잭션)
      await this.locationService.ensureSystemLocations(newWarehouse.id, trx);
      return newWarehouse;
    }, tx);
  }

  async update(id: string, dto: UpdateWarehouseDto, tx?: DbTx): Promise<Warehouse> {
    const [updated] = await this.inTx(
      async (trx) =>
        trx
          .update(wmsTables.warehouses)
          .set({
            ...dto,
            updatedAt: new Date(),
          })
          .where(eq(wmsTables.warehouses.id, id))
          .returning(),
      tx,
    );

    if (!updated) {
      throw new NotFoundError(`창고를 찾을 수 없습니다: ${id}`);
    }

    this.logger.log(`창고 정보 업데이트: ${updated.name}`);
    return updated;
  }

  async remove(id: string, tx?: DbTx): Promise<Warehouse> {
    if (
      id === WAREHOUSE_CONSTANTS.DEFAULT_DOMESTIC_WAREHOUSE.id ||
      id === WAREHOUSE_CONSTANTS.DEFAULT_OVERSEAS_WAREHOUSE.id
    ) {
      throw new ConflictError('기본 창고는 삭제할 수 없습니다.');
    }

    const inUse = await this.reader.isInUse(id);
    if (inUse) {
      throw new ConflictError('사용 중인 창고는 삭제할 수 없습니다.');
    }

    const [deleted] = await this.inTx(
      async (trx) => trx.delete(wmsTables.warehouses).where(eq(wmsTables.warehouses.id, id)).returning(),
      tx,
    );

    if (!deleted) {
      throw new NotFoundError(`창고를 찾을 수 없습니다: ${id}`);
    }

    return deleted;
  }

  async ensureDefaultsExist(): Promise<void> {
    try {
      const defaults = [WAREHOUSE_CONSTANTS.DEFAULT_DOMESTIC_WAREHOUSE, WAREHOUSE_CONSTANTS.DEFAULT_OVERSEAS_WAREHOUSE];

      for (const data of defaults) {
        const existing = await this.reader.findOneOrNull(data.id);

        if (!existing) {
          await this.inTx(async (trx) => {
            await trx.insert(wmsTables.warehouses).values({
              id: data.id,
              name: data.name,
              type: data.type,
              location: data.location,
            });
          });
          this.logger.log(`기본 창고 생성: ${data.name}`);
        }
      }
    } catch (error) {
      this.logger.error('기본 창고 생성 중 오류 발생:', error);
    }
  }
}
