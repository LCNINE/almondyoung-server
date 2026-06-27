import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { DbService } from '@app/db';
import { eq, and, isNull } from 'drizzle-orm';
import { CreateStockEntryBySkuIdDto } from '../../inbound/dto/create-stock-entry-by-skuid.dto';
import { SkuCreationSource } from '../../sku-catalog/dto/create-sku.dto';
import { StockEventStore } from '../repositories/stock-event.store';
import { InventoryCommandService } from '../services/inventory-command.service';
import { UnifiedReservationService } from '../../shared/services/unified-reservation.service';
import { AllocationStrategyService } from './allocation-strategy.service';

@Injectable()
export class StockEventService {
  private readonly logger = new Logger(StockEventService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly eventStore: StockEventStore,
    private readonly commandService: InventoryCommandService,
    private readonly unifiedReservation: UnifiedReservationService,
    private readonly allocationStrategy: AllocationStrategyService,
  ) {}

  /**
   * 안전한 SKU ID 기반 재고 입고 처리
   * - 자동 SKU 생성 없음
   * - SKU ID로 직접 조회
   * - 데이터 무결성 보장
   */
  async createStockEntryBySkuId(dto: CreateStockEntryBySkuIdDto, tx?: DbTx) {
    const { skuId, variantId, warehouseId, locationId, quantity, stockType, reason, subBarcode, packingUnit } = dto;

    return this.dbService.run(async (executor) => {
      // SKU ID로 직접 조회, 자동 생성 없음
      const sku = await executor.query.skus.findFirst({
        where: eq(wmsTables.skus.id, skuId),
      });

      if (!sku) {
        throw new BadRequestException(`SKU not found: ${skuId}`);
      }

      if (quantity < 0) {
        throw new BadRequestException('재고 수량은 음수일 수 없습니다.');
      }

      // 재고 이벤트 생성
      await this.commandService.receive(
        {
          skuId: sku.id,
          toWarehouseId: warehouseId,
          toLocationId: locationId ?? null,
          quantity,
          occurredAt: new Date(),
          idempotencyKey: undefined,
          reason: reason || `stock_entry_${variantId ? `for_variant_${variantId}` : 'manual'}`,
        },
        executor,
      );

      // 서브 바코드가 있으면 바코드 테이블에 추가
      if (subBarcode) {
        await executor
          .insert(wmsTables.skuBarcodes)
          .values({
            skuId: sku.id,
            barcode: subBarcode,
            isPrimary: false,
            packingUnit: packingUnit || null,
          })
          .onConflictDoNothing();
      }

      this.logger.log(`안전한 재고 입고 완료: SKU ${sku.id}, 수량: ${quantity}, 창고: ${warehouseId}`);

      return { skuId: sku.id, variantId };
    }, tx);
  }

  // 재고 출고 처리 (보류)
  async processStockOut(stockId: string, quantity: number, orderId?: string, reason?: string) {
    throw new BadRequestException('processStockOut: transition-based 구현 대기');
  }

  /**
   * 재고 예약 처리
   * @deprecated Use UnifiedReservationService.reserveStock() directly
   */
  async reserveStock(
    skuId: string,
    quantity: number,
    warehouseId: string,
    targetType: 'FULFILLMENT_ORDER' | 'MOVEMENT_TASK',
    targetId: string,
    reason?: string,
    tx?: DbTx,
  ) {
    this.logger.log(`Reserving ${quantity} units of SKU ${skuId} for ${targetType}:${targetId}`);

    return this.dbService.run(async (executor) => {
      // UnifiedReservationService를 활용한 예약 생성
      const reservation = await this.unifiedReservation.reserveStock(
        {
          targetType,
          targetId,
          skuId,
          warehouseId,
          quantity,
          reason,
        },
        executor,
      );

      this.logger.log(`Successfully reserved: ${reservation.id}`);

      return reservation;
    }, tx);
  }

  /**
   * 재고 예약 해제
   * @deprecated Use UnifiedReservationService.releaseReservation() directly
   */
  async releaseReservation(reservationId: string, reason?: string, tx?: DbTx) {
    this.logger.log(`Releasing reservation: ${reservationId}`);

    return this.dbService.run(async (executor) => {
      await this.unifiedReservation.releaseReservation(reservationId, executor);

      this.logger.log(`Successfully released reservation: ${reservationId}`);
    }, tx);
  }

