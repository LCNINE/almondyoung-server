import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { StockEventStore } from '../repositories/stock-event.store';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { eq, and } from 'drizzle-orm';

@Injectable()
export class InventoryCommandService {
  private readonly logger = new Logger(InventoryCommandService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly eventStore: StockEventStore,
    private readonly outboxService: OutboxService,
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
      const afterQuantity = currentQuantity + input.quantity;

      // 3. Stock Event 생성
      const event = await this.eventStore.createEvent(
        {
          skuId: input.skuId,
          toWarehouseId: input.warehouseId,
          toLocationId: input.locationId ?? null,
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
            locationId: input.locationId,
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
            locationId: input.locationId,
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
