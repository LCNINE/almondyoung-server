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

    // 판정과 DELETE 를 한 트랜잭션에 둔다 — 따로 읽으면 "규칙 없음" 을 본 뒤 규칙이 들어와도
    // 삭제가 그대로 진행되어, 막으려던 postgres 23503 이 결국 500 으로 새어 나온다.
    const [deleted] = await this.dbService.run(async (trx) => {
      const inUse = await this.reader.isInUse(id, trx);
      if (inUse) {
        throw new ConflictError('사용 중인 창고는 삭제할 수 없습니다.');
      }

      // 보충 경로 규칙의 두 FK 는 restrict 다(스펙 §8.1) — 여기서 세지 않으면 DELETE 가
      // postgres 23503 으로 죽고 그건 ApplicationException 이 아니라 500 이다. 규칙 행을 같이
      // 지우지 않는 것이 restrict 를 고른 이유이므로, 사람에게 무엇을 먼저 지울지 알린다.
      const routeRules = await this.reader.countReplenishmentRouteRules(id, trx);
      if (routeRules > 0) {
        throw new ConflictError('보충 경로 규칙이 있어 삭제할 수 없습니다. 재고 보충 규칙 화면에서 먼저 삭제하세요.');
      }

      return trx.delete(wmsTables.warehouses).where(eq(wmsTables.warehouses.id, id)).returning();
    }, tx);

    if (!deleted) {
      throw new NotFoundError(`창고를 찾을 수 없습니다: ${id}`);
    }

    return deleted;
  }

  /**
   * 이 DB 의 모든 창고에 시스템 로케이션을 수렴시킨다. 새 system role 이 추가된 배포 직후 기존
   * 창고도 바로 갖게 하려고 부팅이 부른다. unique (warehouse_id, system_role) + LocationService 잠금이
   * role 당 활성 한 개로 수렴시킨다.
   *
   * 한 DB(= 한 테넌트) 안의 일이라 그 DB 의 트랜잭션을 받는다. 창고는 만들지 않는다 — 기본 창고는
   * 테넌트 1 전용 데이터라 `baseline-tenant-1` 시드가 넣는다. 부팅이 만들면 새 테넌트 DB 에도 생긴다.
   *
   * 실패를 삼키지 않는다 — 필수 시스템 로케이션이 없는 창고로 서비스를 시작하지 않으려는 것이다
   * (기본 보유자 보장은 반대로 삼킨다. 둘을 맞추지 말 것).
   */
  async convergeSystemLocations(tx?: DbTx): Promise<void> {
    const warehouses = await this.reader.findAll(tx);
    for (const warehouse of warehouses) {
      await this.locationService.ensureSystemLocations(warehouse.id, tx);
    }
  }
}
