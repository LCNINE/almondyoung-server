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

  async create(dto: CreateWarehouseDto, tx?: DbTx): Promise<Warehouse> {
    return this.dbService.run(async (trx) => {
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
    const [updated] = await this.dbService.run(
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

    const [deleted] = await this.dbService.run(
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
          await this.dbService.run(async (trx) => {
            await trx.insert(wmsTables.warehouses).values({
              id: data.id,
              name: data.name,
              type: data.type,
              location: data.location,
              supportedPickingStrategies: [...data.supportedPickingStrategies],
              isSellable: data.isSellable,
            });
            await this.locationService.ensureSystemLocations(data.id, trx);
          });
          this.logger.log(`기본 창고 생성: ${data.name}`);
        } else if (existing.isSellable !== data.isSellable) {
          // is_sellable "한 컬럼만" 수렴시킨다. 컬럼은 DEFAULT true 로 깔렸으므로
          // 이미 존재하는 해외 창고 행은 이 수렴이 없으면 영원히 판매 창고로 남고,
          // inSellableWarehouse() 가 모든 창고를 매칭해 판매 게이트와 공급 파이프라인
          // 필터가 통째로 no-op 이 된다.
          //
          // ⚠️ supported_picking_strategies 는 절대 여기서 덮어쓰지 않는다 — 그 컬럼은
          // UpdateWarehouseDto 를 통해 admin-web 창고 설정 화면에서 운영자가 바꾸는
          // 운영 설정이라, 부팅마다 상수로 되돌리면 재시작할 때마다 설정이 사라진다.
          // 이 구분(코드가 소유하는 컬럼 vs 운영자가 소유하는 컬럼)이 핵심이다.
          await this.dbService.run(async (trx) => {
            await trx
              .update(wmsTables.warehouses)
              .set({ isSellable: data.isSellable, updatedAt: new Date() })
              .where(eq(wmsTables.warehouses.id, data.id));
          });
          this.logger.log(`기본 창고 판매 여부 수렴: ${data.name} → is_sellable=${data.isSellable}`);
        }
      }

      // 기존 custom warehouse도 신규 system role이 추가된 배포 직후 바로 bootstrap한다.
      // unique (warehouse_id, system_role) + LocationService 잠금이 role당 활성 한 개로 수렴시킨다.
      const warehouses = await this.reader.findAll();
      for (const warehouse of warehouses) {
        await this.locationService.ensureSystemLocations(warehouse.id);
      }
    } catch (error) {
      this.logger.error('기본 창고 생성 중 오류 발생:', error);
      // 필수 system location이 없는 창고로 서비스를 시작하지 않도록 bootstrap 실패를 숨기지 않는다.
      throw error;
    }
  }
}
