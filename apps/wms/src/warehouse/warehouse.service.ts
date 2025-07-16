// apps/wms/src/warehouse/warehouse.service.ts
import { Injectable, OnModuleInit, Logger, NotFoundException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../database/schemas/wms-schema';
import { TypedDatabase } from '@app/db';
import { WAREHOUSE_CONSTANTS, WarehouseType } from './warehouse.constants';
import { eq, and, sql, isNull } from 'drizzle-orm';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';

@Injectable()
export class WarehouseService implements OnModuleInit {
  private readonly logger = new Logger(WarehouseService.name);

  constructor(
    @InjectTypedDb<typeof wmsTables>() private readonly db: TypedDatabase<typeof wmsTables>,
  ) { }

  async onModuleInit() {
    await this.ensureDefaultWarehousesExist();
  }

  private async ensureDefaultWarehousesExist() {
    try {
      // 모든 기본 창고 생성
      const defaultWarehouses = [
        WAREHOUSE_CONSTANTS.DEFAULT_DOMESTIC_WAREHOUSE,
        WAREHOUSE_CONSTANTS.DEFAULT_OVERSEAS_WAREHOUSE,
      ];

      for (const warehouseData of defaultWarehouses) {
        const existingWarehouse = await this.db.query.warehouses.findFirst({
          where: eq(wmsTables.warehouses.id, warehouseData.id),
        });

        if (!existingWarehouse) {
          await this.db.insert(wmsTables.warehouses).values({
            id: warehouseData.id,
            name: warehouseData.name,
            type: warehouseData.type,
            location: warehouseData.location,
          });
          this.logger.log(`기본 창고 생성: ${warehouseData.name}`);
        }
      }
    } catch (error) {
      this.logger.error('기본 창고 생성 중 오류 발생:', error);
    }
  }

  // 창고 타입별 기본 창고 ID 반환
  getDefaultWarehouseIdByType(type: WarehouseType): string {
    switch (type) {
      case 'domestic':
        return WAREHOUSE_CONSTANTS.DEFAULT_DOMESTIC_WAREHOUSE.id;
      case 'overseas':
        return WAREHOUSE_CONSTANTS.DEFAULT_OVERSEAS_WAREHOUSE.id;
      default:
        return WAREHOUSE_CONSTANTS.DEFAULT_DOMESTIC_WAREHOUSE.id;
    }
  }

  // 기본 국내 창고 ID 반환 (기존 호환성을 위해 유지)
  getDefaultWarehouseId(): string {
    return WAREHOUSE_CONSTANTS.DEFAULT_DOMESTIC_WAREHOUSE.id;
  }

  async create(createWarehouseDto: CreateWarehouseDto) {
    const [newWarehouse] = await this.db.insert(wmsTables.warehouses).values({
      name: createWarehouseDto.name,
      type: createWarehouseDto.type || 'domestic',
      location: createWarehouseDto.location,
    }).returning();

    this.logger.log(`새 창고 생성: ${newWarehouse.name} (ID: ${newWarehouse.id})`);
    return newWarehouse;
  }

  async findAll() {
    return this.db.query.warehouses.findMany({
      orderBy: (warehouses, { asc }) => [asc(warehouses.name)],
    });
  }

  async findOne(id: string) {
    const warehouse = await this.db.query.warehouses.findFirst({
      where: eq(wmsTables.warehouses.id, id),
    });

    if (!warehouse) {
      throw new NotFoundException(`창고를 찾을 수 없습니다: ${id}`);
    }

    return warehouse;
  }

  async update(id: string, updateWarehouseDto: UpdateWarehouseDto) {
    const [updatedWarehouse] = await this.db.update(wmsTables.warehouses)
      .set({
        ...updateWarehouseDto,
        updatedAt: new Date(),
      })
      .where(eq(wmsTables.warehouses.id, id))
      .returning();

    if (!updatedWarehouse) {
      throw new NotFoundException(`창고를 찾을 수 없습니다: ${id}`);
    }

    this.logger.log(`창고 정보 업데이트: ${updatedWarehouse.name}`);
    return updatedWarehouse;
  }

  async remove(id: string) {
    // 기본 창고는 삭제 불가
    if (id === WAREHOUSE_CONSTANTS.DEFAULT_DOMESTIC_WAREHOUSE.id ||
      id === WAREHOUSE_CONSTANTS.DEFAULT_OVERSEAS_WAREHOUSE.id) {
      throw new Error('기본 창고는 삭제할 수 없습니다.');
    }

    // 사용 중인지 확인
    const inUse = await this.isWarehouseInUse(id);
    if (inUse) {
      throw new Error('사용 중인 창고는 삭제할 수 없습니다.');
    }

    const [deletedWarehouse] = await this.db.delete(wmsTables.warehouses)
      .where(eq(wmsTables.warehouses.id, id))
      .returning();

    if (!deletedWarehouse) {
      throw new NotFoundException(`창고를 찾을 수 없습니다: ${id}`);
    }

    return deletedWarehouse;
  }

  // 창고가 사용 중인지 확인 (삭제 전 체크용)
  async isWarehouseInUse(warehouseId: string): Promise<boolean> {
    const stockCount = await this.db.select({ count: sql<number>`count(*)` })
      .from(wmsTables.stocks)
      .where(and(
        eq(wmsTables.stocks.warehouseId, warehouseId),
        isNull(wmsTables.stocks.destroyerEventId)
      ));

    return stockCount[0].count > 0;
  }

  // 창고별 현재 재고 요약
  async getWarehouseStockSummary(warehouseId: string) {
    const stocks = await this.db.select({
      skuId: wmsTables.stocks.skuId,
      skuName: wmsTables.skus.name,
      skuCode: wmsTables.skus.code,
      totalQuantity: sql<number>`sum(${wmsTables.stocks.realQuantity})`,
      totalReserved: sql<number>`sum(${wmsTables.stocks.reservedQuantity})`,
      totalAvailable: sql<number>`sum(${wmsTables.stocks.availableQuantity})`,
      locationCount: sql<number>`count(distinct ${wmsTables.stocks.locationId})`,
    })
      .from(wmsTables.stocks)
      .innerJoin(wmsTables.skus, eq(wmsTables.stocks.skuId, wmsTables.skus.id))
      .where(and(
        eq(wmsTables.stocks.warehouseId, warehouseId),
        isNull(wmsTables.stocks.destroyerEventId)
      ))
      .groupBy(wmsTables.stocks.skuId, wmsTables.skus.name, wmsTables.skus.code);

    return {
      warehouseId,
      summary: stocks,
      totalSkus: stocks.length,
      totalQuantity: stocks.reduce((sum, item) => sum + item.totalQuantity, 0),
      totalAvailable: stocks.reduce((sum, item) => sum + item.totalAvailable, 0),
    };
  }
}