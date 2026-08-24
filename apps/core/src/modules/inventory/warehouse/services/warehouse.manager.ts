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
    const [updated] = await this.dbService.run(async (trx) => {
      // 판매 창고를 "정확히 하나" 로 유지한다. 두 방향 모두 같은 카운트로 판정한다.
      //
      // 0 개가 되면 inSellableWarehouse() 가 공집합을 매칭해 전 SKU 판매가능수량이 0 이
      // 되고 그 상태가 Medusa 로 발행된다. 2 개가 되면 WarehouseReader.getDefaultId() 가
      // 이행 오더를 어느 창고로 보낼지 정할 근거를 잃는다 — 그 모호함은 주문 처리
      // 시점이 아니라 여기서 터져야 한다. 늦게 터지면 이미 오더가 쌓인 뒤다.
      //
      // 알려진 대가: 판매 창고를 다른 창고로 "옮기는" 조작이 막힌다(켜기도 끄기도
      // 거부됨). 재고 전량을 옮기는 대사건이라 그때는 DB 로 직접 바꾼다 — 의도적 선택.
      if (dto.isSellable !== undefined) {
        const otherSellable = await this.reader.countSellableExcluding(id, trx);
        if (dto.isSellable === false && otherSellable === 0) {
          throw new ConflictError(
            '마지막 판매 창고는 비판매로 바꿀 수 없습니다. 다른 창고를 먼저 판매 창고로 지정하세요.',
          );
        }
        if (dto.isSellable === true && otherSellable > 0) {
          throw new ConflictError('판매 창고는 하나만 둘 수 있습니다. 기존 판매 창고를 먼저 해제하세요.');
        }
      }

      return trx
        .update(wmsTables.warehouses)
        .set({
          ...dto,
          updatedAt: new Date(),
        })
        .where(eq(wmsTables.warehouses.id, id))
        .returning();
    }, tx);

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
        }
        // 행이 이미 있으면 아무것도 하지 않는다 — insert-only 다.
        //
        // 예전에는 여기서 is_sellable 을 상수 값으로 수렴시켰다. 그건 "컬럼이
        // DEFAULT true 로 깔려 이미 존재하는 해외 창고 행이 영원히 판매 창고로
        // 남는다"는 일회성 백필을 부팅 수렴으로 구현한 것이었고, 그 임무는 끝났다.
        // 이제 is_sellable 은 운영자가 창고 설정 화면에서 바꾸는 값이라
        // (UpdateWarehouseDto.isSellable) 수렴을 남겨두면 컬럼에 주인이 둘이 되어
        // 운영자가 끈 판매 창고가 다음 재시작에 조용히 되살아난다.
        // supported_picking_strategies 를 수렴 대상에서 뺀 것과 같은 논리다.
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
