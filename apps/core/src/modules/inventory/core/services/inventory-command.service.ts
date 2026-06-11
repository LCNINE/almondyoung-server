import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { StockEventStore } from '../repositories/stock-event.store';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { LocationService } from './location.service';
import { eq, and, gt, desc } from 'drizzle-orm';

@Injectable()
export class InventoryCommandService {
  private readonly logger = new Logger(InventoryCommandService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly eventStore: StockEventStore,
    private readonly outboxService: OutboxService,
    private readonly locationService: LocationService,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async receive(
    input: {
      skuId: string;
      toWarehouseId: string;
      toLocationId?: string | null;
      quantity: number;
      occurredAt?: Date;
      idempotencyKey?: string;
      reason?: string;
      journalId?: string;
    },
    tx?: DbTx,
  ) {
    if (input.quantity <= 0) throw new BadRequestException('quantity must be positive');
    const exec = async (trx: DbTx) => {
      // 1. SKU 정보 조회
      const sku = await trx.query.skus.findFirst({
        where: (s, { eq }) => eq(s.id, input.skuId),
      });

      if (!sku) {
        throw new BadRequestException(`SKU not found: ${input.skuId}`);
      }

      // 2. 현재 재고 조회
      const currentStock = await trx.query.stockLedgers.findFirst({
        where: (l, { eq, and }) =>
          and(
            eq(l.skuId, input.skuId),
            eq(l.warehouseId, input.toWarehouseId),
            eq(l.locationId, input.toLocationId ?? ''),
            eq(l.stockState, 'ON_HAND'),
          ),
      });

      const currentQuantity = currentStock?.qty ?? 0;
      const afterQuantity = currentQuantity + input.quantity;

      // 3. Stock Event 생성
      const event = await this.eventStore.createEvent(
        {
          skuId: input.skuId,
          toWarehouseId: input.toWarehouseId,
          toLocationId: input.toLocationId ?? null,
          toState: 'ON_HAND',
          transitionType: 'RECEIVE',
          quantity: input.quantity,
          occurredAt: input.occurredAt ?? new Date(),
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
          journalId: input.journalId,
        },
        trx,
      );

      if (!event) {
        throw new BadRequestException('Failed to create stock event');
      }

      // 4. Outbox에 이벤트 추가
      await this.outboxService.enqueue(
        {
          eventType: 'StockReceived',
          aggregateType: 'Stock',
          aggregateId: event.id,
          partitionKey: input.skuId,
          payload: {
            skuCode: sku.name,
            skuId: input.skuId,
            warehouseId: input.toWarehouseId,
            locationId: input.toLocationId,
            quantity: input.quantity,
            afterQuantity: afterQuantity,
            reason: input.reason,
            journalId: input.journalId,
            occurredAt: (input.occurredAt ?? new Date()).toISOString(),
          },
        },
        trx,
      );

      this.logger.log(`RECEIVE: sku=${sku.name} qty=${input.quantity} (${currentQuantity} → ${afterQuantity})`);

      return { eventId: event?.id ?? null };
    };
    return tx ? exec(tx) : this.db.transaction(exec);
  }

  async ship(
    input: {
      skuId: string;
      warehouseId: string;
      locationId?: string | null;
      quantity: number;
      occurredAt?: Date;
      idempotencyKey?: string;
      reason?: string;
    },
    tx?: DbTx,
  ) {
    if (input.quantity <= 0) throw new BadRequestException('quantity must be positive');
    const exec = async (trx: DbTx) => {
      // 1. SKU 정보 조회
      const sku = await trx.query.skus.findFirst({
        where: (s, { eq }) => eq(s.id, input.skuId),
      });

      if (!sku) {
        throw new BadRequestException(`SKU not found: ${input.skuId}`);
      }

      // 2. 현재 재고 조회
      const currentStock = await trx.query.stockLedgers.findFirst({
        where: (l, { eq, and }) =>
          and(
            eq(l.skuId, input.skuId),
            eq(l.warehouseId, input.warehouseId),
            eq(l.locationId, input.locationId ?? ''),
            eq(l.stockState, 'ON_HAND'),
          ),
      });

      const currentQuantity = currentStock?.qty ?? 0;
      const afterQuantity = Math.max(0, currentQuantity - input.quantity);

      // 3. Stock Event 생성
      const event = await this.eventStore.createEvent(
        {
          skuId: input.skuId,
          fromWarehouseId: input.warehouseId,
          fromLocationId: input.locationId ?? null,
          fromState: 'ON_HAND', // 예약 없이 직접 출고
          transitionType: 'SHIP',
          quantity: input.quantity,
          occurredAt: input.occurredAt ?? new Date(),
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
        },
        trx,
      );

      if (!event) {
        throw new BadRequestException('Failed to create stock event');
      }

      // 4. Outbox에 이벤트 추가 ✅
      await this.outboxService.enqueue(
        {
          eventType: 'StockShipped',
          aggregateType: 'Stock',
          aggregateId: event.id,
          partitionKey: input.skuId,
          payload: {
            skuCode: sku.name,
            skuId: input.skuId,
            warehouseId: input.warehouseId,
            locationId: input.locationId,
            quantity: input.quantity,
            afterQuantity: afterQuantity,
            reason: input.reason,
            occurredAt: (input.occurredAt ?? new Date()).toISOString(),
          },
        },
        trx,
      );

      this.logger.log(`SHIP: sku=${sku.name} qty=${input.quantity} (${currentQuantity} → ${afterQuantity})`);

      return { eventId: event?.id ?? null };
    };
    return tx ? exec(tx) : this.db.transaction(exec);
  }

  async transferShip(
    input: {
      skuId: string;
      fromWarehouseId: string;
      fromLocationId: string;
      quantity: number;
      occurredAt?: Date;
      idempotencyKey?: string;
      reason?: string;
    },
    tx?: DbTx,
  ) {
    if (input.quantity <= 0) throw new BadRequestException('quantity must be positive');
    const exec = async (trx: DbTx) => {
      const event = await this.eventStore.createEvent(
        {
          skuId: input.skuId,
          fromWarehouseId: input.fromWarehouseId,
          fromLocationId: input.fromLocationId,
          fromState: 'ON_HAND',
          toWarehouseId: input.fromWarehouseId,
          toLocationId: input.fromLocationId,
          toState: 'IN_TRANSFER',
          transitionType: 'MOVE',
          quantity: input.quantity,
          occurredAt: input.occurredAt ?? new Date(),
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
        },
        trx,
      );
      return { eventId: event?.id ?? null };
    };
    return tx ? exec(tx) : this.db.transaction(exec);
  }

  async transferReceive(
    input: {
      skuId: string;
      fromWarehouseId: string;
      fromLocationId: string;
      toWarehouseId: string;
      toLocationId: string;
      quantity: number;
      occurredAt?: Date;
      idempotencyKey?: string;
      reason?: string;
    },
    tx?: DbTx,
  ) {
    if (input.quantity <= 0) throw new BadRequestException('quantity must be positive');
    const exec = async (trx: DbTx) => {
      const event = await this.eventStore.createEvent(
        {
          skuId: input.skuId,
          fromWarehouseId: input.fromWarehouseId,
          fromLocationId: input.fromLocationId,
          fromState: 'IN_TRANSFER',
          toWarehouseId: input.toWarehouseId,
          toLocationId: input.toLocationId,
          toState: 'ON_HAND',
          transitionType: 'MOVE',
          quantity: input.quantity,
          occurredAt: input.occurredAt ?? new Date(),
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
        },
        trx,
      );
      return { eventId: event?.id ?? null };
    };
    return tx ? exec(tx) : this.db.transaction(exec);
  }

  async adjustUp(
    input: {
      skuId: string;
      warehouseId: string;
      locationId?: string | null;
      quantity: number;
      occurredAt?: Date;
      idempotencyKey?: string;
      reason?: string;
    },
    tx?: DbTx,
  ) {
    if (input.quantity <= 0) throw new BadRequestException('quantity must be positive');
    const exec = async (trx: DbTx) => {
      // 1. SKU 정보 조회 (이름 가져오기)
      const sku = await trx.query.skus.findFirst({
        where: (s, { eq }) => eq(s.id, input.skuId),
      });

      if (!sku) {
        throw new BadRequestException(`SKU not found: ${input.skuId}`);
      }

      // 2. 위치 미지정 시 시스템 입고기본존으로 — 빈 문자열 uuid 비교(DB 에러)와
      //    locationId 없는 ledger 갱신 불가 문제를 막는다
      let effectiveLocationId = input.locationId ?? null;
      if (!effectiveLocationId) {
        await this.locationService.ensureSystemLocations(input.warehouseId, trx);
        const zone = await this.locationService.getSystemLocationByRole(input.warehouseId, 'inbound_default', trx);
        if (!zone) throw new BadRequestException('조정 기본 위치가 존재하지 않습니다.');
        effectiveLocationId = zone.id;
      }

      // 3. 현재 재고 조회
      const currentStock = await trx.query.stockLedgers.findFirst({
        where: (l, { eq, and }) =>
          and(
            eq(l.skuId, input.skuId),
            eq(l.warehouseId, input.warehouseId),
            eq(l.locationId, effectiveLocationId),
            eq(l.stockState, 'ON_HAND'),
          ),
      });

      const currentQuantity = currentStock?.qty ?? 0;
      const afterQuantity = currentQuantity + input.quantity;

      // 4. Stock Event 생성
      const event = await this.eventStore.createEvent(
        {
          skuId: input.skuId,
          toWarehouseId: input.warehouseId,
          toLocationId: effectiveLocationId,
          toState: 'ON_HAND',
          transitionType: 'ADJUST_UP',
          quantity: input.quantity,
          occurredAt: input.occurredAt ?? new Date(),
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
        },
        trx,
      );

      if (!event) {
        throw new BadRequestException('Failed to create stock event');
      }

      // 4. Outbox에 이벤트 추가 ✅
      await this.outboxService.enqueue(
        {
          eventType: 'StockAdjusted',
          aggregateType: 'Stock',
          aggregateId: event.id,
          partitionKey: input.skuId,
          payload: {
            skuCode: sku.name, // SKU 이름
            skuId: input.skuId, // SKU ID
            warehouseId: input.warehouseId,
            locationId: effectiveLocationId,
            quantity: input.quantity, // 조정량
            deltaQuantity: input.quantity, // 변동량 (양수)
            afterQuantity: afterQuantity, // 조정 후 재고
            reason: input.reason,
            occurredAt: (input.occurredAt ?? new Date()).toISOString(),
          },
        },
        trx,
      );

      this.logger.log(`ADJUST_UP: sku=${sku.name} qty=${input.quantity} (${currentQuantity} → ${afterQuantity})`);

      return { eventId: event?.id ?? null };
    };
    return tx ? exec(tx) : this.db.transaction(exec);
  }

  async adjustDown(
    input: {
      skuId: string;
      warehouseId: string;
      locationId?: string | null;
      quantity: number;
      occurredAt?: Date;
      idempotencyKey?: string;
      reason?: string;
    },
    tx?: DbTx,
  ) {
    if (input.quantity <= 0) throw new BadRequestException('quantity must be positive');
    const exec = async (trx: DbTx) => {
      // 1. SKU 정보 조회
      const sku = await trx.query.skus.findFirst({
        where: (s, { eq }) => eq(s.id, input.skuId),
      });

      if (!sku) {
        throw new BadRequestException(`SKU not found: ${input.skuId}`);
      }

      // 2. 위치 미지정 시 ON_HAND가 가장 많은 위치에서 차감
      let effectiveLocationId = input.locationId ?? null;
      if (!effectiveLocationId) {
        const [candidate] = await trx
          .select({ locationId: wmsTables.stockLedgers.locationId, qty: wmsTables.stockLedgers.qty })
          .from(wmsTables.stockLedgers)
          .where(
            and(
              eq(wmsTables.stockLedgers.skuId, input.skuId),
              eq(wmsTables.stockLedgers.warehouseId, input.warehouseId),
              eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
              gt(wmsTables.stockLedgers.qty, 0),
            ),
          )
          .orderBy(desc(wmsTables.stockLedgers.qty))
          .limit(1);
        if (!candidate) {
          throw new BadRequestException('차감할 ON_HAND 재고가 없습니다.');
        }
        effectiveLocationId = candidate.locationId;
      }

      // 3. 현재 재고 조회 + 부족 검증 (ledger 음수 제약으로 500 나기 전에 400으로)
      const currentStock = await trx.query.stockLedgers.findFirst({
        where: (l, { eq, and }) =>
          and(
            eq(l.skuId, input.skuId),
            eq(l.warehouseId, input.warehouseId),
            eq(l.locationId, effectiveLocationId),
            eq(l.stockState, 'ON_HAND'),
          ),
      });

      const currentQuantity = currentStock?.qty ?? 0;
      if (currentQuantity < input.quantity) {
        throw new BadRequestException(
          `재고가 부족합니다. 해당 위치 ON_HAND ${currentQuantity} < 차감 요청 ${input.quantity}`,
        );
      }
      const afterQuantity = currentQuantity - input.quantity;

      // 4. Stock Event 생성
      const event = await this.eventStore.createEvent(
        {
          skuId: input.skuId,
          fromWarehouseId: input.warehouseId,
          fromLocationId: effectiveLocationId,
          fromState: 'ON_HAND',
          transitionType: 'ADJUST_DOWN',
          quantity: input.quantity,
          occurredAt: input.occurredAt ?? new Date(),
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
        },
        trx,
      );

      if (!event) {
        throw new BadRequestException('Failed to create stock event');
      }

      // 4. Outbox에 이벤트 추가 ✅
      await this.outboxService.enqueue(
        {
          eventType: 'StockAdjusted',
          aggregateType: 'Stock',
          aggregateId: event.id,
          partitionKey: input.skuId,
          payload: {
            skuCode: sku.name,
            skuId: input.skuId,
            warehouseId: input.warehouseId,
            locationId: effectiveLocationId,
            quantity: input.quantity,
            deltaQuantity: -input.quantity, // 변동량 (음수)
            afterQuantity: afterQuantity,
            reason: input.reason,
            occurredAt: (input.occurredAt ?? new Date()).toISOString(),
          },
        },
        trx,
      );

      this.logger.log(`ADJUST_DOWN: sku=${sku.name} qty=${input.quantity} (${currentQuantity} → ${afterQuantity})`);

      return { eventId: event?.id ?? null };
    };
    return tx ? exec(tx) : this.db.transaction(exec);
  }

  async moveInternal(
    input: {
      skuId: string;
      warehouseId: string;
      fromLocationId: string;
      toLocationId: string;
      quantity: number;
      occurredAt?: Date;
      idempotencyKey?: string;
      reason?: string;
      journalId?: string;
    },
    tx?: DbTx,
  ) {
    if (input.quantity <= 0) throw new BadRequestException('quantity must be positive');
    const exec = async (trx: DbTx) => {
      const event = await this.eventStore.createEvent(
        {
          journalId: input.journalId,
          skuId: input.skuId,
          fromWarehouseId: input.warehouseId,
          fromLocationId: input.fromLocationId,
          toWarehouseId: input.warehouseId,
          toLocationId: input.toLocationId,
          fromState: 'ON_HAND',
          toState: 'ON_HAND',
          transitionType: 'MOVE',
          quantity: input.quantity,
          occurredAt: input.occurredAt ?? new Date(),
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
        },
        trx,
      );
      return { eventId: event?.id ?? null };
    };
    return tx ? exec(tx) : this.db.transaction(exec);
  }

  async reverseEvent(input: { eventId: string; reason: string }, tx?: DbTx) {
    const exec = async (trx: DbTx) => {
      const rev = await this.eventStore.reverseEvent(input.eventId, input.reason, trx);
      return { eventId: rev?.id ?? null };
    };
    return tx ? exec(tx) : this.db.transaction(exec);
  }
}
