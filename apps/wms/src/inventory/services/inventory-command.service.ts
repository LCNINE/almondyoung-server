import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../../database/schemas/wms-schema';
import { StockEventStore } from '../repositories/stock-event.store';

@Injectable()
export class InventoryCommandService {
  private readonly logger = new Logger(InventoryCommandService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly eventStore: StockEventStore,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async receive(input: {
    skuId: string;
    toWarehouseId: string;
    toLocationId?: string | null;
    quantity: number;
    occurredAt?: Date;
    idempotencyKey?: string;
    reason?: string;
    journalId?: string;
  }, tx?: DbTx) {
    if (input.quantity <= 0) throw new BadRequestException('quantity must be positive');
    const exec = async (trx: DbTx) => {
      const event = await this.eventStore.createEvent({
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
      }, trx);
      return { eventId: event?.id ?? null };
    };
    return tx ? exec(tx) : this.db.transaction(exec);
  }

  async ship(input: {
    skuId: string;
    warehouseId: string;
    locationId?: string | null;
    quantity: number;
    occurredAt?: Date;
    idempotencyKey?: string;
    reason?: string;
  }, tx?: DbTx) {
    if (input.quantity <= 0) throw new BadRequestException('quantity must be positive');
    const exec = async (trx: DbTx) => {
      const event = await this.eventStore.createEvent({
        skuId: input.skuId,
        fromWarehouseId: input.warehouseId,
        fromLocationId: input.locationId ?? null,
        fromState: 'ON_HAND', // 예약 없이 직접 출고
        transitionType: 'SHIP',
        quantity: input.quantity,
        occurredAt: input.occurredAt ?? new Date(),
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
      }, trx);
      return { eventId: event?.id ?? null };
    };
    return tx ? exec(tx) : this.db.transaction(exec);
  }

  async transferShip(input: {
    skuId: string;
    fromWarehouseId: string;
    fromLocationId: string;
    quantity: number;
    occurredAt?: Date;
    idempotencyKey?: string;
    reason?: string;
  }, tx?: DbTx) {
    if (input.quantity <= 0) throw new BadRequestException('quantity must be positive');
    const exec = async (trx: DbTx) => {
      const event = await this.eventStore.createEvent({
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
      }, trx);
      return { eventId: event?.id ?? null };
    };
    return tx ? exec(tx) : this.db.transaction(exec);
  }

  async transferReceive(input: {
    skuId: string;
    toWarehouseId: string;
    toLocationId: string;
    quantity: number;
    occurredAt?: Date;
    idempotencyKey?: string;
    reason?: string;
  }, tx?: DbTx) {
    if (input.quantity <= 0) throw new BadRequestException('quantity must be positive');
    const exec = async (trx: DbTx) => {
      const event = await this.eventStore.createEvent({
        skuId: input.skuId,
        toWarehouseId: input.toWarehouseId,
        toLocationId: input.toLocationId,
        fromState: 'IN_TRANSFER',
        toState: 'ON_HAND',
        transitionType: 'MOVE',
        quantity: input.quantity,
        occurredAt: input.occurredAt ?? new Date(),
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
      }, trx);
      return { eventId: event?.id ?? null };
    };
    return tx ? exec(tx) : this.db.transaction(exec);
  }

  async adjustUp(input: {
    skuId: string;
    warehouseId: string;
    locationId?: string | null;
    quantity: number;
    occurredAt?: Date;
    idempotencyKey?: string;
    reason?: string;
  }, tx?: DbTx) {
    if (input.quantity <= 0) throw new BadRequestException('quantity must be positive');
    const exec = async (trx: DbTx) => {
      const event = await this.eventStore.createEvent({
        skuId: input.skuId,
        toWarehouseId: input.warehouseId,
        toLocationId: input.locationId ?? null,
        toState: 'ON_HAND',
        transitionType: 'ADJUST_UP',
        quantity: input.quantity,
        occurredAt: input.occurredAt ?? new Date(),
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
      }, trx);
      return { eventId: event?.id ?? null };
    };
    return tx ? exec(tx) : this.db.transaction(exec);
  }

  async adjustDown(input: {
    skuId: string;
    warehouseId: string;
    locationId?: string | null;
    quantity: number;
    occurredAt?: Date;
    idempotencyKey?: string;
    reason?: string;
  }, tx?: DbTx) {
    if (input.quantity <= 0) throw new BadRequestException('quantity must be positive');
    const exec = async (trx: DbTx) => {
      const event = await this.eventStore.createEvent({
        skuId: input.skuId,
        fromWarehouseId: input.warehouseId,
        fromLocationId: input.locationId ?? null,
        fromState: 'ON_HAND',
        transitionType: 'ADJUST_DOWN',
        quantity: input.quantity,
        occurredAt: input.occurredAt ?? new Date(),
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
      }, trx);
      return { eventId: event?.id ?? null };
    };
    return tx ? exec(tx) : this.db.transaction(exec);
  }

  async moveInternal(input: {
    skuId: string;
    warehouseId: string;
    fromLocationId: string;
    toLocationId: string;
    quantity: number;
    occurredAt?: Date;
    idempotencyKey?: string;
    reason?: string;
  }, tx?: DbTx) {
    if (input.quantity <= 0) throw new BadRequestException('quantity must be positive');
    const exec = async (trx: DbTx) => {
      const event = await this.eventStore.createEvent({
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
      }, trx);
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