  /**
   * 창고 간 재고 이동
   *
   * 프로세스:
   * 1. 출발 창고에서 transferShip (ON_HAND → IN_TRANSFER)
   * 2. 도착 창고에서 transferReceive (IN_TRANSFER → ON_HAND)
   */
  async transferBetweenWarehouses(
    skuId: string,
    fromWarehouseId: string,
    fromLocationId: string,
    toWarehouseId: string,
    toLocationId: string,
    quantity: number,
    reason?: string,
    tx?: DbTx,
  ) {
    this.logger.log(
      `Transferring ${quantity} units of SKU ${skuId} from ${fromWarehouseId}/${fromLocationId} to ${toWarehouseId}/${toLocationId}`,
    );

    return this.dbService.run(async (executor) => {
      if (quantity <= 0) {
        throw new BadRequestException('Quantity must be positive');
      }

      // 1. 출발지에서 재고 차감 및 IN_TRANSFER 상태로 전환
      const shipEvent = await this.commandService.transferShip(
        {
          skuId,
          fromWarehouseId,
          fromLocationId,
          quantity,
          reason: reason || `Transfer to warehouse ${toWarehouseId}`,
        },
        executor,
      );

      this.logger.log(`Transfer ship event created: ${shipEvent.eventId}`);

      // 2. 도착지에서 재고 입고 및 ON_HAND 상태로 전환
      const receiveEvent = await this.commandService.transferReceive(
        {
          skuId,
          fromWarehouseId,
          fromLocationId,
          toWarehouseId,
          toLocationId,
          quantity,
          reason: reason || `Transfer from warehouse ${fromWarehouseId}`,
        },
        executor,
      );

      this.logger.log(`Transfer receive event created: ${receiveEvent.eventId}`);

      return {
        shipEventId: shipEvent.eventId,
        receiveEventId: receiveEvent.eventId,
      };
    }, tx);
  }

  /**
   * 재고 손실 처리 (파손, 분실 등)
   *
   * ON_HAND 재고를 감소시킵니다.
   */
  async processDamage(
    skuId: string,
    warehouseId: string,
    locationId: string,
    quantity: number,
    reason: string,
    tx?: DbTx,
  ) {
    this.logger.log(`Processing damage: ${quantity} units of SKU ${skuId} at ${warehouseId}/${locationId}`);

    return this.dbService.run(async (executor) => {
      if (quantity <= 0) {
        throw new BadRequestException('Quantity must be positive');
      }

      if (!reason) {
        throw new BadRequestException('Reason is required for damage processing');
      }

      // ADJUST_DOWN 이벤트로 재고 감소
      const event = await this.commandService.adjustDown(
        {
          skuId,
          warehouseId,
          locationId,
          quantity,
          reason: `DAMAGE: ${reason}`,
        },
        executor,
      );

      this.logger.log(`Damage processed: event ${event.eventId}`);

      return event;
    }, tx);
  }

  /**
   * 재고 반품 처리
   *
   * 반품된 상품을 지정된 위치(또는 기본 반품 위치)에 입고합니다.
   */
  async processReturn(
    skuId: string,
    warehouseId: string,
    quantity: number,
    orderId: string,
    locationId?: string,
    reason?: string,
    tx?: DbTx,
  ) {
    this.logger.log(`Processing return: ${quantity} units of SKU ${skuId} for order ${orderId}`);

    return this.dbService.run(async (executor) => {
      if (quantity <= 0) {
        throw new BadRequestException('Quantity must be positive');
      }

      // 반품 위치가 지정되지 않은 경우 기본 반품 위치 조회
      let targetLocationId = locationId;

      if (!targetLocationId) {
        // return_default 시스템 위치 조회
        const returnLocation = await executor.query.locations.findFirst({
          where: and(
            eq(wmsTables.locations.warehouseId, warehouseId),
            eq(wmsTables.locations.systemRole, 'return_default'),
          ),
        });

        if (!returnLocation) {
          throw new BadRequestException(
            `No return location found for warehouse ${warehouseId}. Please specify locationId.`,
          );
        }

        targetLocationId = returnLocation.id;
      }

      // RECEIVE 이벤트로 반품 입고
      const event = await this.commandService.receive(
        {
          skuId,
          toWarehouseId: warehouseId,
          toLocationId: targetLocationId,
          quantity,
          reason: `RETURN: Order ${orderId}${reason ? ` - ${reason}` : ''}`,
        },
        executor,
      );

      this.logger.log(`Return processed: event ${event.eventId}`);

      return {
        eventId: event.eventId,
        locationId: targetLocationId,
      };
    }, tx);
  }
}
